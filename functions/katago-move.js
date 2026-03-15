// Netlify function: get best move from KataGo service
// Drop-in replacement for claude-move.js — same input/output contract.
// Requires env vars: KATAGO_SERVICE_URL, KATAGO_TOKEN

const KATAGO_SERVICE_URL = process.env.KATAGO_SERVICE_URL;
const KATAGO_TOKEN       = process.env.KATAGO_TOKEN;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  if (!KATAGO_SERVICE_URL) {
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'KataGo service not configured' }) };
  }

  try {
    const { sgf, color, boardSize, rank } = JSON.parse(event.body);

    const res = await fetch(`${KATAGO_SERVICE_URL}/move`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${KATAGO_TOKEN}`,
      },
      body: JSON.stringify({ sgf, color, boardSize, rank }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('katago-service /move error:', res.status, err);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'katago-service error' }) };
    }

    const data = await res.json();
    return { statusCode: 200, headers, body: JSON.stringify(data) };

  } catch (e) {
    console.error('katago-move error:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
