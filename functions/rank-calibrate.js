/**
 * rank-calibrate.js
 *
 * Called fire-and-forget after each completed 9x9 standard Go game.
 * Computes a rank estimate from the average absolute winrate swing across
 * the game's turns, then blends it with the player's current rank score.
 *
 * After 5 qualifying games the rank_confidence flips to 'high', allowing
 * the UI to display a specific rank (e.g., "22 kyu") instead of a rough
 * bucket (e.g., "25–21 kyu").
 *
 * Input (POST body):
 *   { turnHistory, boardSize, currentRankScore }
 *   Authorization: Bearer <supabase-jwt>
 *
 * Output:
 *   { updatedRankScore, gamesCalibrated, rankConfidence }
 *   or { skipped: true } if the game is too short to be useful
 */

const { corsHeaders, requireUser } = require('./_auth');

const SUPABASE_URL            = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY;

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  const auth = await requireUser(event);
  if (auth.errorResponse) return auth.errorResponse;
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    // Authenticate the user via their Supabase JWT
    const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Missing token' }) };

    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_SERVICE_KEY,
      },
    });
    if (!userRes.ok) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid token' }) };
    const { id: userId } = await userRes.json();
    if (!userId) return { statusCode: 401, headers, body: JSON.stringify({ error: 'No user id' }) };

    const { turnHistory, boardSize, currentRankScore } = JSON.parse(event.body);

    // Only calibrate on 9x9 games with enough turns to be meaningful
    if (boardSize !== 9 || !Array.isArray(turnHistory) || turnHistory.length < 10) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: true }) };
    }

    // Compute average absolute winrate swing between consecutive turns.
    // Each entry in turnHistory is the state after KataGo has moved, so
    // consecutive deltas capture the combined effect of player + engine moves.
    // The engine contributes roughly constant quality; variance comes mainly
    // from the player, making avgSwing a reasonable skill proxy.
    let swingSum = 0;
    for (let i = 1; i < turnHistory.length; i++) {
      swingSum += Math.abs((turnHistory[i].winrate ?? 0.5) - (turnHistory[i - 1].winrate ?? 0.5));
    }
    const avgSwing = swingSum / (turnHistory.length - 1);

    // Map avgSwing to an estimated rank score.
    // Stronger players maintain their winrate across the game;
    // weaker players produce larger swings per move pair.
    let estimatedScore;
    if      (avgSwing < 0.04) estimatedScore = 2200;  // ~9 kyu and above
    else if (avgSwing < 0.07) estimatedScore = 1750;  // ~15–10 kyu
    else if (avgSwing < 0.11) estimatedScore = 1200;  // ~20–16 kyu
    else if (avgSwing < 0.17) estimatedScore = 700;   // ~25–21 kyu
    else                      estimatedScore = 200;   // ~30–26 kyu

    // Bayesian-style blend: weight existing score heavily so one game
    // can't cause a wild rank jump.
    const newScore = Math.max(0, Math.round((currentRankScore ?? 0) * 0.65 + estimatedScore * 0.35));
    const newRank  = scoreToRank(newScore);

    // Fetch current games_calibrated count
    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=games_calibrated`,
      { headers: sbHeaders() },
    );
    const [profileRow] = await profileRes.json();
    const newGamesCalibrated = ((profileRow?.games_calibrated) ?? 0) + 1;
    const rankConfidence = newGamesCalibrated >= 5 ? 'high' : 'low';

    // Persist the update
    await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}`, {
      method: 'PATCH',
      headers: { ...sbHeaders(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        rank_score:       newScore,
        current_rank:     newRank,
        games_calibrated: newGamesCalibrated,
        rank_confidence:  rankConfidence,
      }),
    });

    // Log to rank history
    await fetch(`${SUPABASE_URL}/rest/v1/rank_history`, {
      method: 'POST',
      headers: { ...sbHeaders(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: userId, rank: newRank, rank_score: newScore }),
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ updatedRankScore: newScore, gamesCalibrated: newGamesCalibrated, rankConfidence }),
    };
  } catch (e) {
    console.error('rank-calibrate error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};

function sbHeaders() {
  return {
    apikey:        SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  };
}

// Mirror of Rank.scoreToRank in supabase-client.js (kept local to avoid a shared module)
function scoreToRank(score) {
  if (score < 3000) {
    const kyu = Math.max(1, 30 - Math.floor(score / 100));
    return `${kyu} kyu`;
  }
  const dan = Math.min(9, Math.floor((score - 3000) / 200) + 1);
  return `${dan} dan`;
}
