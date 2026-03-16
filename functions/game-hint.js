const CLAUDE_MODEL = 'claude-sonnet-4-6';

const KATAGO_SERVICE_URL = process.env.KATAGO_SERVICE_URL;
const KATAGO_TOKEN       = process.env.KATAGO_TOKEN;

const COLS = 'ABCDEFGHJKLMNOPQRST';

// Classify a GTP coordinate into a board area name for teaching purposes.
// We deliberately avoid returning the exact coordinate to Claude.
function moveToArea(gtp, boardSize) {
  if (!gtp || gtp.toLowerCase() === 'pass') return 'center';
  const col = COLS.indexOf(gtp[0].toUpperCase());
  const row = boardSize - parseInt(gtp.slice(1), 10);
  const third = Math.floor(boardSize / 3);
  const twoThird = boardSize - third;
  const colArea = col < third ? 'left' : col >= twoThird ? 'right' : 'center';
  const rowArea = row < third ? 'top' : row >= twoThird ? 'bottom' : 'middle';
  if (colArea === 'center' && rowArea === 'middle') return 'center';
  if (rowArea === 'middle') return `${colArea} side`;
  if (colArea === 'center') return `${rowArea} side`;
  return `${rowArea}-${colArea} corner`;
}

// Call KataGo /move to get top 5 candidate moves.
// Uses full strength for accurate eval.
async function katagoEval(sgf, playerColor, boardSize) {
  if (!KATAGO_SERVICE_URL || !sgf) return null;
  try {
    const res = await fetch(`${KATAGO_SERVICE_URL}/move`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${KATAGO_TOKEN}`,
      },
      body: JSON.stringify({ sgf, color: playerColor, boardSize, rank: '1 dan' }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error('KataGo hint eval error:', e.message);
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
    const { sgf, boardSize, rank, playerColor, currentStones, moveNumber } = JSON.parse(event.body);

    const katago = await katagoEval(sgf, playerColor, boardSize);

    if (!katago) {
      // KataGo unavailable — honest fallback, no invented advice.
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: 150,
          system: `You are a Go tutor. The position analysis engine is currently offline, so you cannot evaluate this position. Be honest about this limitation. You may offer only universal Go principles (e.g., "look for the biggest area", "keep groups connected") without making any claims about this specific board position. Under 60 words. No markdown.`,
          messages: [{
            role: 'user',
            content: `Student plays ${playerColor} at ${rank} level. Move ${moveNumber}. The engine is offline — give a brief general principle only.`,
          }],
        }),
      });
      const data = await res.json();
      return { statusCode: 200, headers, body: JSON.stringify({ commentary: data.content[0].text }) };
    }

    // Build area-based description of top moves without leaking exact coordinates.
    const topMoves = katago.analysis?.topMoves || [];
    const winrate  = katago.winrate ?? 0.5;
    const playerWr = playerColor === 'B' ? winrate : (1 - winrate);
    const winPct   = Math.round(playerWr * 100);
    const scoreLead = katago.scoreLead;

    let katagoSummary = `KataGo assessment: ${playerColor === 'B' ? 'Black' : 'White'} (student) has ${winPct}% winning chances.`;
    if (scoreLead != null) {
      katagoSummary += ` Score lead: ${scoreLead > 0 ? '+' : ''}${scoreLead.toFixed(1)} pts for ${scoreLead > 0 ? 'Black' : 'White'}.`;
    }

    let topMovesContext = '';
    if (topMoves.length > 0) {
      const areas = topMoves.slice(0, 5).map(m => moveToArea(m.move, boardSize));
      // Describe which region of the board KataGo considers most important.
      // De-duplicate and collapse to give a directional cue without coordinates.
      const uniqueAreas = [...new Set(areas)];
      topMovesContext = `\nKataGo's top candidate moves are concentrated in the ${uniqueAreas.slice(0, 2).join(' and ')} of the board.`;
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
        system: `You are a Go tutor explaining KataGo's analysis to a student ranked ${rank}.
GROUNDING RULES:
- Reference ONLY the KataGo data provided. Do NOT invent variations or suggest moves.
- Do NOT reveal exact coordinates or intersection names to the student — guide them toward the right area of the board using directional language (e.g., "the left side", "the upper-right corner").
- Do NOT estimate win rates beyond what KataGo provides. Use its numbers exactly if you mention them.
- If the data points to a concept (e.g., reducing opponent's territory, connecting groups), explain that concept without giving away the specific move.
- Be like a coach gesturing at a region of the board, not reading out the answer.

TEACHING CALIBRATION:
- 25k–15k: Simple directional guidance and one tactical concept.
- 15k–5k: Explain the strategic reason why that area matters.
- 5k–1d+: Discuss timing, sente/gote, and the broader strategic picture.

Under 80 words. Conversational. No markdown.`,
        messages: [{
          role: 'user',
          content: `Student plays ${playerColor} at ${rank} level. Move ${moveNumber} on ${boardSize}x${boardSize} board.\n${katagoSummary}${topMovesContext}\nGive directional coaching that guides the student toward the important area without naming the exact move.`,
        }],
      }),
    });

    const data = await res.json();
    return { statusCode: 200, headers, body: JSON.stringify({ commentary: data.content[0].text }) };
  } catch(e) {
    console.error('game-hint error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
