const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  try {
    const { sgf, boardSize, rank, playerColor } = JSON.parse(event.body);

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 600,
        system: `You are a Go tutor summarizing a student's game. Respond ONLY with valid JSON, no markdown:
{"overallComment":"2-3 sentence assessment","keyMoments":[{"moveNumber":N,"type":"mistake|good|critical","title":"short label","explanation":"1-2 sentences"}],"studyTopic":"one concept to focus on"}`,
        messages: [{ role: 'user', content: `Student rank: ${rank}. Playing as ${playerColor} on ${boardSize}x${boardSize}.\nSGF: ${sgf}` }],
      }),
    });

    const data = await res.json();
    const text = data.content[0].text.replace(/```json|```/g, '').trim();
    const summary = JSON.parse(text);
    return { statusCode: 200, headers, body: JSON.stringify({ summary }) };
  } catch(e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
