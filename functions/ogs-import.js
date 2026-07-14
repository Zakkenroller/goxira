// Netlify function: proxy OGS API calls (search player, list games, fetch SGF).
// Proxied server-side to avoid CORS issues and keep the OGS base URL out of
// client bundles.

const { corsHeaders, requireUser } = require('./_auth');

const OGS = 'https://online-go.com/api/v1';

const headers = corsHeaders();

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  const auth = await requireUser(event);
  if (auth.errorResponse) return auth.errorResponse;

  try {
    const { action, username, gameId } = JSON.parse(event.body || '{}');

    // ── Search player + list recent completed games ───────────────
    if (action === 'search') {
      if (!username) return { statusCode: 400, headers, body: JSON.stringify({ error: 'username required' }) };

      const playerRes  = await fetch(`${OGS}/players/?username=${encodeURIComponent(username)}`);
      const playerData = await playerRes.json();
      const player     = (playerData.results || []).find(
        p => p.username.toLowerCase() === username.toLowerCase()
      );
      if (!player) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Player not found on OGS' }) };

      const gamesRes  = await fetch(`${OGS}/players/${player.id}/games/?page_size=10&ordering=-ended`);
      const gamesData = await gamesRes.json();

      const games = (gamesData.results || [])
        .filter(g => g.ended)   // completed games only
        .map(g => ({
          id:          g.id,
          boardSize:   g.width || 19,
          blackPlayer: g.players?.black?.username || 'Black',
          whitePlayer: g.players?.white?.username || 'White',
          ended:       g.ended,
        }));

      return { statusCode: 200, headers, body: JSON.stringify({ playerId: player.id, games }) };
    }

    // ── Fetch raw SGF for a single game ──────────────────────────
    if (action === 'sgf') {
      if (!gameId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'gameId required' }) };

      const sgfRes = await fetch(`${OGS}/games/${gameId}/sgf`);
      if (!sgfRes.ok) return { statusCode: 404, headers, body: JSON.stringify({ error: 'SGF not found' }) };
      const sgf = await sgfRes.text();
      return { statusCode: 200, headers, body: JSON.stringify({ sgf }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'action must be "search" or "sgf"' }) };

  } catch(e) {
    console.error('ogs-import error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
