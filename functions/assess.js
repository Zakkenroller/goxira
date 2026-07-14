const CLAUDE_MODEL = 'claude-sonnet-4-6';

const { callClaude } = require('./_claude');
const { corsHeaders, requireUser } = require('./_auth');

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  const auth = await requireUser(event);
  if (auth.errorResponse) return auth.errorResponse;

  try {
    const { messages, userContext } = JSON.parse(event.body);

    const system = `You are a Go (the board game) tutor running a quick level assessment for a new student.
Your goal is to place the student into a rough skill bucket using 3–5 targeted questions. Be warm and brief.

BUCKETS — output one of these exactly in the result JSON:
  "30-26 kyu"       Absolute Beginner: doesn't know basic captures or liberties yet
  "25-21 kyu"       Beginner: understands captures but not ladders or two-eyes
  "20-16 kyu"       Novice: plays full 19x19 games, knows a few joseki
  "15-10 kyu"       Advanced DDK: consistent shape, basic fighting, positional judgment
  "9 kyu and above" Experienced: stronger than double-digit kyu

QUESTION FLOW (ask in order, stop as soon as you can assign a bucket):
1. Have you played Go before? → No means "30-26 kyu", stop.
2. Do you know what a ladder is, and what two eyes are? → No means "25-21 kyu", stop.
3. Have you played full games on a 19x19 board? → No means "25-21 kyu", stop.
4. (If yes to all) One more question to differentiate 20-16 vs 15-10 vs experienced.
   Ask about joseki knowledge, fighting confidence, or where they play online.

Ask one question at a time. Keep each message to 1–2 sentences. No markdown.

When you have enough to assign a bucket (usually after 2–4 questions), output:
ASSESSMENT_COMPLETE
{"bucket": "20-16 kyu", "rankScore": 1150, "summary": "one sentence explanation"}

rankScore must be the midpoint of the bucket:
  "30-26 kyu"       → rankScore 200
  "25-21 kyu"       → rankScore 700
  "20-16 kyu"       → rankScore 1200
  "15-10 kyu"       → rankScore 1750
  "9 kyu and above" → rankScore 2200`;

    const contextMsg = userContext ? `The student's name is ${userContext}. ` : '';
    const allMessages = messages.length === 0
      ? [{ role: 'user', content: contextMsg + 'Please start the assessment.' }]
      : messages;

    let text;
    try {
      text = await callClaude({
        model: CLAUDE_MODEL,
        maxTokens: 600,
        system,
        messages: allMessages,
      });
    } catch (claudeErr) {
      // Don't crash onboarding — let the student retry their last answer.
      console.error('Claude assess failed:', claudeErr.message);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          type: 'question',
          message: 'Sorry, I had trouble connecting just now. Please send your last answer again.',
        }),
      };
    }

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
