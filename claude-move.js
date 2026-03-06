/**
 * claude-move.js — Get Claude's next move in a live game
 * POST /api/claude-move
 */
const { callClaude, ok, err, corsHeaders } = require('./_claude');

const MOVE_SYSTEM = `You are playing Go against a student. Play at approximately the student's rank level — make some natural mistakes, don't play perfectly, but play genuinely.

The board uses coordinates col,row where (0,0) is top-left.
Respond ONLY with valid JSON:
{"col": N, "row": N, "thinking": "one short sentence about your reasoning (shown to student for learning)"}

IMPORTANT: Only play on empty intersections. Check the current board state carefully.
On 9x9: cols and rows 0-8. On 13x13: 0-12. On 19x19: 0-18.`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders() };
  try {
    const { sgf, color, boardSize, rank, currentStones } = JSON.parse(event.body);

    const prompt = `Student rank: ${rank}. You are playing ${color} on a ${boardSize}x${boardSize} board.
Current stones on board: ${JSON.stringify(currentStones)}
SGF so far: ${sgf || '(game start)'}

Choose your next move. Play at approximately ${rank} level.`;

    const text = await callClaude(MOVE_SYSTEM, [{ role: 'user', content: prompt }], 200);
    const clean = text.replace(/```json|```/g, '').trim();
    const move = JSON.parse(clean);
    return ok({ move });
  } catch(e) {
    return err(e.message);
  }
};
