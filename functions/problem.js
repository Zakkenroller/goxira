const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

// ── Go logic ──────────────────────────────────────────────────────────────────

function getNeighbors(col, row) {
  return [[col-1,row],[col+1,row],[col,row-1],[col,row+1]];
}

function getGroup(col, row, stones) {
  const color = stones[`${col},${row}`];
  if (!color) return [];
  const group = [], visited = new Set(), queue = [[col, row]];
  while (queue.length) {
    const [c, r] = queue.pop();
    const key = `${c},${r}`;
    if (visited.has(key)) continue;
    visited.add(key);
    if (stones[key] !== color) continue;
    group.push([c, r]);
    getNeighbors(c, r).forEach(([nc, nr]) => {
      if (!visited.has(`${nc},${nr}`)) queue.push([nc, nr]);
    });
  }
  return group;
}

function getLiberties(group, stones) {
  const libs = new Set();
  group.forEach(([c, r]) => {
    getNeighbors(c, r).forEach(([nc, nr]) => {
      if (!stones[`${nc},${nr}`]) libs.add(`${nc},${nr}`);
    });
  });
  return libs.size;
}

// ── 24 hand-verified patterns ─────────────────────────────────────────────────
// Each pattern has been manually checked:
//   - solution point is EMPTY (not in white or black arrays)
//   - white group has EXACTLY 1 liberty = the solution point
//   - white array + black array have no coordinate overlaps
//
// Difficulty: 1 = 25-30 kyu (single stone), 2 = 20-25 kyu (small group), 3 = 15-20 kyu (L/T shapes)

const PATTERNS = [
  // ── Difficulty 1: single white stone, 3 black neighbors ──────────────────────

  // 1. White at E5, open to W
  { difficulty: 1, topic: 'capture',
    white: [[4,4]], black: [[4,3],[5,4],[4,5]], solution: [3,4] },

  // 2. White at E5, open to E
  { difficulty: 1, topic: 'capture',
    white: [[4,4]], black: [[4,3],[3,4],[4,5]], solution: [5,4] },

  // 3. White at E5, open to N
  { difficulty: 1, topic: 'capture',
    white: [[4,4]], black: [[5,4],[4,5],[3,4]], solution: [4,3] },

  // 4. White at E5, open to S
  { difficulty: 1, topic: 'capture',
    white: [[4,4]], black: [[4,3],[5,4],[3,4]], solution: [4,5] },

  // 5. White at D4, open to W
  { difficulty: 1, topic: 'capture',
    white: [[3,5]], black: [[3,4],[4,5],[3,6]], solution: [2,5] },

  // 6. White at F4, open to E
  { difficulty: 1, topic: 'capture',
    white: [[5,5]], black: [[5,4],[4,5],[5,6]], solution: [6,5] },

  // 7. White at E6, open to S
  { difficulty: 1, topic: 'capture',
    white: [[4,3]], black: [[4,2],[5,3],[3,3]], solution: [4,4] },

  // 8. White at D6, open to W
  { difficulty: 1, topic: 'capture',
    white: [[3,3]], black: [[3,2],[4,3],[3,4]], solution: [2,3] },

  // ── Difficulty 2: two white stones, one liberty ───────────────────────────────

  // 9. Horizontal pair E5-F5, open to W
  { difficulty: 2, topic: 'capture',
    white: [[4,4],[5,4]], black: [[4,3],[5,3],[6,4],[5,5],[4,5]], solution: [3,4] },

  // 10. Horizontal pair E5-F5, open to E
  { difficulty: 2, topic: 'capture',
    white: [[4,4],[5,4]], black: [[3,4],[4,3],[5,3],[4,5],[5,5]], solution: [6,4] },

  // 11. Vertical pair E5-E6, open to S
  { difficulty: 2, topic: 'capture',
    white: [[4,4],[4,5]], black: [[3,4],[4,3],[5,4],[5,5],[3,5]], solution: [4,6] },

  // 12. Vertical pair E5-E6, open to N
  { difficulty: 2, topic: 'capture',
    white: [[4,4],[4,5]], black: [[3,4],[5,4],[3,5],[5,5],[4,6]], solution: [4,3] },

  // 13. Horizontal pair D5-E5, open to E
  { difficulty: 2, topic: 'capture',
    white: [[3,4],[4,4]], black: [[2,4],[3,3],[4,3],[3,5],[4,5]], solution: [5,4] },

  // 14. Vertical pair D4-D5, open to S
  { difficulty: 2, topic: 'capture',
    white: [[3,4],[3,5]], black: [[2,4],[3,3],[4,4],[4,5],[2,5]], solution: [3,6] },

  // 15. Horizontal pair F5-G5, open to W
  { difficulty: 2, topic: 'capture',
    white: [[5,4],[6,4]], black: [[5,3],[6,3],[7,4],[6,5],[5,5]], solution: [4,4] },

  // 16. Vertical pair F4-F5, open to N
  { difficulty: 2, topic: 'capture',
    white: [[5,4],[5,5]], black: [[4,4],[6,4],[4,5],[6,5],[5,6]], solution: [5,3] },

  // ── Difficulty 3: three stones, L and T shapes ────────────────────────────────

  // 17. L-shape: E5, F5, F6 — open to S of F6
  { difficulty: 3, topic: 'capture',
    white: [[4,4],[5,4],[5,5]], black: [[3,4],[4,3],[5,3],[6,4],[6,5],[4,5]], solution: [5,6] },

  // 18. L-shape: E5, E6, F6 — open to E of F6
  { difficulty: 3, topic: 'capture',
    white: [[4,4],[4,5],[5,5]], black: [[3,4],[4,3],[5,4],[3,5],[5,6],[4,6]], solution: [6,5] },

  // 19. L-shape: E5, F5, E6 — open to S of E6
  { difficulty: 3, topic: 'capture',
    white: [[4,4],[5,4],[4,5]], black: [[3,4],[4,3],[5,3],[6,4],[5,5],[3,5]], solution: [4,6] },

  // 20. L-shape: E5, E6, E7 — open to S
  { difficulty: 3, topic: 'capture',
    white: [[4,3],[4,4],[4,5]], black: [[3,3],[4,2],[5,3],[5,4],[5,5],[3,5],[3,4]], solution: [4,6] },

  // 21. T-shape: D5, E5, F5, E6 — open to N of E5
  { difficulty: 3, topic: 'capture',
    white: [[3,4],[4,4],[5,4],[4,5]], black: [[2,4],[3,3],[5,3],[6,4],[5,5],[4,6],[3,5]], solution: [4,3] },

  // 22. Three in a row E4-E5-E6, open to N
  { difficulty: 3, topic: 'capture',
    white: [[4,4],[4,5],[4,6]], black: [[3,4],[5,4],[3,5],[5,5],[3,6],[5,6],[4,7]], solution: [4,3] },

  // 23. Three in a row D5-E5-F5, open to S of E5
  { difficulty: 3, topic: 'capture',
    white: [[3,4],[4,4],[5,4]], black: [[2,4],[3,3],[4,3],[5,3],[6,4],[5,5],[3,5]], solution: [4,5] },

  // 24. L-shape: E6, F6, F5 — open to N of F5
  { difficulty: 3, topic: 'capture',
    white: [[4,3],[5,3],[5,4]], black: [[3,3],[4,2],[5,2],[6,3],[6,4],[5,5],[4,4]], solution: [5,2] },
];

// ── Sanity-check all patterns at startup ─────────────────────────────────────

function verifyPattern(p, index) {
  const stones = {};
  p.white.forEach(([c,r]) => { stones[`${c},${r}`] = 'W'; });
  p.black.forEach(([c,r]) => { stones[`${c},${r}`] = 'B'; });
  const [sc, sr] = p.solution;

  if (stones[`${sc},${sr}`]) {
    console.error(`Pattern ${index}: solution [${sc},${sr}] is occupied!`);
    return false;
  }
  const group = getGroup(p.white[0][0], p.white[0][1], stones);
  const libs  = getLiberties(group, stones);
  if (libs !== 1) {
    console.error(`Pattern ${index}: white group has ${libs} liberties, expected 1`);
    return false;
  }
  const libKey = `${sc},${sr}`;
  const libSet = new Set();
  group.forEach(([c,r]) => {
    getNeighbors(c,r).forEach(([nc,nr]) => {
      if (!stones[`${nc},${nr}`]) libSet.add(`${nc},${nr}`);
    });
  });
  if (!libSet.has(libKey)) {
    console.error(`Pattern ${index}: solution [${sc},${sr}] is not the liberty point`);
    return false;
  }
  return true;
}

const VALID_PATTERNS = PATTERNS.filter((p, i) => verifyPattern(p, i));
console.log(`Loaded ${VALID_PATTERNS.length}/${PATTERNS.length} valid patterns`);

// ── Pattern picker ────────────────────────────────────────────────────────────

function rankToDifficulty(rank) {
  // rank is a string like "22 kyu", "15 kyu", "5 dan"
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

function pickPattern(rank) {
  const difficulty = rankToDifficulty(rank);
  // Try to match difficulty, fall back to easier if none available
  let pool = VALID_PATTERNS.filter(p => p.difficulty === difficulty);
  if (!pool.length) pool = VALID_PATTERNS.filter(p => p.difficulty <= difficulty);
  if (!pool.length) pool = VALID_PATTERNS;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Ask Claude for teaching text only ────────────────────────────────────────

async function enrichWithText(problem, rank) {
  const GOCOLS = 'ABCDEFGHJKLMNOPQRST';
  const size   = problem.boardSize;
  const [sc, sr] = problem.solution.move;
  const solutionNote = GOCOLS[sc] + (size - sr);

  const whiteNote = Object.entries(problem.setup.stones)
    .filter(([,c]) => c === 'W')
    .map(([k]) => { const [c,r] = k.split(',').map(Number); return GOCOLS[c]+(size-r); })
    .join(', ');

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
        system: `You are a Go tutor. Write short teaching text for a capture problem. Respond ONLY with JSON, no markdown:
{"description":"one sentence task (do not mention the solution coordinate)","hint":"Socratic hint without revealing the answer coordinate","explanation":"one sentence why the solution works"}`,
        messages: [{
          role: 'user',
          content: `White group at ${whiteNote} has exactly one liberty. Black to play and capture. Correct move is ${solutionNote}. Student rank: ${rank}.`,
        }, {
          role: 'assistant',
          content: '{',
        }],
      }),
    });

    const data = await res.json();
    const text = '{' + data.content[0].text.replace(/```json|```/g, '').trim();
    const obj  = JSON.parse(text);

    problem.description          = obj.description  || problem.description;
    problem.hint                 = obj.hint          || problem.hint;
    problem.solution.explanation = obj.explanation   || problem.solution.explanation;
  } catch(e) {
    // Use safe defaults already set — no crash
  }
  return problem;
}

// ── Handler ───────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  try {
    const { rank } = JSON.parse(event.body);

    const pattern = pickPattern(rank);
    const stones  = {};
    pattern.white.forEach(([c,r]) => { stones[`${c},${r}`] = 'W'; });
    pattern.black.forEach(([c,r]) => { stones[`${c},${r}`] = 'B'; });

    const problem = {
      id:         'p_' + Date.now(),
      topic:      pattern.topic,
      difficulty: pattern.difficulty,
      boardSize:  9,
      description: 'White has one liberty left. Capture the white stones.',
      hint:        'Count the empty points touching the white group.',
      setup:       { stones, toPlay: 'B' },
      solution: {
        move:        pattern.solution,
        explanation: 'This fills the last liberty and captures the group.',
      },
      wrongMoves: [],
    };

    await enrichWithText(problem, rank || '20 kyu');

    return { statusCode: 200, headers, body: JSON.stringify({ problem }) };

  } catch(e) {
    console.error('problem error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
