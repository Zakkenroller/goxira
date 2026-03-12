const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

const GOCOLS = 'ABCDEFGHJKLMNOPQRST'; // standard Go notation skips I

function toGoNotation(col, row, boardSize) {
  return GOCOLS[col] + (boardSize - row);
}

function stonesToGoNotation(stones, boardSize) {
  const black = [], white = [];
  Object.entries(stones || {}).forEach(([key, color]) => {
    const [c, r] = key.split(',').map(Number);
    const n = toGoNotation(c, r, boardSize);
    if (color === 'B') black.push(n);
    else white.push(n);
  });
  return `Black: ${black.join(', ') || 'none'} | White: ${white.join(', ') || 'none'}`;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  try {
    const { problem, col, row, attemptNumber, rank } = JSON.parse(event.body);
    const boardSize = problem.boardSize || 9;

    const isCorrect = (col === problem.solution.move[0] && row === problem.solution.move[1]);

    const studentMove  = toGoNotation(col, row, boardSize);
    const correctMove  = toGoNotation(problem.solution.move[0], problem.solution.move[1], boardSize);
    const setupNotation = stonesToGoNotation(problem.setup?.stones || {}, boardSize);

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
If attempt 1 wrong: give a Socratic hint without revealing the answer.
If attempt 2 wrong: give a more direct hint pointing to the key area.
If attempt 3+ wrong: explain the correct answer clearly.
If correct: explain briefly why the move works. Use proper Go notation (A1, B3 etc).`,
        messages: [{
          role: 'user',
          content: `Problem: ${problem.description}
Board setup: ${setupNotation}
Student rank: ${rank}. Attempt #${attemptNumber}.
Student played: ${studentMove}. Correct answer: ${correctMove}.
Move is ${isCorrect ? 'CORRECT' : 'INCORRECT'}.
${!isCorrect ? 'Correct explanation: ' + problem.solution.explanation : ''}`
        }],
      }),
    });

    const data    = await res.json();
    const message = data.content[0].text;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        correct: isCorrect,
        message,
        solution: isCorrect || attemptNumber >= 3 ? problem.solution : null,
      }),
    };
  } catch(e) {
    console.error('evaluate-move error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
