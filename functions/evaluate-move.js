const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

const {
  GOCOLS, toGoNotation, stonesToKataGo, analyzeMove,
  tacticalFactsString, computePremoveContext, inferProblemRole,
} = require('./_go-rules');
const { formatTopMovesForPrompt } = require('./_prompts');
const { callClaude } = require('./_claude');
const { corsHeaders, requireUser } = require('./_auth');

const KATAGO_SERVICE_URL = process.env.KATAGO_SERVICE_URL;
const KATAGO_TOKEN       = process.env.KATAGO_TOKEN;

// ── KataGo: top-5 position evaluation ────────────────────────────────────
// Returns { winrate, scoreLead, bestMove, topMoves } or null if KataGo unavailable.
async function katagoEval(initialStones, playerMove, boardSize) {
  if (!KATAGO_SERVICE_URL) return null;
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), 10000));
  try {
    const fetchResult = fetch(`${KATAGO_SERVICE_URL}/analyze-position`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${KATAGO_TOKEN}`,
      },
      body: JSON.stringify({ initialStones, moves: [playerMove], boardSize }),
    }).then(res => res.ok ? res.json() : null).catch(() => null);
    return await Promise.race([fetchResult, timeout]);
  } catch (e) {
    console.error('KataGo eval error:', e.message);
    return null;
  }
}

// Format KataGo ownership map into explicit territory facts for the Claude prompt.
// Focuses on intersections occupied by problem stones and their immediate neighbors,
// since those are what life/death commentary is actually about.
// ownershipMap: { "D5": 0.94, "E5": -0.87, ... } (positive = Black, negative = White)
// setupStones: { "col,row": "B"|"W" }
function formatOwnershipFacts(ownershipMap, setupStones, boardSize) {
  if (!ownershipMap || !setupStones) return '';

  // Collect GTP positions of all problem stones and their adjacent intersections.
  const relevant = new Set();
  for (const key of Object.keys(setupStones)) {
    const [c, r] = key.split(',').map(Number);
    const gtp = GOCOLS[c] + (boardSize - r);
    relevant.add(gtp);
    for (const [nc, nr] of [[c - 1, r], [c + 1, r], [c, r - 1], [c, r + 1]]) {
      if (nc >= 0 && nc < boardSize && nr >= 0 && nr < boardSize) {
        relevant.add(GOCOLS[nc] + (boardSize - nr));
      }
    }
  }

  const THRESHOLD = 0.7; // |value| > 0.7 = clearly owned
  const facts = [];
  for (const gtp of [...relevant].sort()) {
    const value = ownershipMap[gtp];
    if (value === undefined || Math.abs(value) < THRESHOLD) continue;
    const owner = value > 0 ? 'Black' : 'White';
    const pct = Math.round(Math.abs(value) * 100);
    facts.push(`${gtp}: ${owner} (${pct}%)`);
  }

  if (!facts.length) return '';
  return `KataGo territory ownership after move (>70% = clearly owned; positive = Black, negative = White):\n${facts.join(', ')}`;
}

function formatTopMoves(topMoves, studentMove, toPlayWord) {
  if (!topMoves?.length) return '';
  return `KataGo top-5 candidate moves:\n${formatTopMovesForPrompt(topMoves, toPlayWord, studentMove)}`;
}

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  const auth = await requireUser(event);
  if (auth.errorResponse) return auth.errorResponse;

  try {
    const { problem, col, row, attemptNumber, rank } = JSON.parse(event.body);
    const boardSize = problem.boardSize || 9;

    const isCorrect = (col === problem.solution.move[0] && row === problem.solution.move[1]);

    const studentMove = toGoNotation(col, row, boardSize);
    const correctMove = toGoNotation(problem.solution.move[0], problem.solution.move[1], boardSize);
    const toPlay      = problem.setup?.toPlay || 'B';
    const setupStones = problem.setup?.stones || {};

    const toPlayWord  = toPlay === 'B' ? 'Black' : 'White';
    const opponentWord = toPlay === 'B' ? 'White' : 'Black';

    // ── Deterministic board analysis (no LLM, no hallucination) ──
    const studentFacts = analyzeMove(setupStones, col, row, toPlay, boardSize);
    const correctFacts = analyzeMove(
      setupStones,
      problem.solution.move[0], problem.solution.move[1],
      toPlay, boardSize
    );

    const studentFactsStr = tacticalFactsString(studentFacts, studentMove, toPlayWord, opponentWord);
    const correctFactsStr = tacticalFactsString(correctFacts, correctMove, toPlayWord, opponentWord);

    // ── Pre-move liberty analysis: determines attack vs. defense role ──
    const premoveContext = computePremoveContext(setupStones, toPlay, boardSize);
    const problemRole    = inferProblemRole(
      setupStones, toPlay,
      problem.solution.move[0], problem.solution.move[1],
      boardSize
    );
    const roleLabel = problemRole === 'attack'
      ? `Problem role: ATTACK — ${toPlayWord} is killing the ${opponentWord} group. The solution reduces the ${opponentWord} group's liberties or eye space. Do NOT describe ${toPlayWord} as creating eyes for itself.`
      : problemRole === 'defense'
      ? `Problem role: DEFENSE — ${toPlayWord} is securing eye space for its own group. The solution helps ${toPlayWord} live.`
      : '';

    // ── KataGo: top 5 candidate moves with principal variations ──
    const katagoStones = stonesToKataGo(setupStones, boardSize);
    const katago       = await katagoEval(katagoStones, [toPlay, studentMove], boardSize);

    // If KataGo is unavailable and the correct move is indirect (no captures, no atari),
    // Claude has no grounding for explaining why it's correct. Return a canned response
    // rather than risk hallucinated strategic/positional claims.
    const correctIsIndirect = correctFacts.captured.length === 0 && correctFacts.atari.length === 0;
    if (!katago && correctIsIndirect && !isCorrect) {
      const cannedHint = attemptNumber >= 3
        ? `Not quite — the correct move is ${correctMove}. See the explanation below.`
        : `That's not the key move here. This problem involves positional judgment rather than an immediate capture or atari — look for a move that changes the overall shape or balance.`;
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          correct: false,
          message: cannedHint,
          solution: attemptNumber >= 3 ? problem.solution : null,
        }),
      };
    }

    let katagoContext = '';
    let systemPreamble = '';

    // Problem-type-specific vocabulary and constraints
    const problemTopic = problem.topic || 'life_death';
    const problemTypeSection = problemTopic === 'life_death'
      ? `PROBLEM TYPE: LIFE AND DEATH (tsumego)
This is a closed local problem about group survival. Commentary rules:
- Use life/death vocabulary exclusively: eye space, two eyes, false eye, vital point, ko, seki, miai, liberties.
- Explain the move in terms of how it creates or prevents eyes, or how it reduces/expands the group's liberty count.
- NEVER use territory, fuseki, invasion, or large-scale strategic language. This is a local life/death fight.
- Say "point" or "intersection" — NEVER "square". Go is played on intersections.
- Say "stone" — NEVER "piece".`
      : problemTopic === 'tesuji'
      ? `PROBLEM TYPE: TESUJI
Focus on the specific technique demonstrated (ladder, snapback, squeeze, etc.). Name the tesuji.`
      : `PROBLEM TYPE: ${problemTopic.toUpperCase()}`;

    if (katago) {
      const winPct   = Math.round((katago.winrate ?? 0.5) * 100);
      const scoreStr = katago.scoreLead != null
        ? `, score lead ${katago.scoreLead > 0 ? '+' : ''}${katago.scoreLead.toFixed(1)} pts`
        : '';
      const topMovesStr = formatTopMoves(katago.topMoves, studentMove, toPlayWord);
      const bestMove = katago.topMoves?.[0]?.move;
      const studentRank = katago.topMoves?.findIndex(m => m.move === studentMove) ?? -1;
      const rankStr = studentRank >= 0 ? ` Student's move ranks #${studentRank + 1} of KataGo's top 5.` : '';

      const ownershipFacts = formatOwnershipFacts(katago.ownershipMap, setupStones, boardSize);
      katagoContext = `\nKataGo evaluation after student's move: ${winPct}% for ${toPlayWord}${scoreStr}.${rankStr}\n${topMovesStr}${ownershipFacts ? `\n${ownershipFacts}` : ''}`;

      systemPreamble = `You are a Go tutor explaining KataGo's analysis to a student ranked ${rank}.
GROUNDING RULES:
- Reference ONLY moves and evaluations present in the KataGo data provided below.
- Do NOT invent variations, sequences, or moves not in KataGo's top-5 list.
- Do NOT estimate or fabricate win rates. Use KataGo's numbers exactly.
- The "Verified tactical facts" section is computed by a deterministic rules engine (captures, atari, liberties). These are ground truth. Use them.
- The "KataGo territory ownership" section provides pre-computed ownership per intersection. Use it to ground life/death claims: a stone with >70% ownership by the opponent's color is expected to be dead or captured. Do NOT claim a group is alive or dead unless the ownership data supports it.
- If the data doesn't cover something, say so honestly. Saying less is always better than fabricating.

${problemTypeSection}`;
    } else {
      systemPreamble = `You are a Go tutor evaluating a student's tsumego attempt. Be concise (under 80 words) and honest. No markdown.
KataGo engine data is not available for this position. You may ONLY reference the verified tactical facts below (captures, atari). Do NOT estimate whether this move is strategically good or bad. Do NOT invent win rates or suggest alternative moves. You can describe what the move physically does on the board and nothing more.
If the verified facts show "no immediate captures or atari" for the correct move, you may only confirm the move is correct and state that its strategic value requires engine data to explain.
The "Verified tactical facts" section is computed by a deterministic rules engine and is ground truth.

${problemTypeSection}`;
    }

    let message;
    try {
      message = await callClaude({
        model: CLAUDE_MODEL,
        maxTokens: 200,
        system: `${systemPreamble}

TEACHING CALIBRATION:
- 25k–15k: Simple language. Focus on what happened (captures, atari, eye creation). One concept at a time.
- 15k–5k: Name the tactical concept. For life/death: explain vital points and eye-making/destroying moves.
- 5k–1d+: Full tactical depth. For life/death: discuss miai, ko threats, seki, false eyes. For other types: discuss aji, thickness, direction of play.

RESPONSE STYLE (be concise, under 80 words):
Attempt 1 wrong → Socratic hint toward the key tactical concept. Do not reveal the answer coordinate.
Attempt 2 wrong → More direct hint using the verified facts about the correct move.
Attempt 3+ wrong → State the correct answer and explain it using only the verified facts.
Correct → If verified facts show captures or atari: state them precisely and explain what they mean for the group's survival. If verified facts show no captures or atari: state the move is correct and that it occupies the vital point. STOP THERE. Do NOT add speculative claims about what the opponent "might" do, "options", "ability", or probabilistic outcomes. When the data is indirect, say less — do not pad with inferences you cannot verify. Do NOT add "Well done!", "Great job!", or any generic praise. If the move was correct and the facts are thin, two sentences is enough.`,
        messages: [{
          role: 'user',
          content: `Problem type: ${problemTopic}. Problem: ${problem.description}
Student rank: ${rank}. Attempt #${attemptNumber}.
Student played: ${studentMove}. Correct answer: ${correctMove}.
Move is ${isCorrect ? 'CORRECT' : 'INCORRECT'}.
${roleLabel ? `\n${roleLabel}` : ''}
${premoveContext ? `\n${premoveContext}\n` : ''}
${studentFactsStr}
${isCorrect ? '' : correctFactsStr}${katagoContext}`,
        }],
      });
    } catch (claudeErr) {
      // Claude unavailable — fall back to the deterministic facts we already
      // computed, with an explicit disclaimer. Never a 500 for the student.
      console.error('Claude evaluate-move failed:', claudeErr.message);
      message = isCorrect
        ? `Correct — ${studentMove} is the right move. ${studentFactsStr} (Detailed commentary is temporarily unavailable.)`
        : `${studentMove} is not the solution here. ${studentFactsStr} (Detailed commentary is temporarily unavailable — try the move again or check the explanation once you solve it.)`;
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        correct: isCorrect,
        message,
        solution: isCorrect || attemptNumber >= 3 ? problem.solution : null,
      }),
    };
  } catch (e) {
    console.error('evaluate-move error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
