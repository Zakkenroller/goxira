/**
 * game-summary.js — Generate end-of-game summary with key moments
 * POST /api/game-summary
 */
const { callClaude, ok, err, corsHeaders } = require('./_claude');

const SUMMARY_SYSTEM = `You are a Go tutor summarizing a student's completed game.
Identify the 3 most important moments (mistakes OR good moves) and explain each.
Respond ONLY with valid JSON, no other text:
{
  "overallComment": "2-3 sentence overall game assessment",
  "keyMoments": [
    {
      "moveNumber": N,
      "type": "mistake"|"good"|"critical",
      "title": "short label like 'Missed capture' or 'Good tesuji'",
      "explanation": "1-2 sentence explanation"
    }
  ],
  "studyTopic": "The one concept to study most based on this game"
}`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders() };
  try {
    const { sgf, boardSize, rank, playerColor } = JSON.parse(event.body);
    const prompt = `Student rank: ${rank}. Playing as ${playerColor} on ${boardSize}x${boardSize}.\nSGF: ${sgf}`;
    const text = await callClaude(SUMMARY_SYSTEM, [{ role: 'user', content: prompt }], 600);
    const clean = text.replace(/```json|```/g, '').trim();
    const summary = JSON.parse(clean);
    return ok({ summary });
  } catch(e) {
    return err(e.message);
  }
};
