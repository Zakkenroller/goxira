const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
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

// Deterministic board region from internal coordinates.
// row=0 is the TOP of the board (Go row boardSize), col=0 is the left edge ('A').
function boardRegion(col, row, boardSize) {
  const third = boardSize / 3;
  const vert  = row < third ? 'upper' : row > 2 * third ? 'lower' : 'middle';
  const horiz = col < third ? 'left'  : col > 2 * third ? 'right' : 'center';
  if (horiz === 'center' && vert === 'middle') return 'center of the board';
  if (horiz === 'center') return `${vert} edge`;
  if (vert === 'middle')  return `${horiz} side`;
  return `${vert}-${horiz}`;
}

async function fetchProblemFromDB(difficulty, category, userId, authHeader) {
  const base = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  // If a logged-in user is requesting, try to serve an SRS-due problem first.
  // A problem is "due" when next_review_date <= today.
  if (userId) {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const schedUrl = new URL(`${base}/rest/v1/problem_schedule`);
      schedUrl.searchParams.set('user_id',          `eq.${userId}`);
      schedUrl.searchParams.set('next_review_date', `lte.${today}`);
      schedUrl.searchParams.set('order',            'next_review_date.asc');
      schedUrl.searchParams.set('limit',            '20'); // fetch a batch, pick one matching difficulty
      schedUrl.searchParams.set('select',           'problem_id');

      const schedRes = await fetch(schedUrl.toString(), {
        headers: {
          'apikey':        anonKey,
          'Authorization': authHeader || `Bearer ${anonKey}`,
        },
      });

      if (schedRes.ok) {
        const due = await schedRes.json();
        // Extract raw UUIDs (strip 'db_' prefix)
        const uuids = due
          .map(r => r.problem_id.replace(/^db_/, ''))
          .filter(id => /^[0-9a-f-]{36}$/.test(id));

        if (uuids.length) {
          // Fetch the actual problems for these IDs and filter by difficulty + category
          const inFilter = uuids.map(id => `"${id}"`).join(',');
          const pUrl = new URL(`${base}/rest/v1/tsumego_problems`);
          pUrl.searchParams.set('id',        `in.(${uuids.join(',')})`);
          pUrl.searchParams.set('difficulty', `eq.${difficulty}`);
          if (category) pUrl.searchParams.set('category', `eq.${category}`);
          pUrl.searchParams.set('select',    'id,source,difficulty,board_size,to_play,stones,solution_col,solution_row,category');
          pUrl.searchParams.set('limit',     '1');

          const pRes = await fetch(pUrl.toString(), {
            headers: { 'apikey': anonKey, 'Authorization': `Bearer ${anonKey}` },
          });
          if (pRes.ok) {
            const pRows = await pRes.json();
            if (pRows.length) return pRows[0]; // SRS hit
          }
        }
      }
    } catch (e) {
      // SRS lookup failure is non-fatal — fall through to random selection
      console.warn('SRS lookup failed, falling back to random:', e.message);
    }
  }

  // Helper: fetch with a given offset, returns rows array (may be empty).
  const dbHeaders = { 'apikey': anonKey, 'Authorization': `Bearer ${anonKey}` };
  async function tryFetch(extraParams = {}) {
    const url = new URL(`${base}/rest/v1/tsumego_problems`);
    url.searchParams.set('difficulty', `eq.${difficulty}`);
    if (category) url.searchParams.set('category', `eq.${category}`);
    url.searchParams.set('select', 'id,source,difficulty,board_size,to_play,stones,solution_col,solution_row,category');
    url.searchParams.set('limit', '1');
    for (const [k, v] of Object.entries(extraParams)) url.searchParams.set(k, v);
    const r = await fetch(url.toString(), { headers: dbHeaders });
    if (!r.ok) return null; // signal error (e.g. column doesn't exist)
    return r.json();
  }

  const offset = Math.floor(Math.random() * 300);
  let rows = await tryFetch({ offset: String(offset) });

  // Supabase returned an error (e.g. the category column doesn't exist yet) — drop the
  // category filter and re-query without it so the page at least serves problems.
  if (rows === null && category) {
    category = null;
    rows = await tryFetch({ offset: String(offset) });
    if (rows === null) throw new Error('Supabase error fetching problems');
  }

  // Random offset overshot the available rows — retry from offset 0.
  if (rows !== null && !rows.length && offset > 0) {
    rows = await tryFetch({ offset: '0' });
  }

  // Category filter returned zero problems (e.g. all problems are still tagged life_death).
  // Fall back to all categories so the user at least gets a problem.
  if (!rows.length && category) {
    category = null;
    rows = await tryFetch({ offset: String(Math.floor(Math.random() * 300)) });
    if (!rows.length) rows = await tryFetch({ offset: '0' });
  }

  if (!rows || !rows.length) throw new Error('No problems found for difficulty ' + difficulty);
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

// ── Pre-move full-board liberty analysis ──────────────────────────────────
// Computes liberty counts for all groups on the board BEFORE the move is played.
// Filters to contested groups (≤ 6 liberties) to give Claude grounded context
// for distinguishing attack from defense problems.

function computePremoveContext(stones, toPlay, boardSize) {
  const toPlayWord   = toPlay === 'B' ? 'Black' : 'White';
  const opponentWord = toPlay === 'B' ? 'White' : 'Black';
  const visited = new Set();
  const contested = [];

  for (const key of Object.keys(stones)) {
    if (visited.has(key)) continue;
    const [c, r] = key.split(',').map(Number);
    const group = getGroup(stones, c, r);
    for (const k of group) visited.add(k);
    const libs = getLiberties(stones, group, boardSize);
    if (libs.size > 6) continue;
    const color = stones[key];
    const colorWord = color === toPlay ? toPlayWord : opponentWord;
    const stoneCoords = [...group].map(k => {
      const [gc, gr] = k.split(',').map(Number);
      return toGoNotation(gc, gr, boardSize);
    }).sort().join(', ');
    const libCoords = [...libs].map(k => {
      const [lc, lr] = k.split(',').map(Number);
      return toGoNotation(lc, lr, boardSize);
    }).sort().join(', ');
    contested.push(
      `${colorWord} group [${stoneCoords}]: ${libs.size} libert${libs.size === 1 ? 'y' : 'ies'} (${libCoords})`
    );
  }

  return contested.length
    ? `Pre-move contested groups:\n${contested.join('\n')}`
    : '';
}

// Returns 'attack' if the solution fills a liberty of a low-liberty opponent group,
// 'defense' if adjacent to a low-liberty to-play group, or 'unknown'.
function inferProblemRole(stones, toPlay, solutionCol, solutionRow, boardSize) {
  const opponent = toPlay === 'B' ? 'W' : 'B';
  const solutionKey = `${solutionCol},${solutionRow}`;
  const visited = new Set();

  for (const [key, color] of Object.entries(stones)) {
    if (visited.has(key)) continue;
    const [c, r] = key.split(',').map(Number);
    const group = getGroup(stones, c, r);
    for (const k of group) visited.add(k);
    const libs = getLiberties(stones, group, boardSize);
    if (libs.size > 4) continue;

    if (color === opponent && libs.has(solutionKey)) return 'attack';
    if (color === toPlay) {
      const adj = [
        [solutionCol - 1, solutionRow], [solutionCol + 1, solutionRow],
        [solutionCol, solutionRow - 1], [solutionCol, solutionRow + 1],
      ];
      if (adj.some(([ac, ar]) => group.has(`${ac},${ar}`))) return 'defense';
    }
  }
  return 'unknown';
}

async function enrichWithText(problem, rank) {
  const { board_size, to_play, stones, solution_col, solution_row, category } = problem;

  const toPlayWord   = to_play === 'B' ? 'Black' : 'White';
  const opponentWord = to_play === 'B' ? 'White' : 'Black';
  const solutionNote = toGoNotation(solution_col, solution_row, board_size);
  const region       = boardRegion(solution_col, solution_row, board_size);

  // Compute verified tactical facts for the solution move
  const facts      = analyzeMove(stones, solution_col, solution_row, to_play, board_size);
  const factsStr   = tacticalFactsString(facts, solutionNote, toPlayWord, opponentWord);

  // Pre-move liberty analysis: determines whether this is an attack or defense problem
  const premoveContext = computePremoveContext(stones, to_play, board_size);
  const problemRole    = inferProblemRole(stones, to_play, solution_col, solution_row, board_size);
  const roleLabel = problemRole === 'attack'
    ? `Problem role: ATTACK — ${toPlayWord} is killing the ${opponentWord} group. Describe the task as preventing the ${opponentWord} group from forming two eyes, NOT as ${toPlayWord} creating eyes for itself.`
    : problemRole === 'defense'
    ? `Problem role: DEFENSE — ${toPlayWord} is securing eye space for its own group. Describe the task as ${toPlayWord} making two eyes or finding the vital point to live.`
    : '';

  // Problem-type vocabulary constraints
  const problemCategory = category || 'life_death';
  const categoryInstruction = problemCategory === 'life_death'
    ? `PROBLEM TYPE: LIFE AND DEATH
- The description must frame the task in life/death terms using the Problem role provided. For ATTACK: "find the vital point to kill White", "prevent White from forming two eyes". For DEFENSE: "find the move to live", "secure two eyes". NEVER use territory, invasion, or large-scale strategic language.
- The hint must reference life/death concepts: eye space, vital point, two eyes, ko, miai, liberties.
- The explanation must use life/death vocabulary. If the facts show an immediate capture or atari, explain what that does to the group's eye space or liberty count.
- The "Pre-move contested groups" data is ground truth. Use it to identify which group is in danger and describe the problem accordingly.`
    : problemCategory === 'tesuji'
    ? `PROBLEM TYPE: TESUJI — The description and hint should name the tesuji technique if it is identifiable from the facts.`
    : `PROBLEM TYPE: ${problemCategory.toUpperCase()}`;

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
- The hint must guide toward the concept without giving away the coordinate.
- Board region ("upper-right", "lower edge", etc.) is pre-computed by the server and provided in the user message — use it verbatim. Do NOT re-derive spatial location from the coordinate notation.

${categoryInstruction}`,
        messages: [{
          role: 'user',
          content: `${toPlayWord} to play on a ${board_size}x${board_size} board. Correct move is ${solutionNote} (${region}). Student rank: ${rank}.${roleLabel ? `\n\n${roleLabel}` : ''}${premoveContext ? `\n\n${premoveContext}` : ''}\n\n${factsStr}`,
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
    const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
    const { rank, category, userId } = JSON.parse(event.body);
    const difficulty = rankToDifficulty(rank);

    const row  = await fetchProblemFromDB(difficulty, category || null, userId || null, authHeader);
    const text = await enrichWithText(row, rank || '20 kyu');

    const problem = {
      id:          `db_${row.id}`,
      topic:       row.category || 'life_death',
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
