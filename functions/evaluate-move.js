const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const GOCOLS = 'ABCDEFGHJKLMNOPQRST'; // standard Go notation skips I

const KATAGO_SERVICE_URL = process.env.KATAGO_SERVICE_URL;
const KATAGO_TOKEN       = process.env.KATAGO_TOKEN;

function toGoNotation(col, row, boardSize) {
  return GOCOLS[col] + (boardSize - row);
}

function stonesToGoNotation(stones, boardSize) {
  const black = [], white = [];
  Object.entries(stones || {}).forEach(([key, color]) => {
    const [c, r] = key.split(',').map(Number);
    const n = toGoNotation(c, r, boardSize);
    if (color === 'B') black.push(n);
    else white.push(n);
  });
  return `Black: ${black.join(', ') || 'none'} | White: ${white.join(', ') || 'none'}`;
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

// ── KataGo: objective position evaluation ────────────────────────────────
// Returns { winrate, scoreLead, bestMove } or null if KataGo unavailable.
async function katagoEval(initialStones, playerMove, boardSize) {
  if (!KATAGO_SERVICE_URL) return null;
  try {
    const res = await fetch(`${KATAGO_SERVICE_URL}/analyze-position`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${KATAGO_TOKEN}`,
      },
      body: JSON.stringify({ initialStones, moves: [playerMove], boardSize }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error('KataGo eval error:', e.message);
    return null;
  }
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

    // ── KataGo: win probability and score (async, non-blocking) ──
    const katagoStones = stonesToKataGo(setupStones, boardSize);
    const katago       = await katagoEval(katagoStones, [toPlay, studentMove], boardSize);

    let katagoContext = '';
    if (katago) {
      const winPct   = Math.round((katago.winrate ?? 0.5) * 100);
      const scoreStr = katago.scoreLead != null
        ? `, score lead ${katago.scoreLead > 0 ? '+' : ''}${katago.scoreLead.toFixed(1)} pts`
        : '';
      const bestStr  = (katago.bestMove && katago.bestMove !== studentMove)
        ? ` KataGo's preferred move: ${katago.bestMove}.`
        : '';
      katagoContext = `\nKataGo evaluation after student's move: ${winPct}% for ${toPlayWord}${scoreStr}.${bestStr}`;
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
        max_tokens: 150,
        system: `You are a Go tutor evaluating a student's tsumego attempt. Be concise (under 80 words) and honest. No markdown.

ACCURACY CONTRACT — READ THIS FIRST:
Verified board facts are computed by a deterministic rules engine and provided below. These are ground truth.
- Use the verified facts to make specific tactical statements (captures, atari, liberties).
- Do NOT make any tactical claim not present in the verified facts. No inventing captures, atari, or variations.
- If KataGo evaluation is provided, use its numbers verbatim. Do not contradict them.

RESPONSE STYLE:
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
