const KATAGO_SERVICE_URL = process.env.KATAGO_SERVICE_URL;
const KATAGO_TOKEN       = process.env.KATAGO_TOKEN;

// Fetch per-turn winrate from KataGo. Returns null if unavailable.
async function katagoAnalyze(sgf, boardSize) {
  if (!KATAGO_SERVICE_URL) return null;
  // 14s timeout: full-game analysis with 10 visits × ~20 positions.
  // Only reached when turns are NOT cached (old games, uploaded SGFs, OGS imports).
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), 14000));
  try {
    const fetchResult = fetch(`${KATAGO_SERVICE_URL}/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${KATAGO_TOKEN}`,
      },
      body: JSON.stringify({ sgf, boardSize }),
    }).then(res => res.ok ? res.json() : null).catch(() => null);
    return await Promise.race([fetchResult, timeout]);
  } catch (e) {
    console.error('KataGo analyze error:', e.message);
    return null;
  }
}

// Fetch top 5 candidate moves for a specific position (by SGF truncated to that move).
async function katagoAnalyzePosition(sgf, boardSize, turnNumber, rank) {
  if (!KATAGO_SERVICE_URL) return null;
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), 8000));
  try {
    const fetchResult = fetch(`${KATAGO_SERVICE_URL}/move`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${KATAGO_TOKEN}`,
      },
      body: JSON.stringify({ sgf, color: turnNumber % 2 === 0 ? 'B' : 'W', boardSize, rank }),
    }).then(res => res.ok ? res.json() : null).catch(() => null);
    return await Promise.race([fetchResult, timeout]);
  } catch (e) {
    console.error('KataGo key-moment analysis error:', e.message);
    return null;
  }
}

// Summarise the winrate curve — finds the 3 biggest winrate drops for the player.
function findKeyMoments(turns, playerColor) {
  if (!turns?.length) return { moments: [], finalWr: null, finalScore: null };

  const wr = t => playerColor === 'B' ? (t.winrate ?? 0.5) : (1 - (t.winrate ?? 0.5));

  const drops = [];
  for (let i = 1; i < turns.length; i++) {
    const delta = wr(turns[i]) - wr(turns[i - 1]);
    drops.push({ turn: turns[i].turnNumber, delta, turnData: turns[i] });
  }
  drops.sort((a, b) => a.delta - b.delta); // most negative first

  const moments = drops
    .slice(0, 3)
    .filter(d => d.delta < -0.03); // ignore noise

  const last = turns[turns.length - 1];
  return {
    moments,
    finalWr: Math.round(wr(last) * 100),
    finalScore: last.scoreLead ?? null,
  };
}

// Truncate an SGF to the first N moves.
function truncateSGF(sgf, moveCount) {
  const re = /;[BW]\[[^\]]*\]/g;
  let count = 0;
  let lastIndex = 0;
  let m;
  while ((m = re.exec(sgf)) !== null) {
    count++;
    if (count <= moveCount) lastIndex = m.index + m[0].length;
    else break;
  }
  const body = sgf.slice(sgf.indexOf(';'), lastIndex + 1);
  return '(' + body + ')';
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  try {
    const { sgf, boardSize, rank, playerColor, turns: cachedTurns } = JSON.parse(event.body);

    // If the caller provides pre-computed turns (from live play), use them directly
    // and skip the expensive full-game KataGo /analyze call (14s).
    const katagoResult = cachedTurns?.length
      ? { turns: cachedTurns }
      : await katagoAnalyze(sgf, boardSize);

    // KataGo unavailable — return empty data honestly. Do NOT fabricate.
    if (!katagoResult) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ turns: [], momentDetails: [] }),
      };
    }

    const { moments, finalWr, finalScore } = findKeyMoments(katagoResult.turns, playerColor);

    // Fetch top 5 alternatives for each key moment in parallel (8s timeout each).
    const momentDetails = await Promise.all(moments.map(async ({ turn, delta }) => {
      const truncated = truncateSGF(sgf, turn - 1);
      const analysis = await katagoAnalyzePosition(truncated, boardSize, turn, rank);
      const topMoves = analysis?.analysis?.topMoves || [];
      return {
        turn,
        delta: Math.round(delta * 100),
        topMoves,
      };
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        turns: katagoResult.turns,
        momentDetails,
        finalWr,
        finalScore,
      }),
    };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
