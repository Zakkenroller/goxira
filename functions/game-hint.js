const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

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

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  try {
    const { sgf, boardSize, rank, playerColor, currentStones, moveNumber } = JSON.parse(event.body);

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

Be like a coach watching over their shoulder — honest and grounded, not falsely confident.
Keep it under 80 words. Conversational. No markdown.`,
        messages: [{
          role: 'user',
          content: `Student plays ${playerColor} at ${rank} level. Move ${moveNumber} on ${boardSize}x${boardSize} board.
Current stones in Go notation: ${stonesToGoNotation(currentStones, boardSize)}
SGF: ${sgf || '(early game)'}
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
