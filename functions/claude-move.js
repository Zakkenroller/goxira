const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

function stonesToGoNotation(stones, size) {
  const COLS = 'ABCDEFGHJKLMNOPQRST';
  const black = [], white = [];
  Object.entries(stones || {}).forEach(([key, color]) => {
    const [c, r] = key.split(',').map(Number);
    const notation = COLS[c] + (size - r);
    if (color === 'B') black.push(notation);
    else white.push(notation);
  });
  return `Black: ${black.join(', ') || 'none'} | White: ${white.join(', ') || 'none'}`;
}

function goNotationToCoords(notation, size) {
  const COLS = 'ABCDEFGHJKLMNOPQRST';
  const col = COLS.indexOf(notation[0].toUpperCase());
  const row = size - parseInt(notation.slice(1));
  return { col, row };
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  try {
    const { sgf, color, boardSize, rank, currentStones } = JSON.parse(event.body);
    const COLS = 'ABCDEFGHJKLMNOPQRST';

    // Build list of occupied points in Go notation
    const occupied = new Set();
    Object.keys(currentStones || {}).forEach(key => {
      const [c, r] = key.split(',').map(Number);
      occupied.add(COLS[c] + (boardSize - r));
    });

    // Build list of all empty points
    const empty = [];
    for (let c = 0; c < boardSize; c++) {
      for (let r = 0; r < boardSize; r++) {
        const key = `${c},${r}`;
        if (!currentStones || !currentStones[key]) {
          empty.push(COLS[c] + (boardSize - r));
        }
      }
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
        max_tokens: 200,
        system: `You are playing Go. You MUST choose from the empty points list provided. Output ONLY raw JSON, no explanation, no markdown.
Format: {"move": "E5", "thinking": "one short sentence"}
To pass use: {"move": "pass", "thinking": "reason"}`,
        messages: [{
          role: 'user',
          content: `You play ${color} at ${rank} level on ${boardSize}x${boardSize}.
Current position: ${stonesToGoNotation(currentStones, boardSize)}
Available empty points (choose ONE of these): ${empty.slice(0, 40).join(', ')}
Pick your move.`
        }, {
          role: 'assistant',
          content: '{'
        }],
      }),
    });

    const data = await res.json();
    const raw  = '{' + data.content[0].text;
    const parsed = JSON.parse(raw);

    if (parsed.move === 'pass') {
      return { statusCode: 200, headers, body: JSON.stringify({ move: { col: -1, row: -1, thinking: parsed.thinking } }) };
    }

    // Convert Go notation back to coordinates
    const coords = goNotationToCoords(parsed.move, boardSize);

    // Final safety check
    if (coords.col < 0 || coords.col >= boardSize || coords.row < 0 || coords.row >= boardSize) {
      return { statusCode: 200, headers, body: JSON.stringify({ move: { col: -1, row: -1, thinking: 'I\'ll pass.' } }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ move: { col: coords.col, row: coords.row, thinking: parsed.thinking } }) };
  } catch(e) {
    console.error('claude-move error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
