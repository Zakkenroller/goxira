const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  try {
    const { messages, userContext } = JSON.parse(event.body);

    const system = `You are a Go (the board game) tutor running a level assessment for a new student.
Your goal is to accurately determine their playing level through 5-8 targeted questions, then assign a starting rank.

RANKS: 30 kyu (absolute beginner) to 1 kyu to 1 dan (strong amateur).

ASSESSMENT RULES:
- Ask one question at a time. Be conversational and encouraging.
- Start with basic rules knowledge, escalate based on answers.
- After enough information, end with: ASSESSMENT_COMPLETE followed by JSON on its own line:
{"rank": "XX kyu", "rankScore": N, "summary": "brief explanation"}
rankScore: 0 to 2900 (each kyu is about 100 points, 30 kyu = 0, 1 kyu = 2900).

Sample questions by level:
- Basic: What happens when a group of stones has no liberties?
- Capture: What is atari?
- Ko: Have you heard of ko? Can you explain it?
- Life/death: What does it mean for a group to be alive in Go?

Keep responses concise. No markdown formatting.`;

    const contextMsg = userContext ? `The student's name is ${userContext}. ` : '';
    const allMessages = messages.length === 0
      ? [{ role: 'user', content: contextMsg + 'Please start the assessment.' }]
      : messages;

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
        system,
        messages: allMessages,
      }),
    });

    const data = await res.json();
    const text = data.content[0].text;

    if (text.includes('ASSESSMENT_COMPLETE')) {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        const message = text.split('ASSESSMENT_COMPLETE')[0].trim();
        return { statusCode: 200, headers, body: JSON.stringify({ type: 'complete', result, message }) };
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ type: 'question', message: text }) };
  } catch(e) {
    console.error('assess error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
