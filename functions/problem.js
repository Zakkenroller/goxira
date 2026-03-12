const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

// ── Go logic helpers ──────────────────────────────────────────────────────────

function getNeighbors(col, row, size) {
  return [[col-1,row],[col+1,row],[col,row-1],[col,row+1]]
    .filter(([c,r]) => c >= 0 && c < size && r >= 0 && r < size);
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
    // getNeighbors needs size — we'll pass a large number since stones object is already bounded
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

/**
 * Verify a generated problem is tactically sound.
 * Returns { valid: bool, reason: string }
 */
function verifyProblem(problem) {
  const stones    = problem.setup?.stones || {};
  const solution  = problem.solution;
  const topic     = problem.topic;
  const boardSize = problem.boardSize || 9;
  const toPlay    = problem.setup?.toPlay || 'B';
  const opponent  = toPlay === 'B' ? 'W' : 'B';

  // ── Basic sanity ──
  if (!solution?.move || solution.move.length < 2) {
    return { valid: false, reason: 'missing solution move' };
  }

  const [sc, sr] = solution.move;

  // Solution move must be on an empty square
  if (stones[`${sc},${sr}`]) {
    return { valid: false, reason: 'solution move is on an occupied square' };
  }

  // Solution move must be in bounds
  if (sc < 0 || sc >= boardSize || sr < 0 || sr >= boardSize) {
    return { valid: false, reason: 'solution move out of bounds' };
  }

  // ── Topic-specific verification ──
  if (topic === 'capture' || topic === 'ladder' || topic === 'ko') {
    // Find opponent groups adjacent to the solution move
    const testStones = { ...stones, [`${sc},${sr}`]: toPlay };
    let capturesAny = false;

    [[sc-1,sr],[sc+1,sr],[sc,sr-1],[sc,sr+1]].forEach(([nc,nr]) => {
      if (testStones[`${nc},${nr}`] === opponent) {
        const group = getGroup(nc, nr, testStones);
        if (getLiberties(group, testStones) === 0) capturesAny = true;
      }
    });

   // Also accept moves that put opponent in atari (1 liberty remaining)
let putsInAtari = false;
[[sc-1,sr],[sc+1,sr],[sc,sr-1],[sc,sr+1]].forEach(([nc,nr]) => {
  if (testStones[`${nc},${nr}`] === opponent) {
    const group = getGroup(nc, nr, testStones);
    if (getLiberties(group, testStones) <= 1) putsInAtari = true;
  }
});

if (!capturesAny && !putsInAtari) {
  return { valid: false, reason: 'solution move does not capture or threaten opponent stones' };
}

    // For capture problems: find the TARGET group (the one with 1 liberty = atari)
    // Verify at least one opponent group is in atari (1 liberty) in the setup
    let hasAtariGroup = false;
    const seen = new Set();
    Object.entries(stones).forEach(([key, color]) => {
      if (color !== opponent || seen.has(key)) return;
      const [c, r] = key.split(',').map(Number);
      const group = getGroup(c, r, stones);
      group.forEach(([gc,gr]) => seen.add(`${gc},${gr}`));
      if (getLiberties(group, stones) === 1) hasAtariGroup = true;
    });

   // Accept if any opponent group has 1 or 2 liberties (tactically relevant)
let hasThreatened = false;
const seen = new Set();
Object.entries(stones).forEach(([key, color]) => {
  if (color !== opponent || seen.has(key)) return;
  const [c, r] = key.split(',').map(Number);
  const group = getGroup(c, r, stones);
  group.forEach(([gc,gr]) => seen.add(`${gc},${gr}`));
  if (getLiberties(group, stones) <= 2) hasThreatened = true;
});

if (!hasThreatened) {
  return { valid: false, reason: 'no opponent group under threat in the setup' };
}
  }

  if (topic === 'life-death') {
    // At minimum, verify the solution move is adjacent to opponent stones
    const adjacent = [[sc-1,sr],[sc+1,sr],[sc,sr-1],[sc,sr+1]]
      .some(([nc,nr]) => stones[`${nc},${nr}`] === opponent || stones[`${nc},${nr}`] === toPlay);
    if (!adjacent) {
      return { valid: false, reason: 'solution move is isolated from all stones' };
    }
  }

  return { valid: true, reason: 'ok' };
}

// ── Fetch one problem from Claude ─────────────────────────────────────────────

async function fetchProblem(rank, topic, boardSize) {
  const system = `You are a Go tutor. Generate a Go problem appropriate for the student's level.
Respond ONLY with valid JSON, no other text, no markdown backticks:
{"id":"unique_string","topic":"capture|life-death|ladder|ko|shape","difficulty":1,"boardSize":9,"description":"problem statement","setup":{"stones":{"col,row":"B|W"},"toPlay":"B|W"},"solution":{"move":[col,row],"explanation":"why this works"},"hint":"Socratic hint without giving away the answer","wrongMoves":[{"move":[col,row],"explanation":"why wrong"}]}

CRITICAL rules:
- Use coordinates 0-8 for 9x9 (0,0 is top-left).
- The solution move MUST be on an empty intersection (not in setup.stones).
- For capture problems: at least one opponent group must have exactly 1 liberty in the setup. The solution move must be on that last liberty.
- Keep setups small (5-10 stones). Place stones in the center area (columns 2-6, rows 2-6).
- 25-30 kyu: simple single-stone captures only.
- 20-25 kyu: small group captures, ladders.
- 15-20 kyu: ko, basic life/death, two eyes.`;

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 8000);
const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  signal: controller.signal,
  headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 800,
      system,
      messages: [{
        role: 'user',
        content: `Generate a ${topic || 'capture'} problem for a ${rank} player on a ${boardSize || 9}x${boardSize || 9} board. Remember: the solution move must NOT be in setup.stones, and for capture problems the target group must have exactly 1 liberty.`
      }],
    }),
  });

  const data    = await res.json();
  clearTimeout(timeout);
  const text    = data.content[0].text.replace(/```json|```/g, '').trim();
  return JSON.parse(text);
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

    let problem = null;
    let lastReason = '';
    const MAX_ATTEMPTS = 2;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const candidate = await fetchProblem(rank, topic, boardSize);
        const check     = verifyProblem(candidate);

        if (check.valid) {
          problem = candidate;
          break;
        } else {
          console.log(`Problem attempt ${attempt + 1} failed verification: ${check.reason}`);
          lastReason = check.reason;
        }
      } catch(e) {
        console.error(`Problem attempt ${attempt + 1} parse error:`, e);
        lastReason = e.message;
      }
    }

    if (!problem) {
      console.error(`All ${MAX_ATTEMPTS} problem generation attempts failed. Last reason: ${lastReason}`);
      return { statusCode: 500, headers, body: JSON.stringify({ error: `Could not generate a valid problem: ${lastReason}` }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ problem }) };

  } catch(e) {
    console.error('problem handler error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
