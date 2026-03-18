// Joseki deviation analysis.
//
// Called when a user plays off-book in the joseki explorer.
// Flow:
//   1. Reconstruct the board position from the move sequence played so far.
//   2. Send the position + deviation move to KataGo /analyze-position for top-5 evaluation.
//   3. Identify the expected (on-book) next move from the sequence.
//   4. Compute point loss = (expected move's winrate) - (deviation move's winrate).
//   5. Pass all of this to Claude to explain the structural inefficiency in human terms.
//
// Two-System Rule strictly enforced:
//   - KataGo computes the point loss and best moves. Claude explains why.
//   - If KataGo is unavailable, Claude responds with a generic disclaimer only.
//   - Claude never generates move coordinates or evaluates positions independently.

const CLAUDE_MODEL       = 'claude-haiku-4-5-20251001';
const KATAGO_SERVICE_URL = process.env.KATAGO_SERVICE_URL;
const KATAGO_TOKEN       = process.env.KATAGO_TOKEN;

const COLS = 'ABCDEFGHJKLMNOPQRST';

function toGTP(col, row, boardSize) {
  return COLS[col] + (boardSize - row);
}

// Convert { color, col, row } move array to KataGo initialStones + moves format.
// Returns { initialStones: [["B","D4"],...], moves: [["B","D4"],...] }
// We treat the full sequence as moves (not initialStones) so KataGo evaluates the
// position after replaying them from an empty board.
function buildKataGoPayload(moveSequence, boardSize) {
  const moves = moveSequence.map(m => [m.color, toGTP(m.col, m.row, boardSize)]);
  return { initialStones: [], moves, boardSize };
}

// Query KataGo for top-5 candidate moves at the position after moveSequence.
// Returns { topMoves, rootWinrate, rootScoreLead } or null on failure.
async function katagoAnalyzePosition(moveSequence, boardSize) {
  if (!KATAGO_SERVICE_URL) return null;
  const { initialStones, moves } = buildKataGoPayload(moveSequence, boardSize);
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), 10000));
  try {
    const fetchResult = fetch(`${KATAGO_SERVICE_URL}/analyze-position`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${KATAGO_TOKEN}`,
      },
      body: JSON.stringify({ initialStones, moves, boardSize }),
    }).then(r => r.ok ? r.json() : null).catch(() => null);
    return await Promise.race([fetchResult, timeout]);
  } catch(e) {
    console.error('KataGo joseki-deviation error:', e.message);
    return null;
  }
}

// Format top-5 for Claude's prompt.
function formatTopMoves(topMoves, nextColor) {
  if (!topMoves?.length) return '';
  const label = nextColor === 'B' ? 'Black' : 'White';
  const lines = topMoves.map((m, i) => {
    const winPct = Math.round((m.winrate ?? 0) * 100);
    const score  = m.scoreLead != null ? `, score ${m.scoreLead > 0 ? '+' : ''}${m.scoreLead.toFixed(1)}` : '';
    const pv     = m.pv?.length ? ` (sequence: ${m.pv.slice(0, 5).join(', ')})` : '';
    return `  ${i + 1}. ${m.move}: ${winPct}% for ${label}${score}${pv}`;
  });
  return `KataGo top-5 candidate moves at this position:\n${lines.join('\n')}`;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type':                 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  try {
    const { moveSequence, deviationMove, boardSize = 19, rank = '20 kyu' } = JSON.parse(event.body || '{}');

    if (!moveSequence || !deviationMove) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'moveSequence and deviationMove required' }) };
    }

    // The deviation move is the user's off-book choice.
    // The expected next move would have been the first move in the remainder of
    // the pattern — but at this point the client has already sent us the deviation.
    // We evaluate the position *after* moveSequence (the on-book position) to get
    // KataGo's assessment of what should have been played.
    const katago = await katagoAnalyzePosition(moveSequence, boardSize);

    const deviationGTP = toGTP(deviationMove.col, deviationMove.row, boardSize);
    const nextColor    = deviationMove.color || (moveSequence.length % 2 === 0 ? 'B' : 'W');
    const colorWord    = nextColor === 'B' ? 'Black' : 'White';

    // ── Degraded path: KataGo unavailable ────────────────────────────
    if (!katago) {
      const explanation = `The engine is currently unavailable, so a precise point-loss calculation cannot be provided.

In general, deviating from joseki risks one or more of: poor shape (e.g., empty triangles), wasted moves that don't match the direction of thickness, or allowing the opponent to establish a stronger local position. To understand the specific cost here, review this position with KataGo when available.`;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ explanation, pointLoss: null, engineAvailable: false }),
      };
    }

    // ── Compute point loss ────────────────────────────────────────────
    // Best move's winrate (index 0) vs deviation move's winrate (if in top-5)
    const bestMove    = katago.topMoves?.[0];
    const bestWinrate = bestMove?.winrate ?? katago.rootWinrate ?? 0.5;

    const deviationInTop = katago.topMoves?.find(m => m.move === deviationGTP);
    const deviationWinrate = deviationInTop?.winrate;

    // Point loss from score lead perspective (more precise than winrate diff)
    const bestScore      = bestMove?.scoreLead ?? katago.rootScoreLead ?? 0;
    const deviationScore = deviationInTop?.scoreLead;
    const pointLoss      = deviationScore != null
      ? Math.abs(bestScore - deviationScore)
      : null;

    const topMovesStr = formatTopMoves(katago.topMoves, nextColor);
    const deviationRankStr = deviationInTop
      ? `The deviation move (${deviationGTP}) ranks #${katago.topMoves.indexOf(deviationInTop) + 1} in KataGo's top 5.`
      : `The deviation move (${deviationGTP}) is not in KataGo's top 5.`;

    const pointLossStr = pointLoss != null
      ? `Estimated point loss versus KataGo's best move: ~${pointLoss.toFixed(1)} points.`
      : `KataGo best move winrate: ${Math.round(bestWinrate * 100)}% for ${colorWord}.`;

    // ── Claude explanation ────────────────────────────────────────────
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':       'application/json',
        'x-api-key':          process.env.ANTHROPIC_API_KEY,
        'anthropic-version':  '2023-06-01',
      },
      body: JSON.stringify({
        model:      CLAUDE_MODEL,
        max_tokens: 200,
        system: `You are a Go teacher explaining a joseki deviation to a student ranked ${rank}.
KataGo has evaluated the position and provided the data below. Your job is to explain WHY the deviation is suboptimal using structural Go concepts.

GROUNDING RULES (strictly enforced):
- Reference ONLY moves and evaluations present in the KataGo data below.
- Do NOT invent point losses, win rates, or continuations not present in the data.
- Use KataGo's numbers exactly. Do not estimate or round beyond what is given.
- You may name structural patterns (Empty Triangle, overconcentration, bad aji, premature contact) ONLY when the position actually demonstrates them — do not apply pattern names speculatively.
- Keep your explanation under 80 words. No markdown.

TEACHING CALIBRATION:
- 25k–15k: Focus on the immediate shape consequence (e.g., "this wastes a stone" or "this gives up the corner").
- 15k–5k: Explain the structural concept (e.g., "this creates an empty triangle, reducing your stone efficiency").
- 5k–1d+: Discuss aji, direction of play, and long-term implications.`,
        messages: [{
          role:    'user',
          content: `${colorWord} deviated from joseki by playing at ${deviationGTP}.
${deviationRankStr}
${pointLossStr}

${topMovesStr}

Explain why this deviation is suboptimal, grounded only in the KataGo data above.`,
        }],
      }),
    });

    if (!res.ok) throw new Error(`Claude API error ${res.status}`);
    const data        = await res.json();
    const explanation = data.content[0].text;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ explanation, pointLoss, engineAvailable: true }),
    };

  } catch(e) {
    console.error('joseki-deviation error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
