const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

// ── Lightweight server-side verification ─────────────────────────────────────

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
    [[c-1,r],[c+1,r],[c,r-1],[c,r+1]].forEach(([nc,nr]) => {
      if (!visited.has(`${nc},${nr}`)) queue.push([nc, nr]);
    });
  }
  return group;
}

function getLiberties(group, stones) {
  const libs = new Set();
  group.forEach(([c, r]) => {
    [[c-1,r],[c+1,r],[c,r-1],[c,r+1]].forEach(([nc,nr]) => {
      if (!stones[`${nc},${nr}`]) libs.add(`${nc},${nr}`);
    });
  });
  return libs.size;
}

function verifyProblem(problem) {
  const stones   = problem.setup?.stones || {};
  const solution = problem.solution;
  const boardSize = problem.boardSize || 9;
  const toPlay   = problem.setup?.toPlay || 'B';
  const opponent = toPlay === 'B' ? 'W' : 'B';

  if (!solution?.move || solution.move.length < 2) return false;
  const [sc, sr] = solution.move;

  // Solution must be empty
  if (stones[`${sc},${sr}`]) return false;
  // Solution must be in bounds
  if (sc < 0 || sc >= boardSize || sr < 0 || sr >= boardSize) return false;

  // For capture/ladder/ko: solution must capture or put in atari
  if (['capture','ladder','ko'].includes(problem.topic)) {
    const testStones = { ...stones, [`${sc},${sr}`]: toPlay };
    let valid = false;
    [[sc-1,sr],[sc+1,sr],[sc,sr-1],[sc,sr+1]].forEach(([nc,nr]) => {
      if (testStones[`${nc},${nr}`] === opponent) {
        const g = getGroup(nc, nr, testStones);
        if (getLiberties(g, testStones) <= 1) valid = true;
      }
    });
    if (!valid) return false;
  }

  return true;
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
    const { rank, topic, boardSize } = JSON.parse(event.body);
    const size = boardSize || 9;

    const system = `You are a Go tutor generating a tactical problem. Follow these rules EXACTLY:

1. Pick a simple capture scenario: place 2-4 WHITE stones in a group near the center with exactly ONE liberty remaining.
2. Leave that last liberty EMPTY — that is the solution move for BLACK.
3. Surround the white group with black stones on all other sides.
4. The solution move[col,row] MUST be the empty liberty point.
5. Double-check: count the liberties of the white group. It must be exactly 1.

Respond ONLY with this JSON, no markdown:
{"id":"p1","topic":"capture","difficulty":1,"boardSize":${size},"description":"White has one liberty left. Capture the white stones.","setup":{"stones":{"col,row":"B|W"},"toPlay":"B"},"solution":{"move":[col,row],"explanation":"This fills White's last liberty and captures the group."},"hint":"How many liberties does the white group have?","wrongMoves":[]}

Use coordinates 0-${size-1}. Place everything in the middle of the board (columns 2-6).`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 600,
        system,
        messages: [{
          role: 'user',
          content: `Generate a capture problem for a ${rank} player. White group must have exactly 1 liberty. Solution move must be on that empty liberty.`
        }, {
          role: 'assistant',
          content: '{'
        }],
      }),
    });

    const data    = await res.json();
    const text    = '{' + data.content[0].text.replace(/```json|```/g, '').trim();
    const problem = JSON.parse(text);

    // Quick verification
    if (!verifyProblem(problem)) {
      console.error('Problem failed verification:', JSON.stringify(problem));
      // Return it anyway with a warning — better than a 500
      problem._unverified = true;
    }

    return { statusCode: 200, headers, body: JSON.stringify({ problem }) };

  } catch(e) {
    console.error('problem error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
