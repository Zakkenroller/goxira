const CLAUDE_MODEL = 'claude-sonnet-4-6';
const GOCOLS = 'ABCDEFGHJKLMNOPQRST';

function rankToDifficulty(rank) {
  if (!rank) return 1;
  const lower = rank.toLowerCase();
  if (lower.includes('dan')) return 3;
  const match = lower.match(/(\d+)/);
  if (!match) return 1;
  const kyu = parseInt(match[1]);
  if (kyu >= 20) return 1;
  if (kyu >= 10) return 2;
  return 3;
}

function toGoNotation(col, row, boardSize) {
  return GOCOLS[col] + (boardSize - row);
}

async function fetchProblemFromDB(difficulty) {
  const url = new URL(`${process.env.SUPABASE_URL}/rest/v1/tsumego_problems`);
  url.searchParams.set('difficulty', `eq.${difficulty}`);
  url.searchParams.set('select', 'id,source,difficulty,board_size,to_play,stones,solution_col,solution_row');
  url.searchParams.set('limit', '1');
  const offset = Math.floor(Math.random() * 300);
  url.searchParams.set('offset', String(offset));

  const res = await fetch(url.toString(), {
    headers: {
      'apikey': process.env.SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
    },
  });

  if (!res.ok) throw new Error(`Supabase error: ${res.status}`);
  const rows = await res.json();
  if (!rows.length) throw new Error('No problems found for difficulty ' + difficulty);
  return rows[0];
}

// ── Local Go rules engine ─────────────────────────────────────────────────
// Gives Claude verified ground truth so explanations are factually correct.

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
function analyzeMove(initialStones, col, row, color, boardSize) {
  const stones = Object.assign({}, initialStones);
  const opponent = color === 'B' ? 'W' : 'B';
  stones[`${col},${row}`] = color;

  const captured = [];
  const visitedCapture = new Set();

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
      for (const k of group) delete stones[k];
    }
  }

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
  if (!parts.length) parts.push('no immediate captures or atari (indirect threat or setup move)');
  return `Verified board facts after ${moveNotation}: ${parts.join('; ')}.`;
}

async function enrichWithText(problem, rank) {
  const { board_size, to_play, stones, solution_col, solution_row } = problem;

  const toPlayWord   = to_play === 'B' ? 'Black' : 'White';
  const opponentWord = to_play === 'B' ? 'White' : 'Black';
  const solutionNote = toGoNotation(solution_col, solution_row, board_size);

  // Compute verified tactical facts for the solution move
  const facts      = analyzeMove(stones, solution_col, solution_row, to_play, board_size);
  const factsStr   = tacticalFactsString(facts, solutionNote, toPlayWord, opponentWord);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 250,
        system: `You are a Go tutor. Write short teaching text for a tsumego problem. Respond with a single valid JSON object and nothing else. Do not use markdown code fences. Use this exact shape:
{"description":"one sentence describing the task for ${toPlayWord} to play","hint":"Socratic hint pointing to the key tactical idea without revealing the answer coordinate","explanation":"one or two sentences explaining why ${solutionNote} is correct — use ONLY the verified board facts provided, do not add or invent anything"}

ACCURACY CONTRACT:
Verified board facts are computed by a deterministic rules engine. They are ground truth.
- The explanation MUST be grounded in and consistent with the provided facts.
- Do NOT add tactical claims beyond the facts (no invented liberty counts, alternative moves, or continuations).
- The hint must guide toward the concept without giving away the coordinate.`,
        messages: [{
          role: 'user',
          content: `${toPlayWord} to play on a ${board_size}x${board_size} board. Correct move is ${solutionNote}. Student rank: ${rank}.\n\n${factsStr}`,
        }],
      }),
    });

    if (!res.ok) throw new Error(`Claude API error ${res.status}`);
    const data = await res.json();
    const raw = data.content[0].text.replace(/^```(?:json)?\n?|\n?```$/g, '').trim();
    return JSON.parse(raw);
  } catch (e) {
    // Safe fallback: use the raw facts directly, no LLM required
    const fallbackExplanation = facts.captured.length
      ? `Playing at ${solutionNote} captures ${facts.captured[0].count} ${opponentWord} stone${facts.captured[0].count > 1 ? 's' : ''}.`
      : facts.atari.length
      ? `Playing at ${solutionNote} puts ${facts.atari[0].count} ${opponentWord} stone${facts.atari[0].count > 1 ? 's' : ''} in atari.`
      : `Playing at ${solutionNote} is the key forcing move.`;
    return {
      description: `${toPlayWord} to play — find the key move.`,
      hint:        'Look for the vital point of the position.',
      explanation: fallbackExplanation,
    };
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
    const { rank } = JSON.parse(event.body);
    const difficulty = rankToDifficulty(rank);

    const row  = await fetchProblemFromDB(difficulty);
    const text = await enrichWithText(row, rank || '20 kyu');

    const problem = {
      id:          `db_${row.id}`,
      topic:       'capture',
      difficulty:  row.difficulty,
      boardSize:   row.board_size,
      description: text.description,
      hint:        text.hint,
      setup: {
        stones:  row.stones,
        toPlay:  row.to_play,
      },
      solution: {
        move:        [row.solution_col, row.solution_row],
        explanation: text.explanation,
      },
      wrongMoves: [],
    };

    return { statusCode: 200, headers, body: JSON.stringify({ problem }) };

  } catch (e) {
    console.error('problem error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
