const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

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
async function katagoEval(sgf, playerColor, boardSize, rank) {
  if (!KATAGO_SERVICE_URL || !sgf) return null;
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), 8000));
  try {
    const fetchResult = fetch(`${KATAGO_SERVICE_URL}/move`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${KATAGO_TOKEN}`,
      },
      body: JSON.stringify({ sgf, color: playerColor, boardSize, rank }),
    }).then(res => res.ok ? res.json() : null).catch(() => null);
    return await Promise.race([fetchResult, timeout]);
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
    const { sgf, boardSize, rank, playerColor, currentStones, moveNumber, gameMode, captureTarget } = JSON.parse(event.body);
    const isAtari = gameMode === 'atari';
    const atariContext = isAtari ? `\nThis is an Atari Go game (first to capture ${captureTarget} stone${captureTarget === 1 ? '' : 's'} wins). Focus commentary on capturing opportunities and defending against atari.` : '';

    const katago = await katagoEval(sgf, playerColor, boardSize, rank);

    if (!katago) {
      // KataGo unavailable — static honest fallback. No Claude call: no position data
      // means Claude would only produce generic boilerplate, wasting API budget.
      const offlineHints = [
        "The analysis engine is offline, so I can't evaluate this position. As a general guide: keep your groups connected and look for the largest open area on the board.",
        "Engine offline — no position-specific advice available. Focus on fundamentals: secure any weak groups before expanding, and prefer moves that serve multiple purposes.",
        "The engine is unavailable right now. General principle: look for moves that build connections, reduce your opponent's potential, or take large territorial frameworks.",
      ];
      const commentary = offlineHints[moveNumber % offlineHints.length];
      return { statusCode: 200, headers, body: JSON.stringify({ commentary }) };
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
        system: `You are a Go sensei giving a nudge — point the student toward the right area without revealing the answer.${atariContext}
GROUNDING RULES:
- Do NOT use filler openers ("Great question!", "Think carefully!", "You're close!"). Start with the directional observation.
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
