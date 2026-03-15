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
- **KataGo** (via `katago-service/` on a separate VPS) — primary engine for move generation, position evaluation, and per-turn game analysis. Deployed and live.
- **Claude** (`claude-sonnet-4-6`) — narrative layer. Generates problem descriptions, game summaries, assessment conversations, and teaching commentary. Always grounded in verified facts or KataGo data; never speculates on position quality without engine support.

**Problem Library**: ~4,000 canon tsumego in the `tsumego_problems` Supabase table. Problems are selected by rank-mapped difficulty with random sampling. Claude enriches each problem with a description, first-attempt hint, and explanation at serve time — it does not generate the positions themselves.

## Core Directive: Accuracy

Goxira is a teaching tool. Inaccurate advice is worse than no advice — a student who internalizes a wrong lesson must first unlearn it.

**Do not say what you do not know.** Every feedback message, hint, or commentary must be grounded in what the system can actually verify. When the data isn't there to support a claim, say less and say it honestly. Confabulated Go advice actively harms students.

### What KataGo enables (use it)
KataGo is integrated and should be the ground truth for all position evaluation:
- `evaluate-move.js` — has full board state + KataGo win probability. Can give grounded move feedback.
- `game-hint.js` — has live position + KataGo winrate/scoreLead. Can reference concrete game state.
- `game-summary.js` — has per-turn KataGo winrate curve. Can identify real winrate drops as key moments.
- `katago-move.js` — uses KataGo for move generation; Claude is the fallback only.

### Remaining hard limits
One function still has structural constraints that must be respected:

- **`analyze-move.js` only receives the move coordinate**, not the full board state. It must not claim the move was good or bad. It can speak to strategic themes typically associated with that type of move (approach, invasion, extension, etc.) and be honest that position-specific evaluation requires engine data. This is by design — do not loosen this without also passing board state.

### Always true
- **No invented key moments.** If KataGo data isn't available for a game summary, flag fewer moments rather than fabricating them.
- **Encouragement is not a license to fudge.** Being warm and supportive is good; inventing praise about a position is not.

## Feature Status

All major features are implemented and deployed:

| Feature | Status |
|---|---|
| Conversational rank assessment | ✅ Live |
| Adaptive tsumego problems (~4,000 canon) | ✅ Live |
| Live play vs KataGo/Claude | ✅ Live |
| Teaching pause on pass | ✅ Live |
| Game review with winrate chart | ✅ Live |
| KataGo engine integration | ✅ Live (separate VPS) |
| Profile page | ✅ Live |
| Google OAuth | ✅ Live |

## Known Issues

### Mobile Stone Placement UX
Remaining issues are in the touch interaction layer (`board.js`).

- **Ghost stone slightly undersized**: The ghost stone has a 44px minimum touch target but may still read as slightly small on some devices. Verify on physical hardware.
- **Cannot abandon placement**: There is no way to cancel a stone placement in progress. The intended behavior is: dragging the ghost stone fully off the visible board area cancels the placement. This is not yet implemented.

The following issues from earlier notes are **resolved**:
- ~~No placement confirmation~~ — Fixed: a pending stone with an animated progress ring now appears immediately on finger-lift, followed by a "judging" indicator while the API evaluates.
- ~~Off-screen placement not blocked~~ — Fixed: placement is rejected if the touch point is outside the viewport.

### Streak Tracking
The streak display on the home dashboard is stubbed (shows `—`). The `problem_attempts` table has `created_at` timestamps sufficient to compute it — it just hasn't been wired up.

### supabase-schema.sql Is Incomplete
The `tsumego_problems` table (the problem library) was added directly in Supabase and is not reflected in the committed schema file. If someone self-hosts using only the schema file, they won't have the problems table. The schema file should be updated to include the table definition and, ideally, instructions for loading the problem data.
