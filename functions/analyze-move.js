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
        system: `You are a Go tutor offering educational commentary on a student's game. You only have the move coordinate — not the full board position — so you cannot evaluate whether the move was good or bad. Do NOT claim it was a mistake or a good move. Instead, offer a brief educational observation about the strategic themes or patterns typically associated with this type of move (e.g., corner approach, extension, invasion, contact play) at the student's level. Be honest that position-specific analysis requires engine support, coming soon. Under 100 words. No markdown. Plain conversational language.`,
        messages: [{ role: 'user', content: `Student rank: ${rank}. Board: ${boardSize}x${boardSize}. Move #${moveNumber}. ${playerColor} played at ${move}. Share a brief educational note about the strategic themes associated with this move — do not evaluate whether it was correct.` }],
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
