const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

const KATAGO_SERVICE_URL = process.env.KATAGO_SERVICE_URL;
const KATAGO_TOKEN       = process.env.KATAGO_TOKEN;

// Fetch per-turn winrate from KataGo. Returns null if unavailable.
async function katagoAnalyze(sgf, boardSize) {
  if (!KATAGO_SERVICE_URL) return null;
  try {
    const res = await fetch(`${KATAGO_SERVICE_URL}/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${KATAGO_TOKEN}`,
      },
      body: JSON.stringify({ sgf, boardSize }),
    });
    if (!res.ok) return null;
    return await res.json(); // { turns: [{turnNumber, winrate, scoreLead, bestMove}] }
  } catch (e) {
    console.error('KataGo analyze error:', e.message);
    return null;
  }
}

// Summarise the winrate curve into a compact string for the Claude prompt.
// Finds the 3 biggest winrate drops for the player and includes final score.
function winrateSummary(turns, playerColor) {
  if (!turns?.length) return '';

  // From KataGo: winrate is always for Black. Flip for White player.
  const wr = t => playerColor === 'B' ? (t.winrate ?? 0.5) : (1 - (t.winrate ?? 0.5));

  // Find the 3 biggest single-move drops for the player
  const drops = [];
  for (let i = 1; i < turns.length; i++) {
    const delta = wr(turns[i]) - wr(turns[i - 1]);
    drops.push({ turn: turns[i].turnNumber, delta });
  }
  drops.sort((a, b) => a.delta - b.delta); // most negative first

  const worst = drops.slice(0, 3)
    .filter(d => d.delta < -0.03) // ignore noise
    .map(d => `move ${d.turn} (${(d.delta * 100).toFixed(0)}%)`)
    .join(', ');

  const finalWr    = Math.round(wr(turns[turns.length - 1]) * 100);
  const finalScore = turns[turns.length - 1].scoreLead;
  const scoreStr   = finalScore != null
    ? `, final score lead ${finalScore > 0 ? '+' : ''}${finalScore.toFixed(1)} for ${playerColor === 'B' ? 'Black' : 'White'}`
    : '';

  return `KataGo objective analysis — final winrate for ${playerColor === 'B' ? 'Black' : 'White'}: ${finalWr}%${scoreStr}.`
    + (worst ? ` Biggest winrate drops: ${worst}.` : ' No major mistakes detected.');
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  try {
    const { sgf, boardSize, rank, playerColor } = JSON.parse(event.body);

    // Run KataGo analysis and Claude generation in parallel
    const [katagoResult] = await Promise.all([
      katagoAnalyze(sgf, boardSize),
    ]);

    const katagoContext = katagoResult
      ? '\n\n' + winrateSummary(katagoResult.turns, playerColor)
        + ' Use these move numbers and percentages to pinpoint exactly where the game turned.'
      : '';

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 600,
        system: `You are a Go tutor summarizing a student's game. Respond ONLY with valid JSON, no markdown:
{"overallComment":"2-3 sentence assessment","keyMoments":[{"moveNumber":N,"type":"mistake|good|critical","title":"short label","explanation":"1-2 sentences"}],"studyTopic":"one concept to focus on"}

ACCURACY RULES — follow strictly:
- Only include keyMoments you can actually identify from the SGF or KataGo data (captures, ko fights, large territory swings, obvious atari sequences). If you cannot point to a specific, verifiable moment, omit it.
- Do NOT invent blunders or praise at move numbers you cannot support from the record. Fewer honest observations are far better than fabricated ones.
- overallComment should reflect the general shape of the game (who built territory where, large captures if any) — not invented assessments.
- If the SGF is too short or unclear to assess, say so honestly in overallComment and return an empty keyMoments array.
- If KataGo data is provided, use the exact move numbers and winrate percentages — be precise, not vague.`,
        messages: [{
          role: 'user',
          content: `Student rank: ${rank}. Playing as ${playerColor} on ${boardSize}x${boardSize}.${katagoContext}\nSGF: ${sgf}`,
        }],
      }),
    });

    const data = await res.json();
    const text = data.content[0].text.replace(/```json|```/g, '').trim();
    const summary = JSON.parse(text);
    return { statusCode: 200, headers, body: JSON.stringify({ summary, turns: katagoResult?.turns ?? [] }) };
  } catch(e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
