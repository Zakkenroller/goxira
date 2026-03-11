const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

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
        system: `You are a Go tutor commenting on a live game in progress. 
Give the student helpful commentary about the current position — what's the key tension, what area needs attention, what concept applies here. 
Do NOT give the exact move. Be like a coach watching over their shoulder.
Keep it under 80 words. Conversational, encouraging. No markdown.`,
        messages: [{
          role: 'user',
          content: `Student plays ${playerColor} at ${rank} level. Move ${moveNumber} on ${boardSize}x${boardSize} board.
Current stones: ${JSON.stringify(currentStones)}
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
