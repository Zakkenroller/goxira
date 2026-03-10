const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  try {
    const { problem, col, row, attemptNumber, rank } = JSON.parse(event.body);
    const isCorrect = (col === problem.solution.move[0] && row === problem.solution.move[1]);

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 300,
        system: `You are a Go tutor evaluating a student's move. Be encouraging but honest. Under 80 words. No markdown.
If attempt 1 wrong: give a Socratic hint.
If attempt 2 wrong: more direct hint.
If attempt 3+ wrong: explain the correct answer.
If correct: explain why it works briefly.`,
        messages: [{ role: 'user', content: `Problem: ${problem.description}
Student rank: ${rank}. Attempt #${attemptNumber}.
Student played column ${col} row ${row}. Correct answer: column ${problem.solution.move[0]} row ${problem.solution.move[1]}.
Move is ${isCorrect ? 'CORRECT' : 'INCORRECT'}.
${!isCorrect ? 'Correct explanation: ' + problem.solution.explanation : ''}` }],
      }),
    });

    const data = await res.json();
    const message = data.content[0].text;
    return { statusCode: 200, headers, body: JSON.stringify({
      correct: isCorrect,
      message,
      solution: isCorrect || attemptNumber >= 3 ? problem.solution : null
    })};
  } catch(e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
