# Goxira — Software Requirements

> Version 1.0 — March 2026
> Produced from structured interview with project creator.
> See also: `CLAUDE.md` for implementation rules and architecture constraints.

---

## 1. Product Vision

### 1.1 Mission Statement

Goxira is a free, AI-powered Go teaching application that guides beginners and early intermediate players from their first encounter with Go through to 10 kyu and beyond. It combines KataGo's analytical precision with Claude's natural language teaching to deliver warm, direct, non-hallucinated instruction — the digital equivalent of a patient sensei at a Go club.

### 1.2 Core Identity

Goxira is not just a Go app. It carries a contemplative dimension: subtle, accessible wisdom drawn from Zen koans, Buddhist suttas, Alan Watts, and classical Japanese literature (such as the Hōjōki / Ten Foot Square Hut). This wisdom layer is integral to the vision, not decorative. Go has deep roots in contemplative traditions, and Goxira honors that lineage.

### 1.3 Design Principles

- **Accuracy over encouragement.** Inaccurate advice is worse than no advice. Every claim must be grounded in verifiable data. When data is missing, say less and say it honestly.
- **Never silent.** When the AI passes, pauses, or encounters an error, it must always explain what happened and give the player a choice.
- **Warm but direct.** The Goxira voice is a sensei at a Go club: tells you what you missed and why, doesn't sugarcoat, but is never cold.
- **Player agency first.** The student always chooses whether to continue, review, or move on. Goxira never forces a pedagogical decision.
- **Compute efficiency is a first-class concern.** A feature costing $0.001/user at 1,000 users costs $1,000/day at 1,000,000. Design for low cost per user from the start.
- **Permanently free core experience.** The full pedagogical experience is free. Paid features are limited to cosmetic and non-essential items.
- **No hallucinated content.** This applies to Go commentary (grounded in KataGo data) and to wisdom content (only verified, properly attributed texts from public domain or licensed sources).

---

## 2. Target User

### 2.1 Primary Persona

The primary user is a beginner to early intermediate Go player (30 kyu through 10 kyu) who is:

- Transitioning from Atari Go to 9×9, then to full-board play
- Interested in learning openings, shapes, and fundamental strategy
- Looking for structured, progressive instruction rather than just playing against a bot
- Possibly new to Go entirely (may not yet know the rules)

### 2.2 Typical Session

A typical session: complete rank assessment (first visit), solve 3–5 tsumego problems at their level, play a 9×9 game against Goxira with live commentary, review the game afterward. Sessions are 15–45 minutes.

### 2.3 What Frustrates This User Today

- Existing Go apps provide engine-strength opponents but no teaching
- Commentary on other platforms is generic, vague, or hallucinated
- Joseki databases are overwhelming and irrelevant to beginners
- Game review is either unavailable, paywalled, or requires manual effort

---

## 3. Current State Assessment

### 3.1 What Exists and Works

| Feature | Status | Notes |
|---|---|---|
| Rank assessment (conversational) | ✅ Live | Places users from 30 kyu to dan level via chat |
| Adaptive tsumego (~4,000 problems) | ✅ Live | Rank-mapped difficulty, AI hints, spaced repetition |
| Live play vs KataGo | ✅ Live | Rank-scaled opponent, teaching pauses, live commentary |
| Game review with winrate chart | ⚠️ Live (unstable) | Works when pipeline completes; frequently hangs or times out |
| KataGo engine integration | ✅ Live | Running on Hetzner VPS with HTTP wrapper |
| Profile and rank history | ✅ Live | Tracks progress over time |
| Google OAuth | ✅ Live | Authentication working |
| Joseki dictionary | ⚠️ Live (misfit) | Functional but not useful for beginner audience |
| Progress / pattern analysis | ✅ Live | Aggregates errors across games |
| Goxira mascot | 📋 Designed | Full creative brief exists; assets not yet generated |

### 3.2 Critical Problems

#### 3.2.1 Game Review Pipeline Reliability — THE #1 PROBLEM

The `game-summary.js` serverless function attempts up to 5 sequential network calls within Netlify's 26-second function timeout:

1. KataGo full-game analysis (14s timeout)
2. Up to 3 per-moment KataGo position lookups (8s each)
3. Claude API call (whatever time remains — sometimes as little as 4s)

Result: Users see "Engine analysis unavailable, try again later" after ~30 seconds of waiting. When it works, the quality is good — the architecture is sound, the execution pipeline is too fragile.

#### 3.2.2 Commentary Quality

Claude sometimes produces generic encouragement instead of concrete Go teaching. The desired voice is a sensei at a Go club: warm but direct, telling the student what they missed and why. Current prompts are close but need tightening to eliminate filler.

#### 3.2.3 Joseki Page Misfit

The joseki dictionary is a pattern database aimed at intermediate-to-advanced players. For beginners (the primary audience), this is confusing and unhelpful. Needs to be rethought as an introduction to opening principles.

#### 3.2.4 Mobile UX Issues

- Ghost stone slightly undersized on some devices
- No way to cancel a stone placement in progress (drag-off-board cancellation not implemented)
- Fat-finger placement on smaller boards partially improved but unresolved

#### 3.2.5 Thin Learning Resources

Game review links to Sensei's Library for study topics. Feels thin. Plan: curate links to quality external resources now, build custom interactive lessons later.

---

## 4. Architecture

> See `CLAUDE.md` for the full Two-System Rule and hard architectural rules.
> This section summarizes for context.

### 4.1 The Two-System Rule

| System | Role | Produces | Cannot Do |
|---|---|---|---|
| KataGo | Go engine | Moves, win rates, score leads, top-5 candidates, ownership maps | Teach, explain, generate natural language |
| Claude | Teaching interpreter | Natural-language explanations of KataGo output, calibrated to rank | Play Go, evaluate positions, generate moves, fabricate sequences |

### 4.2 Current Stack

| Layer | Technology | Replaceable With |
|---|---|---|
| Frontend | Vanilla HTML/CSS/JS + SVG board renderer | Any static host |
| Hosting | Netlify (auto-deploy from GitHub) | Any static host + serverless |
| Backend | Netlify serverless functions | Any serverless / Node.js server |
| Database + Auth | Supabase (PostgreSQL + RLS) | Any Postgres + auth provider |
| Go engine | KataGo on Hetzner VPS (HTTP wrapper) | Any server running KataGo |
| AI teaching | Anthropic API (Claude Sonnet 4.6) | N/A (core dependency) |

---

## 5. Requirements by Priority

### 5.1 P0 — Fix What's Broken (Now)

#### 5.1.1 Redesign the Game Review Pipeline

**Problem:** `game-summary.js` tries to do too much in one 26-second serverless invocation.

**Solution:** Break the pipeline into stages:

- **Stage 1 (instant):** If cached turn data exists (from live play), render the winrate chart immediately. No KataGo call needed.
- **Stage 2 (async):** Request KataGo full-game analysis and per-moment position lookups as a background job. Poll for completion or use Supabase Realtime to push updates.
- **Stage 3 (on KataGo complete):** Send structured KataGo data to Claude for commentary. Write result to `saved_games.ai_summary`.
- **Fallback:** If KataGo is unavailable, show winrate chart (from cached turns) with an honest message. Never fabricate commentary.

**Acceptance criteria:** A 9×9 game review completes in under 30 seconds with a visible progress indicator at each stage. The user sees the winrate chart within 2 seconds if turn data is cached.

#### 5.1.2 Tighten Commentary Prompts

**Problem:** Claude sometimes produces generic encouragement instead of concrete Go teaching.

**Solution:** Revise all Claude system prompts to enforce the "sensei at a Go club" voice:

- Every sentence must contain a specific, verifiable Go concept or reference to KataGo data
- No filler phrases ("Great effort!", "Keep practicing!") unless accompanied by a concrete observation
- Rank calibration: 25k–15k = simple tactical facts, one concept; 15k–5k = strategic reasoning; 5k+ = full strategic discussion
- Maximum token budget enforced to prevent rambling

#### 5.1.3 Mobile UX Fixes

- Implement drag-off-board cancellation for stone placement
- Verify ghost stone sizing on physical devices across screen sizes
- Test and fix fat-finger placement on 9×9 boards

---

### 5.2 P1 — Near-Term Enhancements (1–3 Months)

#### 5.2.1 Goxira Mascot Integration

Full creative brief exists (Go stone body, coral/amber dorsal spines, sumi-e ink brush style, six core expressions mapped to app states).

- Generate assets via Nano Banana from existing creative brief
- Integrate mascot expressions: thinking, celebrating, encouraging, puzzled, teaching, resting
- SVG/PNG format, CSS class naming conventions per the brief
- Alternate style variants (8-bit, chibi, golden, seasonal) scoped as paid cosmetic unlocks

#### 5.2.2 Rethink Joseki Page as Opening Principles

Replace the joseki database with beginner-appropriate opening instruction:

- Why the third and fourth lines matter
- Star point vs. 3-3 point: what each gives you
- Basic whole-board thinking for 9×9 and 13×13
- Interactive board showing common opening patterns with explanations
- Hide advanced joseki content until user reaches ~10 kyu

#### 5.2.3 Curated Learning Resources

Build a resource library linking to quality external content, organized by topic (same topics as game review: Atari, Life and Death, Shape, etc.):

- YouTube video recommendations (e.g., Dwyrin, Nick Sibicky, Shawn Ray)
- Sensei's Library articles (already partially integrated)
- Book recommendations by rank level
- Surface relevant resources after game review, problem solving, and in the progress page

#### 5.2.4 Optional Rules Tutorial

Offer (but don't require) an interactive rules tutorial for absolute beginners:

- Capture mechanics (Atari Go as an on-ramp)
- Territory and scoring
- Ko rule
- When and why to pass
- Progressive: can exit at any time if the user already knows the rules

#### 5.2.5 Dark Mode

Implement a dark mode theme toggle. The existing design system (CSS custom properties) is well-structured for this — swap the paper/ink variables. The board itself stays wood-colored.

---

### 5.3 P2 — Medium-Term (3–6 Months)

#### 5.3.1 Wisdom Layer

Integrate contemplative content from canonical sources. This is a core part of the Goxira vision, not an afterthought. Three surface modes, layered in over time:

- **Ambient:** Subtle quotes on loading screens, after solving a problem, between sessions.
- **Integrated:** Wisdom tied to what just happened in the game (e.g., a koan about letting go after losing a group).
- **Dedicated:** A reading/wisdom section in the app where users can browse curated texts.

**Sources (all public domain or properly attributed):**

- Zen koan collections: Gateless Gate (Mumonkan), Blue Cliff Record, Book of Serenity, 101 Zen Stories
- Classical Japanese literature: Hōjōki (Ten Foot Square Hut) by Kamo no Chōmei
- Buddhist suttas (Pali Canon selections)
- Alan Watts quotes and passages (properly licensed/attributed)

**Hard constraint:** All wisdom content is personally curated by the creator. No AI-generated spiritual content. No hallucinated attributions. Every quote must be verified against a source text.

Database schema already drafted (five themes: Emptiness/Non-Duality, Illusion of Self, Radical Presence, Limits of Conceptual Frameworks, Cause and Effect).

#### 5.3.2 PWA / Mobile App

- Service worker for offline capability
- App manifest with mascot icon
- Offline tsumego (cache problem set locally)

#### 5.3.3 Accessibility

- Keyboard navigation for board interaction
- Screen reader support (ARIA labels for board state, stones, coordinates)
- High contrast mode
- Coordinate announcements for visually impaired players

#### 5.3.4 Internationalization

- UI string extraction into translation files
- Claude commentary language matching
- Priority languages TBD based on user demographics

---

### 5.4 P3 — Long-Term Vision (6–12+ Months)

#### 5.4.1 Multiplayer

Human-vs-human play. Differentiator vs. OGS/KGS not yet defined — only build when there's a clear answer to "why play here?"

Possible angles: teaching multiplayer (both get AI commentary), casual/friendly (nice UI, no ladders), auto-reviewed matches.

Requires: WebSocket infrastructure, matchmaking, real-time board sync, spectating.

#### 5.4.2 Social Features

- Friends list and game invitations
- Shared game collections
- Challenge system

#### 5.4.3 Custom Interactive Lessons

Build in-app animated/interactive micro-lessons replacing curated external links. Interactive board walkthroughs, animated sequences, progressive curriculum.

---

## 6. Commentary Voice Specification

The Goxira voice across all AI-generated content is modeled on a **sensei at a Go club**.

### 6.1 Voice Rules

- **Direct and specific.** Every sentence references a concrete position, move, or concept. "You played on the second line too early. In the opening, the third and fourth lines balance territory and influence."
- **Warm but not soft.** Acknowledges effort without empty praise. Never "Great job!" without a reason. "That's a solid connection — it protects the cutting point at E5."
- **One concept at a time** (for beginners). Don't explain influence, territory, and shape in the same breath.
- **Grounded.** Every evaluative claim must trace back to KataGo data. If KataGo data is absent, say so.
- **Concise.** Game review comments are 1–2 sentences per key moment. Overall summary is 2–3 sentences. Longer is not better.

### 6.2 Rank Calibration

| Rank Range | Language Level | Focus |
|---|---|---|
| 25k–15k | Simple, concrete | What happened tactically. Captures, atari, life/death. |
| 15k–5k | Strategic reasoning | Why a move was directionally wrong. Shape, influence, territory balance. |
| 5k–1d+ | Full strategic discussion | Aji, thickness, direction of play, reading depth. |

### 6.3 Anti-Patterns (Never Do These)

- Generic encouragement without a specific observation
- Inventing variations or sequences not in KataGo data
- Claiming confidence about a position without engine backing
- Multi-paragraph explanations when one sentence suffices
- Using Go jargon above the student's rank level without definition

---

## 7. Business Model and Sustainability

### 7.1 Pricing

The complete pedagogical experience is permanently free. Paid features are strictly cosmetic: mascot style variants, board themes, stone styles, profile customization.

### 7.2 Funding Path

Primary: grants and institutional support (Go federations, educational nonprofits). Secondary: donations / open-source sustainability model.

Current infrastructure cost: under $20/month. Scales linearly with users.

### 7.3 Success Metrics (12-Month Horizon)

- A few thousand to low tens of thousands of active users
- Infrastructure costs covered by grants or institutional funding
- At least one Go federation or educational institution actively using/endorsing Goxira
- Measurable student outcomes: beginners reaching 15–10 kyu

Larger upside: Goxira as proof-of-concept for AI-native teaching platform architecture transferable to chess, language learning, music.

---

## 8. Known Technical Debt

- **supabase-schema.sql incomplete:** `tsumego_problems` table and several ALTER TABLE migrations documented in comments but not in base schema.
- **Streak tracking stubbed:** Home dashboard shows "—". Data exists in `problem_attempts.created_at` but isn't wired up.
- **evaluate-move.js fabrication:** Known issue where this function could fabricate tactical sequences. Must be fully replaced with KataGo-grounded output.
- **Rank persistence:** Investigation pending on whether `updateRank` and `logAttempt` write to Supabase or only local state.
- **CLAUDE.md / PLAN.md divergence:** These files need to be reconciled into a single source of truth.

---

## 9. Development Workflow

- **This chat (Claude.ai):** Architecture decisions, planning, requirements, design review.
- **Claude Code CLI:** All implementation work. Push directly to main branch.
- **CLAUDE.md:** Source of truth for implementation rules and architecture across Claude Code sessions.
- **REQUIREMENTS.md:** Source of truth for product vision, priorities, and roadmap (this file).
- **GitHub:** Version control. Repo: `github.com/Zakkenroller/goxira`
- **Supabase SQL Editor:** Database schema changes.
- **PowerShell + SSH:** Hetzner VPS access for KataGo service.

---

## 10. Priority Summary

| Priority | What | Why | Timeline |
|---|---|---|---|
| P0 | Fix game review pipeline | #1 user-facing problem. Hangs, times out, fails. | Now |
| P0 | Tighten commentary prompts | Commentary must be concrete, not filler. | Now |
| P0 | Mobile UX fixes | Touch interaction bugs on primary platform. | Now |
| P1 | Mascot integration | Gives app personality and warmth. | 1–3 months |
| P1 | Rethink joseki → opening principles | Current page confuses beginners. | 1–3 months |
| P1 | Curated learning resources | Game review feels thin without follow-up. | 1–3 months |
| P1 | Optional rules tutorial | Support absolute beginners. | 1–3 months |
| P1 | Dark mode | User expectation; easy with existing CSS. | 1–3 months |
| P2 | Wisdom layer | Core vision. Curate contemplative content. | 3–6 months |
| P2 | PWA / offline mode | Mobile install, offline tsumego. | 3–6 months |
| P2 | Accessibility | Keyboard nav, screen readers, high contrast. | 3–6 months |
| P2 | Internationalization | Multi-language UI and commentary. | 3–6 months |
| P3 | Multiplayer | Human-vs-human with AI teaching. | 6–12+ months |
| P3 | Social features | Friends, shared games, challenges. | 6–12+ months |
| P3 | Custom interactive lessons | In-app animated walkthroughs. | 6–12+ months |
