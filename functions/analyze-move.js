const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  try {
    const { moveNumber, boardSize, rank, move, playerColor } = JSON.parse(event.body);

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 400,
        system: `You are a Go tutor analyzing a move in a student's game. Be specific and concise (under 120 words). No markdown. Plain conversational language.`,
        messages: [{ role: 'user', content: `Student rank: ${rank}. Board: ${boardSize}x${boardSize}. Move #${moveNumber}. ${playerColor} played at ${move}. Was this a good move? What would you recommend instead if it was a mistake?` }],
      }),
    });

    const data = await res.json();
    const message = data.content[0].text;
    const isCritical = /mistake|error|blunder|should have|better move|miss/i.test(message);
    return { statusCode: 200, headers, body: JSON.stringify({ message, isCritical, moveNumber }) };
  } catch(e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
