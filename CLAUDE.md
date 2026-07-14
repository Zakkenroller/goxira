# Claude Notes

## Project Vision

Goxira is intended to be **permanently free** and eventually hyperscale. Every architectural and licensing decision should serve that goal.

- **License**: Keep open and permissive. Avoid dependencies with restrictive licenses.
- **Compute efficiency is a first-class concern**: not a nice-to-have. Design for low cost per user. A feature that costs $0.001/user at 1,000 users costs $1,000/day at 1,000,000. Think about this at every step.
- **Scaling path**: Donations, grants, or institutional support are realistic funding paths if the project grows. Nothing about the architecture should foreclose those options or create vendor lock-in.
- **Self-hostable**: Where possible, the stack should be something a motivated individual or institution can run themselves. Netlify + Supabase + a small VPS is a good model — all replaceable.
- **KataGo** is GPL-licensed. The wrapper service is kept architecturally separate (in `katago-service/`) to avoid licensing conflicts with the rest of the stack.

## Current Architecture

**Frontend**: Vanilla JS + SVG board renderer (`board.js`). No framework — intentional for performance and self-hostability.

**Backend**: Netlify Functions (serverless). All AI calls happen server-side to protect API keys.

**Database**: Supabase (PostgreSQL). Row-level security enforced — users can only read/write their own data.

**AI Stack**:
- **KataGo** (via `katago-service/` on a separate VPS) — the only Go engine. Produces moves, win rates, score leads, top-5 candidate moves with principal variations, and ownership maps. Deployed and live.
- **Claude** (`claude-sonnet-4-6`) — teaching interpreter only. Translates KataGo's numerical output into natural-language explanations calibrated to the student's rank. Claude does not play Go, evaluate positions, or generate tactical sequences. Every Claude prompt that touches position quality must receive KataGo data as input.

**Problem Library**: ~4,000 canon tsumego in the `tsumego_problems` Supabase table. Problems are selected by rank-mapped difficulty with random sampling. Claude enriches each problem with a description, first-attempt hint, and explanation at serve time — it does not generate the positions themselves.

## Core Directive: Accuracy

Goxira is a teaching tool. Inaccurate advice is worse than no advice — a student who internalizes a wrong lesson must first unlearn it.

**Do not say what you do not know.** Every feedback message, hint, or commentary must be grounded in what the system can actually verify. When the data isn't there to support a claim, say less and say it honestly. Confabulated Go advice actively harms students.

## The Two-System Rule

Goxira has exactly two AI systems with **non-overlapping roles**:

| System | Role | What it produces |
|---|---|---|
| KataGo | Go engine | Moves, win rates, score leads, top-5 candidate moves with principal variations |
| Claude | Teaching interpreter | Natural-language explanations of KataGo's output, calibrated to student rank |

**Claude cannot play Go.** It cannot evaluate positions. It cannot generate tactical sequences. It cannot estimate win rates. Any code path where the Anthropic API produces move coordinates, positional judgments, or strategic assessments without KataGo data as input is architecturally wrong.

**KataGo cannot teach.** Its output is raw numerical data. Claude explains why a move is good — but only when grounded in KataGo's data.

### What KataGo enables (use it)
KataGo now returns top-5 candidate moves with principal variations from all relevant endpoints:
- `evaluate-move.js` — receives KataGo top-5 at the problem position. Claude explains alternatives grounded in this data.
- `game-hint.js` — receives KataGo top-5 and translates to directional coaching (area, not exact coordinates).
- `game-summary.js` — receives per-turn winrate curve + top-5 alternatives at each key moment.
- `katago-move.js` — KataGo generates all opponent moves. Returns `{ move, analysis: { topMoves, rootWinrate, rootScoreLead } }`.
- `analyze-move.js` — receives full SGF + KataGo top-5 at that position. Claude explains the move in context.

### Hard rules — never violate these

- **Never add a Claude-as-engine fallback.** If KataGo is down, degrade gracefully with an honest message. Never call Claude to generate moves, evaluate positions, or produce tactical sequences.
- **Never have Claude generate move coordinates.** Claude's output must be natural language. Any GTP coordinates in a Claude response must have originated from KataGo data passed into the prompt.
- **Never silently degrade.** If KataGo is down, tell the user. A silent fallback corrupts the student's learning.
- **Never let Claude claim confidence it doesn't have.** If KataGo data is missing, Claude must disclaim it.
- **No invented key moments.** If KataGo data isn't available for a game summary, return an empty `keyMoments` array — never fabricate moments.
- **Encouragement is not a license to fudge.** Being warm and supportive is good; inventing praise about a position is not.

### KataGo degradation (what to do when the engine is down)

| Feature | KataGo unavailable behavior |
|---|---|
| Opponent move (play.html) | Stop game cleanly. Save SGF. Show user a message. Do not substitute. |
| Tsumego feedback (evaluate-move) | Claude uses only deterministic tactical facts (captures/atari). Explicit disclaimer added. |
| Live hint (game-hint) | Return honest "engine offline" message + generic universal principles only. |
| Game summary (game-summary) | Return `{ overallComment: "Engine unavailable...", keyMoments: [], studyTopic: null }`. |
| Move commentary (analyze-move) | Generic thematic observation only, with explicit disclaimer. |

## Feature Status

All major features are implemented and deployed:

| Feature | Status |
|---|---|
| Conversational rank assessment | ✅ Live |
| Adaptive tsumego problems (~4,000 canon) | ✅ Live |
| Live play vs KataGo | ✅ Live |
| Teaching pause on pass | ✅ Live |
| Game review with winrate chart | ✅ Live |
| KataGo engine integration | ✅ Live (separate VPS) |
| Profile page | ✅ Live |
| Google OAuth | ✅ Live |

## Known Issues

### Mobile Stone Placement UX
No known remaining issues. All touch interaction issues have been resolved:

- ~~Ghost stone slightly undersized~~ — Fixed: radius bumped from 44px to 52px. Ghost stone is centered on the target intersection (no vertical offset).
- ~~Cannot abandon placement~~ — Fixed: tapping anywhere outside the board SVG during the 500ms pending countdown cancels the placement. Dragging the finger off-board during the ghost phase also cancels (was already implemented).
- ~~No placement confirmation~~ — Fixed: a pending stone with an animated progress ring appears immediately on finger-lift, followed by a "judging" indicator while the API evaluates.
- ~~Off-screen placement not blocked~~ — Fixed: placement is rejected if the touch point is outside the viewport.

### Schema file
`supabase-schema.sql` includes all tables (including `tsumego_problems` with
seeding instructions, and `problem_enrichments`). When adding a table in the
Supabase dashboard, mirror it in the schema file so self-hosters stay whole.

## Server-Side Infrastructure Notes

- **Shared function modules** (`functions/_*.js`): `_go-rules.js` (deterministic
  rules engine — the ground truth Claude prompts are built on), `_claude.js`
  (the only place the Anthropic API is called; always catch `ClaudeApiError`
  and degrade honestly), `_auth.js` (Supabase JWT validation + CORS),
  `_prompts.js`, `_errorCategories.js`.
- **Auth on AI endpoints**: every money-spending function requires a Supabase
  session token once `REQUIRE_AUTH=true` is set in Netlify env. `api.js`
  attaches the token automatically. Enforcement is a deliberate two-step
  rollout: deploy first (no-op), then flip the env var.
- **Enrichment cache**: `problem.js` serves tsumego teaching text from the
  `problem_enrichments` table (keyed problem x rank band x `ENRICH_VERSION`).
  Writes require `SUPABASE_SERVICE_ROLE_KEY` in Netlify env; without it the
  cache is read-only/disabled and every serve calls Claude as before. Bump
  `ENRICH_VERSION` when the enrichment prompt changes.
- **Env vars** (Netlify): `ANTHROPIC_API_KEY`, `SUPABASE_URL`,
  `SUPABASE_ANON_KEY`, `KATAGO_SERVICE_URL`, `KATAGO_TOKEN` (existing);
  `REQUIRE_AUTH`, `SITE_ORIGIN`, `SUPABASE_SERVICE_ROLE_KEY` (added 2026-07,
  all optional — absent means prior behavior).
- `repo-export.txt` is generated at build time (`netlify.toml` build command)
  and is no longer committed.

## Requirements Document

See `REQUIREMENTS.md` for full product requirements, priority tiers, 
commentary voice spec, and roadmap. When working on any feature, 
check REQUIREMENTS.md to confirm it aligns with the stated priorities 
and voice specification.
