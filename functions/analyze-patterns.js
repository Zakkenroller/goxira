/**
 * analyze-patterns.js
 * Aggregates error data across a user's saved games and produces rank-calibrated
 * study recommendations via Claude.
 *
 * The client fetches game summaries directly from Supabase (using its anon key
 * with RLS), then sends the structured data here. No service role key needed.
 *
 * Input (POST body):
 *   {
 *     games: [{ id, ai_summary: { errorTags, studyKeyword, ... }, created_at }],
 *     rank: "12 kyu",
 *     rankScore: 1800
 *   }
 *
 * Output:
 *   {
 *     topWeakAreas: [{ category, label, count, sensei, explanation }],
 *     studyPriorities: [{ priority, topic, reason, senseiUrl }],
 *     progressNotes: "string",
 *     gamesAnalyzed: N,
 *     rankTier: "intermediate"
 *   }
 */

const CLAUDE_MODEL  = 'claude-sonnet-4-6';
const MIN_GAMES     = 5;

const { visibleCategories, categoryMeta } = require('./_errorCategories');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  try {
    const { games, rank, rankScore } = JSON.parse(event.body);

    if (!Array.isArray(games)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'games array required' }) };
    }

    // Only games that have been analyzed (have ai_summary with errorTags)
    const analyzed = games.filter(g => g.ai_summary?.errorTags?.length >= 0 && g.ai_summary?.studyKeyword !== undefined);

    if (analyzed.length < MIN_GAMES) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ insufficient: true, gamesAnalyzed: analyzed.length, needed: MIN_GAMES }),
      };
    }

    // Determine rank tier label for Claude calibration
    const rankTier = rankScore < 1000 ? 'beginner'
                   : rankScore < 1500 ? 'intermediate'
                   : rankScore < 2000 ? 'advanced'
                   : 'dan';

    // Visible categories for this student's level
    const visible = visibleCategories(rankScore);

    // Aggregate error frequencies (only visible categories)
    const freq = {};
    for (const cat of visible) freq[cat] = 0;

    for (const game of analyzed) {
      for (const tag of (game.ai_summary.errorTags || [])) {
        if (visible.includes(tag)) freq[tag]++;
      }
    }

    // Sort by frequency descending, filter zeros
    const ranked = Object.entries(freq)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1]);

    if (ranked.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          topWeakAreas: [],
          studyPriorities: [],
          progressNotes: `No clear error patterns found across ${analyzed.length} analyzed games. Keep playing to build up data.`,
          gamesAnalyzed: analyzed.length,
          rankTier,
        }),
      };
    }

    // Build frequency table for Claude prompt
    const freqTable = ranked
      .map(([cat, count]) => `  ${categoryMeta(cat).label}: ${count} occurrence${count !== 1 ? 's' : ''} across ${analyzed.length} games`)
      .join('\n');

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
        system: `You are a Go tutor analyzing a student's error patterns across multiple games.
You receive ONLY aggregated frequency counts — not raw game data. Work strictly from the numbers provided.

RULES:
- Do not invent patterns not supported by the frequency data.
- If a category has low counts (1-2), note that it may not be a reliable pattern yet.
- Calibrate language to the student's level: ${rankTier} (${rank}).
- Beginner: focus on basic tactical awareness. Intermediate: introduce strategic concepts. Advanced/dan: nuanced discussion.
- Keep explanations short and actionable.

Respond ONLY with valid JSON, no markdown:
{
  "topWeakAreas": [
    { "category": "capture", "label": "Capturing & Atari", "count": 7, "explanation": "1 sentence on what this pattern means for a player at this level" }
  ],
  "studyPriorities": [
    { "priority": 1, "topic": "Atari", "reason": "1 sentence", "senseiKeyword": "Atari" }
  ],
  "progressNotes": "1-2 sentence overall observation. If data is thin, say so honestly."
}

Include at most 3 items in topWeakAreas (highest frequency first) and at most 3 in studyPriorities.
senseiKeyword must be a valid Sensei's Library PascalCase page name.`,
        messages: [{
          role: 'user',
          content: `Student rank: ${rank} (${rankTier} level, score ${rankScore}).
Games analyzed: ${analyzed.length}.

Error frequencies (rank-appropriate categories only):
${freqTable}`,
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
    const result = JSON.parse(match[0]);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ...result,
        gamesAnalyzed: analyzed.length,
        rankTier,
      }),
    };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
