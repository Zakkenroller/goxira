/**
 * evaluate-move.js — Evaluate a user's move attempt on a problem
 * POST /api/evaluate-move
 */
const { callClaude, ok, err, corsHeaders } = require('./_claude');

const EVAL_SYSTEM = `You are a Go tutor evaluating a student's move attempt on a problem.
Be encouraging but honest. Keep responses under 80 words.
No markdown. Conversational tone.

If attempt 1 and wrong: Give a Socratic hint. Ask a guiding question.
If attempt 2 and wrong: Give a more direct hint about what to look for.
If attempt 3+ and wrong: Explain the correct answer clearly.
If correct: Explain why it works. Brief, enthusiastic.`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders() };
  try {
    const { problem, col, row, attemptNumber, rank } = JSON.parse(event.body);
    const solCol = problem.solution.move[0];
    const solRow = problem.solution.move[1];
    const isCorrect = (col === solCol && row === solRow);

    const prompt = `Problem: ${problem.description}
Student's rank: ${rank}
Student played: column ${col}, row ${row}
Correct answer: column ${solCol}, row ${solRow}
This is attempt #${attemptNumber}.
The move is ${isCorrect ? 'CORRECT' : 'INCORRECT'}.
${!isCorrect ? `Correct explanation: ${problem.solution.explanation}` : ''}
${!isCorrect && problem.wrongMoves ? 'Wrong move context: ' + JSON.stringify(problem.wrongMoves) : ''}

Respond with feedback appropriate for attempt #${attemptNumber}.`;

    const message = await callClaude(EVAL_SYSTEM, [{ role: 'user', content: prompt }], 300);
    return ok({ correct: isCorrect, message, solution: isCorrect || attemptNumber >= 3 ? problem.solution : null });
  } catch(e) {
    return err(e.message);
  }
};
