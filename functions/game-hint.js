const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

const KATAGO_SERVICE_URL = process.env.KATAGO_SERVICE_URL;
const KATAGO_TOKEN       = process.env.KATAGO_TOKEN;

function stonesToGoNotation(stones, size) {
  const COLS = 'ABCDEFGHJKLMNOPQRST';
  const black = [], white = [];
  Object.entries(stones).forEach(([key, color]) => {
    const [c, r] = key.split(',').map(Number);
    const notation = COLS[c] + (size - r);
    if (color === 'B') black.push(notation);
    else white.push(notation);
  });
  return `Black: ${black.join(', ')} | White: ${white.join(', ')}`;
}

// Call KataGo /move to get a position evaluation (winrate + scoreLead).
// We use max strength here for accuracy, then only give winrate/score to Claude
// (not the move itself, so Claude can't accidentally give it away).
async function katagoEval(sgf, playerColor, boardSize) {
  if (!KATAGO_SERVICE_URL || !sgf) return null;
  try {
    const res = await fetch(`${KATAGO_SERVICE_URL}/move`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${KATAGO_TOKEN}`,
      },
      // Use max visits for an accurate eval; rank doesn't matter for analysis
      body: JSON.stringify({ sgf, color: playerColor, boardSize, rank: '1 dan' }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return { winrate: data.winrate, scoreLead: data.scoreLead };
  } catch (e) {
    console.error('KataGo hint eval error:', e.message);
    return null;
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
    const { sgf, boardSize, rank, playerColor, currentStones, moveNumber } = JSON.parse(event.body);

    const katago = await katagoEval(sgf, playerColor, boardSize);

    let katagoContext = '';
    if (katago?.winrate != null) {
      const playerWr  = playerColor === 'B' ? katago.winrate : (1 - katago.winrate);
      const winPct    = Math.round(playerWr * 100);
      const scoreStr  = katago.scoreLead != null
        ? ` Score lead: ${katago.scoreLead > 0 ? '+' : ''}${katago.scoreLead.toFixed(1)} pts for ${katago.scoreLead > 0 ? 'Black' : 'White'}.`
        : '';
      katagoContext = `\nKataGo: ${playerColor === 'B' ? 'Black' : 'White'} (student) is at ${winPct}% winrate.${scoreStr}`;
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 300,
        system: `You are a Go tutor commenting on a live game in progress. You have the stone positions, so you can observe what is actually on the board — groups, connectivity, territory shape, and obvious threats.

Speak only to what you can observe from the position: which groups look thin, which areas are contested, what concept applies here. Do NOT give the exact move. Do NOT claim to know the best line or assert specific tactical sequences you haven't verified. If you're uncertain, point to a general principle rather than a specific claim.

If KataGo winrate data is provided, you may reference the rough game state (e.g. "you're slightly ahead") but do not quote an exact percentage to the student.

Be like a coach watching over their shoulder — honest and grounded, not falsely confident.
Keep it under 80 words. Conversational. No markdown.`,
        messages: [{
          role: 'user',
          content: `Student plays ${playerColor} at ${rank} level. Move ${moveNumber} on ${boardSize}x${boardSize} board.
Current stones in Go notation: ${stonesToGoNotation(currentStones, boardSize)}
SGF: ${sgf || '(early game)'}${katagoContext}
Give position commentary and strategic guidance.`
        }],
      }),
    });

    const data = await res.json();
    return { statusCode: 200, headers, body: JSON.stringify({ commentary: data.content[0].text }) };
  } catch(e) {
    console.error('game-hint error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
