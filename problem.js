/**
 * problem.js — Generate a Go problem for a given rank
 * POST /api/problem
 */
const { callClaude, ok, err, corsHeaders } = require('./_claude');

const PROBLEM_SYSTEM = `You are a Go tutor. Generate a Go problem appropriate for the student's level.

Respond ONLY with valid JSON, no other text:
{
  "id": "unique string like p_capture_001",
  "topic": "capture|life-death|ladder|ko|shape|joseki|tesuji",
  "difficulty": 1-5,
  "boardSize": 9|13|19,
  "description": "Clear problem statement. What should the student find?",
  "setup": {
    "stones": {"col,row": "B"|"W"},
    "toPlay": "B"|"W"
  },
  "solution": {
    "move": [col, row],
    "explanation": "Why this is the correct move"
  },
  "hint": "A Socratic hint that points toward the answer without giving it away",
  "wrongMoves": [
    {"move": [col, row], "explanation": "Why this is wrong"}
  ]
}

RANK GUIDELINES:
- 25-30 kyu: Simple captures, atari, 9x9 only. Groups with 1-2 liberties.
- 20-25 kyu: Ladders, nets, basic life/death. 9x9.
- 15-20 kyu: Ko, basic shapes, two-eye life. 9x9 or 13x13.
- 10-15 kyu: Tesuji, corner life/death. 13x13.
- 5-10 kyu: Complex reading, joseki, endgame. 13x13 or 19x19.

Use coordinates 0-8 for 9x9, 0-12 for 13x13, 0-18 for 19x19. (0,0) is top-left.
Keep setups small (6-14 stones) and focused on one concept.`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders() };
  try {
    const { rank, topic, boardSize } = JSON.parse(event.body);
    const prompt = `Generate a ${topic || 'appropriate'} problem for a ${rank} player. Board size: ${boardSize || 9}x${boardSize || 9}.`;
    const text = await callClaude(PROBLEM_SYSTEM, [{ role: 'user', content: prompt }], 800);
    const clean = text.replace(/```json|```/g, '').trim();
    const problem = JSON.parse(clean);
    return ok({ problem });
  } catch(e) {
    console.error('problem error:', e);
    return err(e.message);
  }
};
