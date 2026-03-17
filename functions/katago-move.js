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
    const { sgf, color, boardSize, rank, handicapStones, komi } = JSON.parse(event.body);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 22000);

    // Retry once after a short delay if the service responds with an error.
    // This handles the window after a SIGKILL restart where KataGo is still
    // loading but the HTTP server is already accepting connections.
    let res = null;
    const MAX_ATTEMPTS = 2;
    const RETRY_DELAY_MS = 1500;

    try {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        if (attempt > 0) {
          // Brief wait to give KataGo time to finish starting up.
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
          if (controller.signal.aborted) break;
        }

        let r;
        try {
          r = await fetch(`${KATAGO_SERVICE_URL}/move`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${KATAGO_TOKEN}`,
            },
            signal: controller.signal,
            body: JSON.stringify({ sgf, color, boardSize, rank,
              ...(handicapStones?.length ? { handicapStones, komi } : {}),
            }),
          });
        } catch (fetchErr) {
          // AbortError (timeout) or network error — no point retrying.
          throw fetchErr;
        }

        if (r.ok) { res = r; break; }

        const errText = await r.text().catch(() => '');
        console.error(`katago-service /move error (attempt ${attempt + 1}/${MAX_ATTEMPTS}):`, r.status, errText);
        // Only retry on 5xx (service errors); 4xx errors won't recover on retry.
        if (r.status < 500) break;
      }
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'katago-service error' }) };
    }

    const data = await res.json();
    // Pass through the full response including top 5 analysis from KataGo.
    // Downstream callers receive: { move, winrate, scoreLead, analysis: { topMoves, rootWinrate, rootScoreLead } }
    return { statusCode: 200, headers, body: JSON.stringify(data) };

  } catch (e) {
    console.error('katago-move error:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
