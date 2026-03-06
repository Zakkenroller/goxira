/**
 * analyze-move.js — Analyze a single move in an SGF game replay
 * POST /api/analyze-move
 */
const { callClaude, ok, err, corsHeaders } = require('./_claude');

const ANALYZE_SYSTEM = `You are a Go tutor analyzing a specific move in a student's game.
Be specific, educational, and concise (under 120 words).
Focus on: what the move accomplished or failed to accomplish, what a better move would be and why.
No markdown. Use plain conversational language appropriate for the student's rank.
If this was a good move, say so briefly and explain why. Don't invent problems.`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders() };
  try {
    const { sgf, moveNumber, boardSize, rank, boardStateBefore, boardStateAfter, move, playerColor } = JSON.parse(event.body);

    const prompt = `Student rank: ${rank}
Board size: ${boardSize}x${boardSize}
Move number: ${moveNumber}
Player (${playerColor}) just played at: ${move}
${boardStateBefore ? `Board state before: ${JSON.stringify(boardStateBefore)}` : `SGF: ${sgf}`}

Analyze this move. Was it good? What would you recommend instead if it was a mistake?`;

    const message = await callClaude(ANALYZE_SYSTEM, [{ role: 'user', content: prompt }], 400);

    // Flag if this looks like a critical mistake (simple heuristic — Claude tells us)
    const isCritical = /mistake|error|blunder|should have|better move|miss/i.test(message);

    return ok({ message, isCritical, moveNumber });
  } catch(e) {
    return err(e.message);
  }
};
