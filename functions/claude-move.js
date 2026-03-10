const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  try {
    const { sgf, color, boardSize, rank, currentStones } = JSON.parse(event.body);

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 200,
        system: `You are playing Go. Output ONLY a JSON object. No explanation before or after. No markdown. Just the raw JSON.
Format: {"col": N, "row": N, "thinking": "one short sentence"}
To pass use col:-1 row:-1. Valid coordinates: 0 to ${boardSize - 1}.`,
        messages: [{
          role: 'user',
          content: `Play ${color} on ${boardSize}x${boardSize} board at ${rank} level.
Occupied: ${JSON.stringify(currentStones || {})}
SGF: ${sgf || '(start)'}
Reply with JSON only.`
        },
        {
          role: 'assistant',
          content: '{'
        }],
      }),
    });

    const data = await res.json();
    // Reconstruct — we prefilled the opening brace
    const raw = '{' + data.content[0].text;
    const move = JSON.parse(raw);

    if (move.col !== -1 && (move.col < 0 || move.col >= boardSize || move.row < 0 || move.row >= boardSize)) {
      return { statusCode: 200, headers, body: JSON.stringify({ move: { col: -1, row: -1, thinking: 'I\'ll pass.' } }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ move }) };
  } catch(e) {
    console.error('claude-move error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
