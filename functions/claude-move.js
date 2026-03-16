const CLAUDE_MODEL = 'claude-sonnet-4-6';

// Build an ASCII board grid so Claude can see the spatial layout
function buildAsciiBoard(stones, size) {
  const COLS = 'ABCDEFGHJKLMNOPQRST';
  const lines = [];
  lines.push('   ' + Array.from({ length: size }, (_, i) => COLS[i]).join(' '));
  for (let r = 0; r < size; r++) {
    const rowNum = size - r;
    const rowStr = String(rowNum).padStart(2);
    const cells = [];
    for (let c = 0; c < size; c++) {
      const stone = stones?.[`${c},${r}`];
      cells.push(stone === 'B' ? 'X' : stone === 'W' ? 'O' : '.');
    }
    lines.push(`${rowStr} ${cells.join(' ')}`);
  }
  return lines.join('\n');
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

    // Build full list of empty points in Go notation
    const empty = [];
    for (let c = 0; c < boardSize; c++) {
      for (let r = 0; r < boardSize; r++) {
        if (!currentStones?.[`${c},${r}`]) {
          empty.push(COLS[c] + (boardSize - r));
        }
      }
    }

    // Shuffle to avoid systematic bias if we ever need to truncate
    for (let i = empty.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [empty[i], empty[j]] = [empty[j], empty[i]];
    }

    const emptySet = new Set(empty);
    const boardAscii = buildAsciiBoard(currentStones, boardSize);
    const playerSymbol = color === 'B' ? 'X' : 'O';
    const opponentSymbol = color === 'B' ? 'O' : 'X';

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
        system: `You are playing Go as ${playerSymbol} (${color === 'B' ? 'Black' : 'White'}) on a ${boardSize}x${boardSize} board.
Board key: X=Black, O=White, .=empty intersection.
You MUST pick one of the listed empty points. Never pick an occupied point.
Output ONLY a JSON object — no explanation, no markdown fences.
Format: {"move": "E5", "thinking": "one short sentence"}
To pass: {"move": "pass", "thinking": "reason"}`,
        messages: [{
          role: 'user',
          content: `You play ${playerSymbol} at ${rank} level. ${opponentSymbol} is your opponent.\n\nCurrent board:\n${boardAscii}\n\nAvailable empty points (choose ONE): ${empty.join(', ')}\n\nPick your move.`,
        }],
      }),
    });

    const data = await res.json();
    if (!data.content) {
      console.error('Anthropic API error:', JSON.stringify(data));
      return { statusCode: 502, headers, body: JSON.stringify({ error: data.error?.message || 'Anthropic API error' }) };
    }

    const text = data.content[0].text.replace(/```[a-z]*\n?/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(text);

    if (parsed.move === 'pass') {
      return { statusCode: 200, headers, body: JSON.stringify({ move: { col: -1, row: -1, thinking: parsed.thinking } }) };
    }

    const moveNotation = parsed.move.toUpperCase();

    // Validate the chosen point is actually empty
    if (!emptySet.has(moveNotation)) {
      console.warn('claude-move: model chose non-empty or invalid point', parsed.move);
      return { statusCode: 200, headers, body: JSON.stringify({ move: { col: -1, row: -1, thinking: "I'll pass." } }) };
    }

    const coords = goNotationToCoords(moveNotation, boardSize);

    // Bounds safety check
    if (coords.col < 0 || coords.col >= boardSize || coords.row < 0 || coords.row >= boardSize) {
      return { statusCode: 200, headers, body: JSON.stringify({ move: { col: -1, row: -1, thinking: "I'll pass." } }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ move: { col: coords.col, row: coords.row, thinking: parsed.thinking } }) };
  } catch (e) {
    console.error('claude-move error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
