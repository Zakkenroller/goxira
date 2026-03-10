const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  try {
    const { rank, topic, boardSize } = JSON.parse(event.body);

    const system = `You are a Go tutor. Generate a Go problem appropriate for the student's level.
Respond ONLY with valid JSON, no other text, no markdown backticks:
{"id":"unique_string","topic":"capture|life-death|ladder|ko|shape","difficulty":1,"boardSize":9,"description":"problem statement","setup":{"stones":{"col,row":"B|W"},"toPlay":"B|W"},"solution":{"move":[col,row],"explanation":"why this works"},"hint":"Socratic hint","wrongMoves":[{"move":[col,row],"explanation":"why wrong"}]}

Use coordinates 0-8 for 9x9. (0,0) is top-left. Keep setups small (6-12 stones).
25-30 kyu: simple captures, atari, 9x9 only.
20-25 kyu: ladders, nets, basic life/death.
15-20 kyu: ko, basic shapes, two eyes.`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 800,
        system,
        messages: [{ role: 'user', content: `Generate a ${topic || 'capture'} problem for a ${rank} player on a ${boardSize || 9}x${boardSize || 9} board.` }],
      }),
    });

    const data = await res.json();
    const text = data.content[0].text.replace(/```json|```/g, '').trim();
    const problem = JSON.parse(text);
    return { statusCode: 200, headers, body: JSON.stringify({ problem }) };
  } catch(e) {
    console.error('problem error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
