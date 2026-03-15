const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const GOCOLS = 'ABCDEFGHJKLMNOPQRST'; // standard Go notation skips I

const KATAGO_SERVICE_URL = process.env.KATAGO_SERVICE_URL;
const KATAGO_TOKEN       = process.env.KATAGO_TOKEN;

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

// Convert {col,row: color} stones to KataGo initialStones format [["B","D5"],...]
function stonesToKataGo(stones, boardSize) {
  return Object.entries(stones || {}).map(([key, color]) => {
    const [c, r] = key.split(',').map(Number);
    return [color, GOCOLS[c] + (boardSize - r)];
  });
}

// Call KataGo /analyze-position to evaluate a tsumego position after a player's move.
// Returns { winrate, scoreLead, bestMove } or null if KataGo unavailable.
async function katagoEval(initialStones, playerMove, boardSize) {
  if (!KATAGO_SERVICE_URL) return null;
  try {
    const res = await fetch(`${KATAGO_SERVICE_URL}/analyze-position`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${KATAGO_TOKEN}`,
      },
      body: JSON.stringify({ initialStones, moves: [playerMove], boardSize }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error('KataGo eval error:', e.message);
    return null;
  }
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

    const studentMove   = toGoNotation(col, row, boardSize);
    const correctMove   = toGoNotation(problem.solution.move[0], problem.solution.move[1], boardSize);
    const setupNotation = stonesToGoNotation(problem.setup?.stones || {}, boardSize);

    // KataGo: get objective position evaluation after the player's move
    const toPlay       = problem.setup?.toPlay || 'B';
    const setupStones  = stonesToKataGo(problem.setup?.stones || {}, boardSize);
    const katago       = await katagoEval(setupStones, [toPlay, studentMove], boardSize);

    let katagoContext = '';
    if (katago) {
      const winPct    = Math.round((katago.winrate ?? 0.5) * 100);
      const scoreStr  = katago.scoreLead != null
        ? `, score lead ${katago.scoreLead > 0 ? '+' : ''}${katago.scoreLead.toFixed(1)} pts`
        : '';
      const bestStr   = (katago.bestMove && katago.bestMove !== studentMove)
        ? ` KataGo's preferred move: ${katago.bestMove}.`
        : '';
      katagoContext = `\nKataGo analysis after student's move: ${winPct}% for ${toPlay === 'B' ? 'Black' : 'White'}${scoreStr}.${bestStr}`;
    }

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
        system: `You are a Go tutor evaluating a student's tsumego attempt. Be honest. Under 80 words. No markdown.
If attempt 1 wrong: give a Socratic hint that points toward the key tactical idea — do not invent details not in the explanation.
If attempt 2 wrong: give a more direct hint based strictly on the provided explanation.
If attempt 3+ wrong: deliver the correct answer using the provided explanation — do not embellish or add tactical claims beyond what is given.
If correct: explain briefly why the move works, staying within what the provided explanation says.
Use proper Go notation (A1, B3 etc). Do not fabricate variations or continuations not provided.
If KataGo analysis is provided, use the objective winrate and score numbers to give precise, accurate feedback — do not contradict them.`,
        messages: [{
          role: 'user',
          content: `Problem: ${problem.description}
Board setup: ${setupNotation}
Student rank: ${rank}. Attempt #${attemptNumber}.
Student played: ${studentMove}. Correct answer: ${correctMove}.
Move is ${isCorrect ? 'CORRECT' : 'INCORRECT'}.
${!isCorrect ? 'Correct explanation: ' + problem.solution.explanation : ''}${katagoContext}`
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
