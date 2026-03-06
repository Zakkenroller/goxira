/**
 * assess.js — Level assessment conversation
 * POST /api/assess
 * Body: { messages: [{role, content}], userContext: string }
 */

const { callClaude, ok, err, corsHeaders } = require('./_claude');

const SYSTEM = `You are a Go (the board game) tutor running a level assessment for a new student.
Your goal is to accurately determine their playing level through 5–8 targeted questions, then assign a starting rank.

RANKS: 30 kyu (absolute beginner) → 1 kyu → 1 dan → 9 dan (professional)
Most adult beginners who know the rules: 25–30 kyu. Regular casual players: 15–25 kyu.

ASSESSMENT RULES:
- Ask one question at a time. Be conversational and encouraging.
- Start with basic rules knowledge, escalate based on answers.
- Never be condescending if they don't know an answer.
- After enough information, end with: "ASSESSMENT_COMPLETE" followed by JSON:
  {"rank": "XX kyu", "rankScore": N, "summary": "brief explanation"}
  rankScore: 0–2999 (kyu range), each kyu ≈ 100 points. 30 kyu = 0, 1 kyu = 2900.

SAMPLE QUESTION PROGRESSION:
- Basic: "What happens when a group of stones has no liberties?"
- Capture: "If Black plays at a point that completes the capture of a White group, what happens to those White stones?"
- Ko: "Have you heard of ko? Can you explain what it means?"
- Life/death: "What does it mean for a group to be 'alive' in Go?"
- Joseki: "Do you know what joseki means?"
- Reading: "In a ladder sequence, what determines whether the ladder works or not?"

Keep responses concise. No markdown formatting.`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders() };
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405);

  try {
    const { messages, userContext } = JSON.parse(event.body);

    const contextPrefix = userContext
      ? `The student described their background as: "${userContext}". Use this to calibrate your first question.\n\n`
      : '';

    const systemWithContext = contextPrefix + SYSTEM;
    const text = await callClaude(systemWithContext, messages, 600);

    // Check if assessment is complete
    if (text.includes('ASSESSMENT_COMPLETE')) {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return ok({ type: 'complete', result, message: text.split('ASSESSMENT_COMPLETE')[0].trim() });
      }
    }

    return ok({ type: 'question', message: text });
  } catch(e) {
    console.error('assess error:', e);
    return err(e.message);
  }
};
