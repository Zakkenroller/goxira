const CLAUDE_MODEL = 'claude-sonnet-4-6';

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

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  try {
    const { moveNumber, boardSize, rank, move, playerColor, sgf } = JSON.parse(event.body);

    const toPlayWord = playerColor === 'B' ? 'Black' : 'White';

    // Call KataGo to evaluate the position, if SGF is available.
    const katago = sgf ? await katagoEval(sgf, playerColor, boardSize, rank) : null;

    let systemPrompt;
    let userContent;

    if (katago) {
      const topMoves = katago.analysis?.topMoves || [];
      const winrate  = katago.winrate ?? 0.5;
      const playerWr = playerColor === 'B' ? winrate : (1 - winrate);
      const winPct   = Math.round(playerWr * 100);
      const scoreLead = katago.scoreLead;
      const scoreStr  = scoreLead != null
        ? ` Score lead: ${scoreLead > 0 ? '+' : ''}${scoreLead.toFixed(1)} pts for ${scoreLead > 0 ? 'Black' : 'White'}.`
        : '';
      const studentRank = topMoves.findIndex(m => m.move === move);
      const rankStr = studentRank >= 0
        ? ` ${toPlayWord}'s move (${move}) ranks #${studentRank + 1} of KataGo's top 5.`
        : topMoves.length > 0
          ? ` ${toPlayWord}'s move (${move}) is not in KataGo's top 5.`
          : '';
      const topMovesStr = formatTopMovesForPrompt(topMoves, toPlayWord, move);
      const bestMove = topMoves[0]?.move;
      const bestWr = topMoves[0] ? Math.round((topMoves[0].winrate ?? 0) * 100) : null;
      const delta = topMoves[0] && studentRank >= 0
        ? Math.round((topMoves[studentRank].winrate - topMoves[0].winrate) * 100)
        : null;
      const deltaStr = delta != null && delta !== 0
        ? ` This move is ${Math.abs(delta)}% worse than KataGo's top choice (${bestMove} at ${bestWr}%).`
        : '';

      systemPrompt = `You are a Go tutor explaining KataGo's analysis to a student ranked ${rank}.
GROUNDING RULES:
- Reference ONLY moves and evaluations present in the KataGo data provided below.
- Do NOT invent variations, sequences, or moves not in KataGo's top-5 list.
- Do NOT estimate or fabricate win rates. Use KataGo's numbers exactly.
- If the data doesn't cover something, say so honestly. Saying less is always better than fabricating.

TEACHING CALIBRATION:
- 25k–15k: Simple language. Focus on what happened tactically. One concept at a time.
- 15k–5k: Introduce strategic reasoning. Explain why a move was directionally wrong.
- 5k–1d+: Full strategic discussion. Discuss aji, thickness, direction of play.

Under 100 words. No markdown. Plain conversational language.`;

      userContent = `Student rank: ${rank}. Board: ${boardSize}x${boardSize}. Move #${moveNumber}. ${toPlayWord} played at ${move}.
KataGo position assessment: ${winPct}% for ${toPlayWord}.${scoreStr}${rankStr}${deltaStr}
KataGo top-5 candidate moves:
${topMovesStr || '(no data)'}
Explain what this move does and how it compares to KataGo's top choices.`;
    } else {
      // KataGo unavailable — honest fallback with generic thematic commentary only.
      systemPrompt = `You are a Go tutor offering educational commentary on a student's game. The position analysis engine is currently offline, so you cannot evaluate whether this specific move was good or bad.
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
