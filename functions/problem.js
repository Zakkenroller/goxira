const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const GOCOLS = 'ABCDEFGHJKLMNOPQRST';

function rankToDifficulty(rank) {
  if (!rank) return 1;
  const lower = rank.toLowerCase();
  if (lower.includes('dan')) return 3;
  const match = lower.match(/(\d+)/);
  if (!match) return 1;
  const kyu = parseInt(match[1]);
  if (kyu >= 20) return 1;
  if (kyu >= 10) return 2;
  return 3;
}

function toGoNotation(col, row, boardSize) {
  return GOCOLS[col] + (boardSize - row);
}

async function fetchProblemFromDB(difficulty) {
  // Use Supabase REST API directly — no SDK needed in Netlify functions
  const url = new URL(`${process.env.SUPABASE_URL}/rest/v1/tsumego_problems`);
  url.searchParams.set('difficulty', `eq.${difficulty}`);
  url.searchParams.set('select', 'id,source,difficulty,board_size,to_play,stones,solution_col,solution_row');
  url.searchParams.set('limit', '1');
  // Random offset for variety — pick from first 500 of this difficulty
  const offset = Math.floor(Math.random() * 300);
  url.searchParams.set('offset', String(offset));

  const res = await fetch(url.toString(), {
    headers: {
      'apikey': process.env.SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
    },
  });

  if (!res.ok) throw new Error(`Supabase error: ${res.status}`);
  const rows = await res.json();
  if (!rows.length) throw new Error('No problems found for difficulty ' + difficulty);
  return rows[0];
}

async function enrichWithText(problem, rank) {
  const { board_size, to_play, stones, solution_col, solution_row } = problem;

  const toPlayWord  = to_play === 'B' ? 'Black' : 'White';
  const opponent    = to_play === 'B' ? 'White' : 'Black';
  const solutionNote = toGoNotation(solution_col, solution_row, board_size);

  // Summarize the key group for Claude (just the opponent stones count)
  const opponentColor = to_play === 'B' ? 'W' : 'B';
  const opponentCount = Object.values(stones).filter(c => c === opponentColor).length;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 250,
        system: `You are a Go tutor. Write short teaching text for a tsumego problem. Respond ONLY with JSON, no markdown:
{"description":"one sentence describing the task for ${toPlayWord} to play","hint":"Socratic hint pointing to the key tactical idea without revealing the answer coordinate","explanation":"one sentence describing the tactical idea behind the solution at ${solutionNote} — e.g. atari, capturing, cutting, connecting — without inventing specific variations you cannot see"}

ACCURACY RULES:
- You do not have the full board image, only the stone count and the solution coordinate. Do not invent specific tactical sequences or claim to see threats you cannot verify.
- The explanation must describe the general tactical idea (capture, atari, cut, connect) — not fabricated move trees.
- The hint must guide toward the concept, not a false promise about what the position contains.`,
        messages: [{
          role: 'user',
          content: `${toPlayWord} to play on a ${board_size}x${board_size} board. ${opponent} has ${opponentCount} stones. Correct move is ${solutionNote}. Student rank: ${rank}.`,
        }, {
          role: 'assistant',
          content: '{',
        }],
      }),
    });

    const data = await res.json();
    const text = '{' + data.content[0].text.replace(/```json|```/g, '').trim();
    return JSON.parse(text);
  } catch(e) {
    return {
      description: `${toPlayWord} to play — find the key move.`,
      hint:        'Look for the vital point of the position.',
      explanation: `Playing at ${solutionNote} is the key move.`,
    };
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
    const { rank } = JSON.parse(event.body);
    const difficulty = rankToDifficulty(rank);

    // Fetch a real problem from Supabase
    const row = await fetchProblemFromDB(difficulty);

    // Get teaching text from Claude
    const text = await enrichWithText(row, rank || '20 kyu');

    const problem = {
      id:          `db_${row.id}`,
      topic:       'capture',
      difficulty:  row.difficulty,
      boardSize:   row.board_size,
      description: text.description,
      hint:        text.hint,
      setup: {
        stones:  row.stones,
        toPlay:  row.to_play,
      },
      solution: {
        move:        [row.solution_col, row.solution_row],
        explanation: text.explanation,
      },
      wrongMoves: [],
    };

    return { statusCode: 200, headers, body: JSON.stringify({ problem }) };

  } catch(e) {
    console.error('problem error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
