# Feature Plan: Pattern Analysis & Learning Progress

## Overview

A new `progress.html` page that aggregates KataGo error data across a user's saved games to identify recurring weaknesses and produce rank-calibrated study recommendations. Consistent with the Two-System Rule: KataGo identifies errors per game, Claude synthesizes patterns across games.

---

## Error Category System (Rank-Adaptive)

Categories unlock as the student progresses. Only rank-relevant categories are shown and analyzed.

| Category       | Min rankScore | Label                    | Sensei's Library link    |
|----------------|---------------|--------------------------|--------------------------|
| `capture`      | 0 (all)       | Capturing & Atari        | Atari                    |
| `basic_life`   | 0 (all)       | Basic Life & Death       | Life_and_Death           |
| `connection`   | 0 (all)       | Connection & Cutting     | Connection               |
| `ladder`       | 1000 (~10k)   | Ladders & Nets           | Ladder                   |
| `ko`           | 1000          | Ko Fights                | Ko                       |
| `shape`        | 1000          | Stone Shape              | Shape                    |
| `direction`    | 1000          | Direction of Play        | Direction_of_Play        |
| `joseki`       | 1500 (~5k)    | Joseki & Opening         | Joseki                   |
| `influence`    | 1500          | Influence & Thickness    | Thickness                |
| `endgame`      | 2000 (~1k)    | Endgame Precision        | Endgame                  |

rankScore mapping (approximate): 0 = 30 kyu, 100/kyu, 2000 = 1 kyu, 2100+ = dan levels.

StudyTopic → category mapping:
```
Atari, Net, Snapback → capture
Life and Death       → basic_life
Ko                   → ko
Ladder, Tesuji       → ladder (tesuji is tactical reading)
Shape                → shape
Joseki               → joseki
Thickness            → influence
Direction of Play    → direction
Endgame              → endgame
```

---

## Data Schema Change

**Add column to `saved_games`:**

```sql
ALTER TABLE saved_games
  ADD COLUMN ai_summary JSONB;
```

`ai_summary` schema:
```json
{
  "overallComment": "string",
  "keyMoments": [
    { "turn": 34, "type": "mistake|good|critical", "title": "string", "explanation": "string", "category": "capture" }
  ],
  "studyTopic": "Atari",
  "errorTags": ["capture", "capture", "ladder"],
  "analyzedAt": "ISO timestamp"
}
```

`errorTags` is the flat array of per-moment categories (duplicates preserved for frequency counting).

---

## Files to Create

### 1. `netlify/functions/analyze-patterns.js`

**Purpose:** On-demand pattern analysis across a user's games.

**Input:** Auth header (JWT) — derives userId and current rank from Supabase.

**Logic:**
1. Fetch user profile (rankScore, current_rank).
2. Query `saved_games` WHERE user_id = X AND ai_summary IS NOT NULL, ORDER BY created_at DESC, LIMIT 30.
3. If fewer than 5 games with ai_summary: return `{ insufficient: true, gamesAnalyzed: N, needed: 5 }`.
4. Flatten all `ai_summary.errorTags` into one array.
5. Filter to rank-appropriate categories based on rankScore.
6. Count frequencies per category. Sort descending.
7. Call Claude with structured data only (no SGFs, no raw game text):
   - Student rank + rankScore
   - Number of games analyzed
   - Error frequency table (rank-filtered)
   - Total errors counted
8. Return: `{ topWeakAreas[], studyPriorities[], progressNotes, gamesAnalyzed, rankTier }`.

**Claude prompt contract:**
- Input: structured JSON only (frequencies, rank)
- Output: JSON with topWeakAreas (max 3), studyPriorities (with Sensei's Library links), progressNotes (1-2 sentences)
- Claude must not invent patterns not present in the frequency data
- If all frequencies are low (< 2 per category), Claude notes "not enough data in this category"

**No KataGo call** — this function only aggregates already-stored data.

---

### 2. `netlify/functions/backfill-summaries.js`

**Purpose:** Retroactively add `ai_summary` to existing saved games that lack it.

**Input:** Auth header. Optional: `limit` (default 5, max 10 per call to control cost).

**Logic:**
1. Fetch user's saved games WHERE ai_summary IS NULL, ORDER BY created_at DESC, LIMIT N.
2. For each game: call the existing game-summary flow (KataGo analyze + Claude summary).
3. Map key moments to error categories using the studyTopic → category table.
4. Write result to `saved_games.ai_summary`.
5. Return: `{ processed: N, remaining: M }`.

**Rate limiting:** Only process up to 10 games per user per call. Frontend calls this repeatedly with a progress indicator.

**Cost note:** Each game requires a KataGo full-game analysis + one Claude call. At 10 games, this is ~10 KataGo analyze calls and ~10 Claude calls. Show cost warning in UI if user has many unanalyzed games.

---

### 3. `progress.html`

**Sections:**

1. **Header**: "Your Learning Progress" + current rank badge.

2. **Analyze button / status**:
   - If < 5 games with ai_summary: "Play X more games to unlock pattern analysis" with backfill option.
   - If backfill available: "Analyze your existing games" button (calls backfill-summaries, then analyze-patterns).
   - If ready: "Refresh analysis" button.

3. **Weak areas panel** (3 cards max):
   - Category name + frequency bar (visual)
   - 1-sentence Claude explanation of what this means at their level
   - Link to Sensei's Library article
   - Example: "Capturing & Atari — you missed tactical captures in 7 of your last 10 games. → [Sensei's Library: Atari]"

4. **Study priorities** (ordered list): What to study next, from Claude's synthesis.

5. **Progress notes**: 1-2 sentence Claude comment on trend (improving? regressing? stable?).

6. **Categories not yet unlocked**: Greyed-out list showing what unlocks at higher ranks (motivational).

7. **Games analyzed count** + "last updated" timestamp.

---

## Files to Modify

### `netlify/functions/game-summary.js`

After computing key moments and studyTopic:
1. Map each keyMoment to an error category using the studyTopic → category table.
2. Add `category` field to each keyMoment object.
3. Produce `errorTags: string[]` (flat array, one entry per keyMoment that maps to a category).
4. Return `errorTags` and `category` fields in the API response.
5. **Also write to DB**: After successful analysis, `UPDATE saved_games SET ai_summary = $data WHERE id = $gameId` — requires `gameId` to be passed in the request body (already stored in `saved_games`).

**DB write note:** `game-summary.js` currently doesn't write to Supabase — it just returns data to the client. Modification: accept optional `gameId` in request body; if provided, write ai_summary to DB using the service role key. Client can then use this for pattern analysis without a separate round-trip.

### Navigation (home.html, profile.html, or nav component)

Add link to `progress.html` in navigation.

---

## Supabase RLS Policy

The `ai_summary` column lives on `saved_games`. Existing RLS already restricts `saved_games` to the owning user, so no new policy is needed.

The `backfill-summaries.js` and `analyze-patterns.js` functions use the user's JWT (passed as Authorization header) to authenticate with Supabase, inheriting the same RLS.

---

## Implementation Order

1. **Schema**: Add `ai_summary` column to `saved_games`.
2. **Error category module**: Create `netlify/functions/_errorCategories.js` (shared util) with the mapping table and rankScore→tier logic.
3. **game-summary.js**: Add error tagging + optional DB write.
4. **analyze-patterns.js**: New function.
5. **backfill-summaries.js**: New function.
6. **progress.html**: New page (vanilla JS, SVG or simple bar charts).
7. **Navigation**: Wire up link.

---

## Out of Scope (This Phase)

- Time-series trend charts (requires enough historical data first)
- Push notifications / weekly digest
- Comparing rank vs. error rate (would need more data)
- Per-category drill-down showing specific game moments
