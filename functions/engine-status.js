// Netlify function: proxy the katago-service /health endpoint.
// Returns { ok, ready, humanSL } so the frontend can adapt behaviour
// (e.g. skip handicap stones when the human SL model is loaded).

const { corsHeaders } = require('./_auth');

const KATAGO_SERVICE_URL = process.env.KATAGO_SERVICE_URL;
const KATAGO_TOKEN       = process.env.KATAGO_TOKEN;

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  if (!KATAGO_SERVICE_URL) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, ready: false, humanSL: false }) };
  }

  try {
    const res = await fetch(`${KATAGO_SERVICE_URL}/health`, {
      headers: { 'Authorization': `Bearer ${KATAGO_TOKEN}` },
    });
    const data = res.ok ? await res.json() : { ok: false, ready: false, humanSL: false };
    return { statusCode: 200, headers, body: JSON.stringify(data) };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, ready: false, humanSL: false }) };
  }
};
