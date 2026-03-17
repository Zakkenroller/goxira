const CLAUDE_MODEL = 'claude-sonnet-4-6';
const { keywordToCategory } = require('./_errorCategories');

const KATAGO_SERVICE_URL = process.env.KATAGO_SERVICE_URL;
const KATAGO_TOKEN       = process.env.KATAGO_TOKEN;

// Fetch per-turn winrate from KataGo. Returns null if unavailable.
async function katagoAnalyze(sgf, boardSize) {
  if (!KATAGO_SERVICE_URL) return null;
  // 18s timeout: full-game analysis (up to ~20 positions × 20 visits each) needs more
  // time than a single move query. 10s was too tight and caused frequent timeouts.
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), 18000));
  try {
    const fetchResult = fetch(`${KATAGO_SERVICE_URL}/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${KATAGO_TOKEN}`,
      },
      body: JSON.stringify({ sgf, boardSize }),
    }).then(res => res.ok ? res.json() : null).catch(() => null);
    return await Promise.race([fetchResult, timeout]);
  } catch (e) {
    console.error('KataGo analyze error:', e.message);
    return null;
  }
}

// Fetch top 5 candidate moves for a specific position in the game (by SGF up to that move).
// Used to enrich key moments with concrete alternatives.
async function katagoAnalyzePosition(sgf, boardSize, turnNumber, rank) {
  if (!KATAGO_SERVICE_URL) return null;
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), 8000));
  try {
    const fetchResult = fetch(`${KATAGO_SERVICE_URL}/move`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${KATAGO_TOKEN}`,
      },
      // Use truncated SGF up to the turn before the key moment so KataGo
      // evaluates what the player should have played at that turn.
      // Use the player's rank (not '1 dan') to keep visit count proportionate.
      body: JSON.stringify({ sgf, color: turnNumber % 2 === 0 ? 'B' : 'W', boardSize, rank }),
    }).then(res => res.ok ? res.json() : null).catch(() => null);
    return await Promise.race([fetchResult, timeout]);
  } catch (e) {
    console.error('KataGo key-moment analysis error:', e.message);
    return null;
  }
}

// Summarise the winrate curve into structured data.
// Finds the 3 biggest winrate drops for the player.
function findKeyMoments(turns, playerColor) {
  if (!turns?.length) return { moments: [], finalWr: null, finalScore: null };

  const wr = t => playerColor === 'B' ? (t.winrate ?? 0.5) : (1 - (t.winrate ?? 0.5));

  const drops = [];
  for (let i = 1; i < turns.length; i++) {
    const delta = wr(turns[i]) - wr(turns[i - 1]);
    drops.push({ turn: turns[i].turnNumber, delta, turnData: turns[i] });
  }
  drops.sort((a, b) => a.delta - b.delta); // most negative first

  const moments = drops
    .slice(0, 3)
    .filter(d => d.delta < -0.03); // ignore noise

  const last = turns[turns.length - 1];
  return {
    moments,
    finalWr: Math.round(wr(last) * 100),
    finalScore: last.scoreLead ?? null,
  };
}

// Truncate an SGF to the first N moves (to isolate a position for analysis).
function truncateSGF(sgf, moveCount) {
  const re = /;[BW]\[[^\]]*\]/g;
  let count = 0;
  let lastIndex = 0;
  let m;
  while ((m = re.exec(sgf)) !== null) {
    count++;
    if (count <= moveCount) lastIndex = m.index + m[0].length;
    else break;
  }
  // Return everything up to and including the Nth move, inside the outer parens.
  const header = sgf.slice(0, sgf.indexOf(';') + 1).replace(/;[BW].*/, '');
  const body = sgf.slice(sgf.indexOf(';'), lastIndex + 1);
  return '(' + body + ')';
}

function formatTopMovesForPrompt(topMoves, toPlayWord) {
  if (!topMoves?.length) return '';
  return topMoves.slice(0, 5).map((m, i) => {
    const winPct = Math.round((m.winrate ?? 0) * 100);
    const score = m.scoreLead != null ? `, score ${m.scoreLead > 0 ? '+' : ''}${m.scoreLead.toFixed(1)}` : '';
    const pv = m.pv?.length ? ` → sequence: ${m.pv.join(', ')}` : '';
    return `  ${i + 1}. ${m.move}: ${winPct}% for ${toPlayWord}${score}${pv}`;
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
    const { sgf, boardSize, rank, playerColor } = JSON.parse(event.body);

    const katagoResult = await katagoAnalyze(sgf, boardSize);

    // If KataGo is unavailable, return a minimal honest response — do NOT ask Claude to fabricate a review.
    if (!katagoResult) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          summary: {
            overallComment: 'Engine analysis is temporarily unavailable. Your game has been saved and will be available for full review soon.',
            keyMoments: [],
            studyTopic: null,
            studyKeyword: null,
          },
          turns: [],
        }),
      };
    }

    const toPlayWord = playerColor === 'B' ? 'Black' : 'White';
    const { moments, finalWr, finalScore } = findKeyMoments(katagoResult.turns, playerColor);

    // For each key moment, fetch the top 5 alternatives from KataGo.
    const momentDetails = await Promise.all(moments.map(async ({ turn, delta }) => {
      const truncated = truncateSGF(sgf, turn - 1);
      const analysis = await katagoAnalyzePosition(truncated, boardSize, turn, rank);
      const topMoves = analysis?.analysis?.topMoves || [];
      return {
        turn,
        delta: Math.round(delta * 100),
        topMoves,
      };
    }));

    // Build a compact winrate summary string.
    const scoreStr = finalScore != null
      ? `, final score lead ${finalScore > 0 ? '+' : ''}${finalScore.toFixed(1)} for ${playerColor === 'B' ? 'Black' : 'White'}`
      : '';
    const winrateSummaryStr = `KataGo objective analysis — final winrate for ${toPlayWord}: ${finalWr}%${scoreStr}.`
      + (moments.length > 0
        ? ` Biggest winrate drops: ${moments.map(m => `move ${m.turn} (${Math.round(m.delta * 100)}%)`).join(', ')}.`
        : ' No major mistakes detected.');

    // Build per-moment detail for the Claude prompt.
    const momentPromptParts = momentDetails.map(({ turn, delta, topMoves }) => {
      const topMovesStr = topMoves.length
        ? `\nKataGo top alternatives at move ${turn}:\n${formatTopMovesForPrompt(topMoves, toPlayWord)}`
        : `\n(Top alternatives unavailable for move ${turn}.)`;
      return `Move ${turn}: winrate dropped ${delta}% for ${toPlayWord}.${topMovesStr}`;
    }).join('\n\n');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 700,
        system: `You are a Go tutor explaining KataGo's analysis to a student ranked ${rank}.
GROUNDING RULES:
- Reference ONLY moves and evaluations present in the KataGo data provided below.
- Do NOT invent variations, sequences, or moves not in KataGo's data.
- Do NOT estimate or fabricate win rates. Use KataGo's numbers exactly.
- Only include keyMoments for turns explicitly identified in the KataGo data below. If there are no moments, return an empty array.
- Do NOT invent blunders or praise at move numbers not in the data.

TEACHING CALIBRATION:
- 25k–15k: Simple language. Focus on what happened tactically. One concept at a time.
- 15k–5k: Introduce strategic reasoning. Explain why a move was directionally wrong.
- 5k–1d+: Full strategic discussion. Discuss aji, thickness, direction of play.

Respond ONLY with valid JSON, no markdown:
{"overallComment":"2-3 sentence assessment","keyMoments":[{"moveNumber":N,"type":"mistake|good|critical","title":"short label","explanation":"1-2 sentences grounded in KataGo data"}],"studyTopic":"one concept to focus on","studyKeyword":"SenseiLibraryTopic"}

studyKeyword must be a Sensei's Library wiki page name (PascalCase, no spaces). Use ONLY well-known page names from this list:
Atari, Ladder, Net, Snapback, Ko, KoFight, Seki, LifeAndDeath, Eye, FalseEye, TwoEyes, Cutting, Connecting, CrossCut, Joseki, Fuseki, Tesuji, Sente, Gote, Tenuki, Thickness, Influence, Territory, Moyo, Invasion, Reduction, Endgame, Yose, Shape, GoodShape, EmptyTriangle, Hane, Keima, Kosumi, Nobi, Tobi, Peep, Probe, Sacrifice, Semeai, CapturingRace, LadderBreaker, Aji, Sabaki, Shinogi, Overplay, Direction, BigPoint, Komi, Handicap.
If none of these match, use the closest one.`,
        messages: [{
          role: 'user',
          content: `Student rank: ${rank}. Playing as ${playerColor} on ${boardSize}x${boardSize}.\n\n${winrateSummaryStr}\n\n${momentPromptParts}\n\nSGF: ${sgf}`,
        }],
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(`Claude API error ${res.status}: ${data.error?.message || JSON.stringify(data)}`);
    }
    const raw   = data.content[0].text;
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`Claude returned non-JSON: ${raw.slice(0, 200)}`);
    const summary = JSON.parse(match[0]);

    // Tag each key moment with an error category and produce a flat errorTags array
    // for efficient pattern aggregation across games.
    const errorTags = [];
    if (Array.isArray(summary.keyMoments)) {
      for (const moment of summary.keyMoments) {
        const category = keywordToCategory(summary.studyKeyword);
        if (category) {
          moment.category = category;
          if (moment.type === 'mistake' || moment.type === 'critical') {
            errorTags.push(category);
          }
        }
      }
    }
    summary.errorTags = errorTags;

    return { statusCode: 200, headers, body: JSON.stringify({ summary, turns: katagoResult.turns }) };
  } catch(e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
