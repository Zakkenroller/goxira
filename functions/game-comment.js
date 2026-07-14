const CLAUDE_MODEL = 'claude-sonnet-4-6';
const { keywordToCategory } = require('./_errorCategories');
const { formatTopMovesForPrompt } = require('./_prompts');
const { callClaude } = require('./_claude');
const { corsHeaders, requireUser } = require('./_auth');

// Bump when commentary logic changes significantly.
// Any cached summary with a lower version is treated as stale and regenerated.
const SUMMARY_VERSION = 1;

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  const auth = await requireUser(event);
  if (auth.errorResponse) return auth.errorResponse;

  try {
    const { rank, playerColor, boardSize, turns, momentDetails } = JSON.parse(event.body);

    const toPlayWord = playerColor === 'B' ? 'Black' : 'White';

    // If no turns data, KataGo was unavailable — return honest fallback without calling Claude.
    if (!turns?.length) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          summary: {
            overallComment: 'Engine analysis is temporarily unavailable. Your game has been saved and will be available for full review soon.',
            keyMoments: [],
            studyTopic: null,
            studyKeyword: null,
            errorTags: [],
          },
        }),
      };
    }

    // Build winrate summary string from turns data.
    const wr = t => playerColor === 'B' ? (t.winrate ?? 0.5) : (1 - (t.winrate ?? 0.5));
    const last = turns[turns.length - 1];
    const finalWr = Math.round(wr(last) * 100);
    const finalScore = last.scoreLead ?? null;

    const scoreStr = finalScore != null
      ? `, final score lead ${finalScore > 0 ? '+' : ''}${finalScore.toFixed(1)} for ${playerColor === 'B' ? 'Black' : 'White'}`
      : '';
    const winrateSummaryStr = `KataGo objective analysis — final winrate for ${toPlayWord}: ${finalWr}%${scoreStr}.`
      + (momentDetails?.length > 0
        ? ` Biggest winrate drops: ${momentDetails.map(m => `move ${m.turn} (${m.delta}%)`).join(', ')}.`
        : ' No major mistakes detected.');

    // Build per-moment detail for the Claude prompt.
    const momentPromptParts = (momentDetails ?? []).map(({ turn, delta, topMoves }) => {
      const topMovesStr = topMoves?.length
        ? `\nKataGo top alternatives at move ${turn}:\n${formatTopMovesForPrompt(topMoves, toPlayWord)}`
        : `\n(Top alternatives unavailable for move ${turn}.)`;
      return `Move ${turn}: winrate dropped ${delta}% for ${toPlayWord}.${topMovesStr}`;
    }).join('\n\n');

    // Claude has the full function budget here — no preceding KataGo cost.
    // 20s timeout leaves 6s buffer within Netlify's 26s limit.
    let summary;
    try {
      const raw = await callClaude({
        model: CLAUDE_MODEL,
        maxTokens: 500,
        timeoutMs: 20000,
        system: `You are a Go sensei delivering post-game feedback to a student ranked ${rank}. Your job is to identify what actually happened in the game and why it mattered — grounded in the KataGo data below.
GROUNDING RULES:
- Reference ONLY moves and evaluations present in the KataGo data provided below.
- Do NOT invent variations, sequences, or moves not in KataGo's data.
- Do NOT estimate or fabricate win rates. Use KataGo's numbers exactly.
- Only include keyMoments for turns explicitly identified in the KataGo data below. If there are no moments, return an empty array.
- Do NOT invent blunders or praise at move numbers not in the data.

VOICE (enforce strictly):
- Every sentence must contain at least one of: a move number from the data, a KataGo percentage or score, or a named Go concept applied to this specific game.
- Do NOT use: "Great effort", "Well played", "Keep practicing", "You're improving", or any phrase that could apply to any game regardless of the data.
- Warm ≠ vague. You may acknowledge a good move — but only by stating what it achieved: "Connecting at move 14 was the right call — it shut down the cut."

TEACHING CALIBRATION:
- 25k–15k: Simple language. Focus on what happened tactically. One concept at a time.
- 15k–5k: Introduce strategic reasoning. Explain why a move was directionally wrong.
- 5k–1d+: Full strategic discussion. Discuss aji, thickness, direction of play.

TSUMEGO CONNECTION:
- If a key moment involves a pattern commonly trained through tsumego (life and death, ladder, net, snapback, cutting points, capturing race), briefly note that connection in the explanation — e.g. "this is a life-and-death problem in miniature" or "spotting ladders like this is exactly what tsumego practice builds."
- Only mention the connection when it is genuinely present in the KataGo data. Do not invent connections.

Respond ONLY with valid JSON, no markdown:
{"overallComment":"2-3 sentences. Must reference a specific game feature (a move number, the score, a territorial outcome). No generic encouragement.","keyMoments":[{"moveNumber":N,"type":"mistake|good|critical","title":"short label","explanation":"1-2 sentences grounded in KataGo data"}],"studyTopic":"one concept to focus on","studyKeyword":"SenseiLibraryTopic"}

studyKeyword must be a Sensei's Library wiki page name (PascalCase, no spaces). Use ONLY well-known page names from this list:
Atari, Ladder, Net, Snapback, Ko, KoFight, Seki, LifeAndDeath, Eye, FalseEye, TwoEyes, Cutting, Connecting, CrossCut, Joseki, Fuseki, Tesuji, Sente, Gote, Tenuki, Thickness, Influence, Territory, Moyo, Invasion, Reduction, Endgame, Yose, Shape, GoodShape, EmptyTriangle, Hane, Keima, Kosumi, Nobi, Tobi, Peep, Probe, Sacrifice, Semeai, CapturingRace, LadderBreaker, Aji, Sabaki, Shinogi, Overplay, Direction, BigPoint, Komi, Handicap.
If none of these match, use the closest one.`,
        messages: [{
          role: 'user',
          content: `Student rank: ${rank}. Playing as ${playerColor} on ${boardSize}x${boardSize}.\n\n${winrateSummaryStr}\n\n${momentPromptParts}`,
        }],
      });
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error(`Claude returned non-JSON: ${raw.slice(0, 200)}`);
      summary = JSON.parse(match[0]);
    } catch (claudeErr) {
      console.error('Claude commentary failed:', claudeErr.message);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          summary: {
            overallComment: 'Game commentary is temporarily unavailable, but your winrate chart is shown above.',
            keyMoments: [],
            studyTopic: null,
            studyKeyword: null,
            errorTags: [],
          },
        }),
      };
    }

    // Tag each key moment with an error category and produce a flat errorTags array.
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
    summary.version = SUMMARY_VERSION;

    return { statusCode: 200, headers, body: JSON.stringify({ summary }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
