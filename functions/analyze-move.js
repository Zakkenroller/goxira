const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

const KATAGO_SERVICE_URL = process.env.KATAGO_SERVICE_URL;
const KATAGO_TOKEN       = process.env.KATAGO_TOKEN;

// Call KataGo /move with the full SGF to get top 5 candidate moves at this position.
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
    console.error('KataGo analyze-move eval error:', e.message);
    return null;
  }
}

function formatTopMovesForPrompt(topMoves, toPlayWord, playedMove) {
  if (!topMoves?.length) return '';
  return topMoves.slice(0, 5).map((m, i) => {
    const winPct = Math.round((m.winrate ?? 0) * 100);
    const score = m.scoreLead != null ? `, score ${m.scoreLead > 0 ? '+' : ''}${m.scoreLead.toFixed(1)}` : '';
    const pv = m.pv?.length ? ` → sequence: ${m.pv.join(', ')}` : '';
    const marker = m.move === playedMove ? ' ← student\'s move' : '';
    return `  ${i + 1}. ${m.move}: ${winPct}% for ${toPlayWord}${score}${pv}${marker}`;
  }).join('\n');
}

// Convert board.getStones() object ({"col,row": "B"|"W"}) to GTP coordinate lists.
const COLS = 'ABCDEFGHJKLMNOPQRST';
function stonesToGTP(stonesObj, boardSize) {
  const black = [], white = [];
  for (const [key, color] of Object.entries(stonesObj || {})) {
    const [c, r] = key.split(',').map(Number);
    const gtp = COLS[c] + (boardSize - r);
    if (color === 'B') black.push(gtp); else white.push(gtp);
  }
  return { black, white };
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  try {
    const { moveNumber, boardSize, rank, move, playerColor, sgf, precomputedAnalysis, currentStones, gameMode, captureTarget } = JSON.parse(event.body);
    const isAtari = gameMode === 'atari';
    const atariContext = isAtari ? `\nThis is an Atari Go game (first to capture ${captureTarget} stone${captureTarget === 1 ? '' : 's'} wins). Commentary should relate to capturing threats and atari defense.` : '';

    const toPlayWord = playerColor === 'B' ? 'Black' : 'White';

    // Use precomputed analysis from katago-move if available — avoids a second KataGo call.
    // Fall back to a fresh KataGo query only if no precomputed data was provided.
    let katago = null;
    if (precomputedAnalysis) {
      katago = precomputedAnalysis;
    } else if (sgf) {
      katago = await katagoEval(sgf, playerColor, boardSize, rank);
    }

    let systemPrompt;
    let userContent;

    if (katago) {
      const topMoves = katago.analysis?.topMoves || [];
      const winrate   = katago.winrate ?? 0.5;
      const goxiraWr  = playerColor === 'B' ? winrate : (1 - winrate);
      const winPct    = Math.round(goxiraWr * 100); // Goxira's %, used to derive student's below
      const scoreLead = katago.scoreLead;

      // When KataGo returns a result but no candidate moves, we have win rate data only.
      // Do NOT call Claude — there is nothing to ground move-quality analysis in, and
      // Claude will confabulate strategic reasoning for the specific move.
      if (!topMoves.length) {
        const studentWinPct = 100 - winPct;
        const studentScoreLead = scoreLead != null ? (playerColor === 'B' ? -scoreLead : scoreLead) : null;
        const scoreNote = studentScoreLead != null
          ? ` You are ${studentScoreLead >= 0 ? '+' : ''}${studentScoreLead.toFixed(1)} pts ${studentScoreLead >= 0 ? 'ahead' : 'behind'}.`
          : '';
        const message = `Your winning chances: ${studentWinPct}%.${scoreNote} (No follow-up sequence data was returned, so I can't explain the threat in detail.)`;
        return { statusCode: 200, headers, body: JSON.stringify({ message, isCritical: false, moveNumber }) };
      }

      // Winrate and score always from the student's perspective.
      // playerColor is Goxira's color, so the student is the opposite.
      const studentWinPct = 100 - winPct;
      const studentScoreLead = scoreLead != null
        ? (playerColor === 'B' ? -scoreLead : scoreLead)
        : null;
      const studentScoreStr = studentScoreLead != null
        ? ` You are ${studentScoreLead >= 0 ? '+' : ''}${studentScoreLead.toFixed(1)} pts ${studentScoreLead >= 0 ? 'ahead' : 'behind'}.`
        : '';

      // Principal variation of Goxira's actual move — grounds threat claims without fabrication.
      const goxiraMoveData = topMoves.find(m => m.move === move) || topMoves[0];
      const pvStr = goxiraMoveData?.pv?.length
        ? `KataGo expected continuation (FUTURE moves, not current stones): ${goxiraMoveData.pv.slice(0, 5).join(', ')}`
        : '';

      // Board state — lets Claude reference only stones that actually exist.
      // currentStones is sent by the frontend as board.getStones().
      const hasBoardState = currentStones && Object.keys(currentStones).length > 0;
      let boardStateStr = '';
      if (hasBoardState) {
        const { black, white } = stonesToGTP(currentStones, boardSize);
        boardStateStr = `Current stones on the board — Black: ${black.join(', ') || 'none'}. White: ${white.join(', ') || 'none'}.`;
      }

      const coordinateRule = hasBoardState
        ? `- You have been given the complete list of current stones above. Do NOT reference any intersection as containing a stone unless it appears in that list. The continuation sequence shows future moves, not existing stones.`
        : `- You do NOT know which stones are on the board. Do not reference specific intersections by coordinate. Describe threats in general terms (e.g., "cuts off your group", "threatens the corner") only.`;

      systemPrompt = `You are a Go sensei briefly explaining the move Goxira just played. Be direct. One move, one idea.${atariContext}

GROUNDING RULES:
- Do NOT open with encouragement or filler ("Nice move!", "That's a tricky position"). Start immediately with the win rate or the continuation.
- State the student's winning chances using the exact number given. Do not editorialize ("very difficult", "hopeless", etc.).
- Quote the KataGo continuation sequence as-is: "KataGo expects the continuation to go A, B, C..."
- You may name the general board area the continuation implies (e.g., "the right side", "the top-right corner") — but only in area-level terms, not named intersections.
- Do NOT claim a move "puts pressure on", "threatens", or "connects to" any intersection unless both intersections appear consecutively or as captures in the KataGo continuation sequence. Spatial proximity on the board is NOT evidence of a tactical relationship.
- Do NOT invent strategic reasoning ("builds a wall", "seals off", "cuts your group") not directly shown by the continuation.
- Do NOT fabricate win rates or sequences. Use only the data given.
${coordinateRule}

TEACHING CALIBRATION (student is ${rank}):
- 25k–15k: Win rate sentence + continuation sequence. That's it.
- 15k–5k: Win rate + continuation + one sentence on the general area implied.
- 5k–1d+: Win rate + continuation + one sentence on what the continuation suggests strategically (area-level only).

Under 80 words. No markdown. Plain language.`;

      userContent = `Goxira (${toPlayWord}) just played ${move} on move ${moveNumber} of a ${boardSize}×${boardSize} game.
${boardStateStr}
Student's winning chances: ${studentWinPct}%.${studentScoreStr}
${pvStr}
Describe the situation to the student using only the data above.`;
    } else {
      // KataGo unavailable — honest fallback with generic thematic commentary only.
      systemPrompt = `You are a Go tutor offering educational commentary on a student's game. The position analysis engine is currently offline, so you cannot evaluate whether this specific move was good or bad.${atariContext}
KataGo engine data is not available for this position. You may ONLY describe what the move physically does on the board (e.g., "this is an approach move to the corner") and what strategic themes are typically associated with this type of move. Do NOT estimate whether this move is strategically good or bad. Do NOT invent win rates or suggest specific alternative moves. Be honest that position-specific analysis requires the engine, which is currently offline.
Under 100 words. No markdown. Plain conversational language.`;

      userContent = `Student rank: ${rank}. Board: ${boardSize}x${boardSize}. Move #${moveNumber}. ${playerColor} played at ${move}. The engine is offline — give only a brief thematic observation about this type of move, and note that full analysis is unavailable.`;
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
        max_tokens: 150,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
      }),
    });

    const data = await res.json();
    const message = data.content[0].text;
    const isCritical = /mistake|error|blunder|should have|better move|miss/i.test(message);
    return { statusCode: 200, headers, body: JSON.stringify({ message, isCritical, moveNumber }) };
  } catch(e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
