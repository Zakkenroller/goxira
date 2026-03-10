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
        system: `You are playing Go against a student at approximately their rank level. Make natural moves with occasional mistakes.

Board coordinates: col and row, 0-indexed from top-left. Max index is boardSize-1.
To pass, return col: -1, row: -1.

Respond ONLY with valid JSON, no markdown:
{"col": N, "row": N, "thinking": "one short sentence about your reasoning"}

CRITICAL: Only play on empty intersections. Never repeat a position from the SGF history.`,
        messages: [{
          role: 'user',
          content: `You play ${color} on a ${boardSize}x${boardSize} board. Student rank: ${rank}.
Current occupied stones: ${JSON.stringify(currentStones || {})}
SGF so far: ${sgf || '(game start)'}
Choose your next move. Valid coordinates: 0 to ${boardSize - 1}.`
        }],
      }),
    });

    const data = await res.json();
    const text = data.content[0].text.replace(/```json|```/g, '').trim();
    const move = JSON.parse(text);

    // Validate bounds
    if (move.col !== -1 && (move.col < 0 || move.col >= boardSize || move.row < 0 || move.row >= boardSize)) {
      return { statusCode: 200, headers, body: JSON.stringify({ move: { col: -1, row: -1, thinking: 'I\'ll pass this turn.' } }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ move }) };
  } catch(e) {
    console.error('claude-move error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
