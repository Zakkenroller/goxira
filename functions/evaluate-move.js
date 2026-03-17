const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const GOCOLS = 'ABCDEFGHJKLMNOPQRST'; // standard Go notation skips I

const KATAGO_SERVICE_URL = process.env.KATAGO_SERVICE_URL;
const KATAGO_TOKEN       = process.env.KATAGO_TOKEN;

function toGoNotation(col, row, boardSize) {
  return GOCOLS[col] + (boardSize - row);
}

// Convert {col,row: color} stones to KataGo initialStones format [["B","D5"],...]
function stonesToKataGo(stones, boardSize) {
  return Object.entries(stones || {}).map(([key, color]) => {
    const [c, r] = key.split(',').map(Number);
    return [color, GOCOLS[c] + (boardSize - r)];
  });
}

// ── Local Go rules engine ─────────────────────────────────────────────────
// Computes captures and atari states deterministically — no inference needed.
// stones: { "col,row": "B"|"W" }

function getGroup(stones, col, row) {
  const color = stones[`${col},${row}`];
  if (!color) return null;
  const visited = new Set();
  const queue = [[col, row]];
  while (queue.length) {
    const [c, r] = queue.pop();
    const key = `${c},${r}`;
    if (visited.has(key)) continue;
    if (stones[key] !== color) continue;
    visited.add(key);
    queue.push([c - 1, r], [c + 1, r], [c, r - 1], [c, r + 1]);
  }
  return visited;
}

function getLiberties(stones, group, boardSize) {
  const liberties = new Set();
  for (const key of group) {
    const [c, r] = key.split(',').map(Number);
    for (const [nc, nr] of [[c - 1, r], [c + 1, r], [c, r - 1], [c, r + 1]]) {
      if (nc < 0 || nc >= boardSize || nr < 0 || nr >= boardSize) continue;
      if (!stones[`${nc},${nr}`]) liberties.add(`${nc},${nr}`);
    }
  }
  return liberties;
}

// Returns { captured: [{count, notations}], atari: [{count, liberty}] }
// Describes what happens to OPPONENT stones after placing color at (col, row).
function analyzeMove(initialStones, col, row, color, boardSize) {
  const stones = Object.assign({}, initialStones);
  const opponent = color === 'B' ? 'W' : 'B';
  stones[`${col},${row}`] = color;

  const captured = [];
  const visitedCapture = new Set();

  // Identify adjacent opponent groups and check for capture
  for (const [nc, nr] of [[col - 1, row], [col + 1, row], [col, row - 1], [col, row + 1]]) {
    if (nc < 0 || nc >= boardSize || nr < 0 || nr >= boardSize) continue;
    const nkey = `${nc},${nr}`;
    if (stones[nkey] !== opponent || visitedCapture.has(nkey)) continue;
    const group = getGroup(stones, nc, nr);
    for (const k of group) visitedCapture.add(k);
    if (getLiberties(stones, group, boardSize).size === 0) {
      const notations = [...group].map(k => {
        const [gc, gr] = k.split(',').map(Number);
        return toGoNotation(gc, gr, boardSize);
      }).sort();
      captured.push({ count: group.size, notations });
      for (const k of group) delete stones[k]; // remove captured stones
    }
  }

  // After captures, identify adjacent opponent groups in atari (1 liberty)
  const atari = [];
  const visitedAtari = new Set();
  for (const [nc, nr] of [[col - 1, row], [col + 1, row], [col, row - 1], [col, row + 1]]) {
    if (nc < 0 || nc >= boardSize || nr < 0 || nr >= boardSize) continue;
    const nkey = `${nc},${nr}`;
    if (stones[nkey] !== opponent || visitedAtari.has(nkey)) continue;
    const group = getGroup(stones, nc, nr);
    for (const k of group) visitedAtari.add(k);
    const libs = getLiberties(stones, group, boardSize);
    if (libs.size === 1) {
      const [lc, lr] = [...libs][0].split(',').map(Number);
      atari.push({ count: group.size, liberty: toGoNotation(lc, lr, boardSize) });
    }
  }

  return { captured, atari };
}

function tacticalFactsString(result, moveNotation, toPlayWord, opponentWord) {
  const parts = [];
  for (const g of result.captured) {
    parts.push(
      `${toPlayWord} captures ${g.count} ${opponentWord} stone${g.count > 1 ? 's' : ''} (at ${g.notations.join(', ')})`
    );
  }
  for (const g of result.atari) {
    parts.push(
      `puts ${g.count} ${opponentWord} stone${g.count > 1 ? 's' : ''} in atari — 1 liberty remaining at ${g.liberty}`
    );
  }
  if (!parts.length) parts.push('no immediate captures or atari');
  return `Verified board facts after ${moveNotation}: ${parts.join('; ')}.`;
}

// ── KataGo: top-5 position evaluation ────────────────────────────────────
// Returns { winrate, scoreLead, bestMove, topMoves } or null if KataGo unavailable.
async function katagoEval(initialStones, playerMove, boardSize) {
  if (!KATAGO_SERVICE_URL) return null;
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), 6000));
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

function formatTopMoves(topMoves, studentMove, toPlayWord) {
  if (!topMoves?.length) return '';
  const lines = topMoves.map((m, i) => {
    const winPct = Math.round((m.winrate ?? 0) * 100);
    const score = m.scoreLead != null ? `, score ${m.scoreLead > 0 ? '+' : ''}${m.scoreLead.toFixed(1)}` : '';
    const pv = m.pv?.length ? ` (sequence: ${m.pv.join(', ')})` : '';
    const marker = m.move === studentMove ? ' ← student\'s move' : '';
    return `  ${i + 1}. ${m.move}: ${winPct}% for ${toPlayWord}${score}${pv}${marker}`;
  });
  return `KataGo top-5 candidate moves:\n${lines.join('\n')}`;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

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

    // ── KataGo: top 5 candidate moves with principal variations ──
    const katagoStones = stonesToKataGo(setupStones, boardSize);
    const katago       = await katagoEval(katagoStones, [toPlay, studentMove], boardSize);

    let katagoContext = '';
    let systemPreamble = '';

    if (katago) {
      const winPct   = Math.round((katago.winrate ?? 0.5) * 100);
      const scoreStr = katago.scoreLead != null
        ? `, score lead ${katago.scoreLead > 0 ? '+' : ''}${katago.scoreLead.toFixed(1)} pts`
        : '';
      const topMovesStr = formatTopMoves(katago.topMoves, studentMove, toPlayWord);
      const bestMove = katago.topMoves?.[0]?.move;
      const studentRank = katago.topMoves?.findIndex(m => m.move === studentMove) ?? -1;
      const rankStr = studentRank >= 0 ? ` Student's move ranks #${studentRank + 1} of KataGo's top 5.` : '';

      katagoContext = `\nKataGo evaluation after student's move: ${winPct}% for ${toPlayWord}${scoreStr}.${rankStr}\n${topMovesStr}`;

      systemPreamble = `You are a Go tutor explaining KataGo's analysis to a student ranked ${rank}.
GROUNDING RULES:
- Reference ONLY moves and evaluations present in the KataGo data provided below.
- Do NOT invent variations, sequences, or moves not in KataGo's top-5 list.
- Do NOT estimate or fabricate win rates. Use KataGo's numbers exactly.
- The "Verified tactical facts" section is computed by a deterministic rules engine (captures, atari, liberties). These are ground truth. Use them.
- If the data doesn't cover something, say so honestly. Saying less is always better than fabricating.`;
    } else {
      systemPreamble = `You are a Go tutor evaluating a student's tsumego attempt. Be concise (under 80 words) and honest. No markdown.
KataGo engine data is not available for this position. You may ONLY reference the verified tactical facts below (captures, atari). Do NOT estimate whether this move is strategically good or bad. Do NOT invent win rates or suggest alternative moves. You can describe what the move physically does on the board and nothing more.
The "Verified tactical facts" section is computed by a deterministic rules engine and is ground truth.`;
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 200,
        system: `${systemPreamble}

TEACHING CALIBRATION:
- 25k–15k: Simple language. Focus on what happened tactically (captures, escapes). One concept at a time.
- 15k–5k: Introduce strategic reasoning. Explain why a move is directionally wrong. Reference shapes and patterns by name.
- 5k–1d+: Full strategic discussion. Discuss aji, thickness, direction of play. Reference joseki and fuseki concepts where relevant.

RESPONSE STYLE (be concise, under 80 words):
Attempt 1 wrong → Socratic hint toward the key tactical concept. Do not reveal the answer coordinate.
Attempt 2 wrong → More direct hint using the verified facts about the correct move.
Attempt 3+ wrong → State the correct answer and explain it using only the verified facts.
Correct → Confirm using the verified facts for why the move works.`,
        messages: [{
          role: 'user',
          content: `Problem: ${problem.description}
Student rank: ${rank}. Attempt #${attemptNumber}.
Student played: ${studentMove}. Correct answer: ${correctMove}.
Move is ${isCorrect ? 'CORRECT' : 'INCORRECT'}.

${studentFactsStr}
${isCorrect ? '' : correctFactsStr}${katagoContext}`,
        }],
      }),
    });

    const data    = await res.json();
    const message = data.content[0].text;

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
