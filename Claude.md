# Goxira — Project Context for Claude Code

## What This Is
Goxira is a free, public-facing AI-powered Go (board game) tutor.
Users can solve tsumego problems, play games against Claude, and 
get move-by-move analysis of their games. The standout feature is 
plain-language post-game review explaining mistakes.

## Tech Stack
- **Frontend:** Plain HTML, CSS, JavaScript — no frameworks
- **Hosting:** Netlify (auto-deploys from GitHub main branch)
- **Serverless functions:** Netlify functions in /functions folder
- **Auth + Database:** Supabase (Google OAuth + email/password)
- **AI:** Anthropic API (Claude) via Netlify functions
- **Board rendering:** WGo.js or equivalent Go library
- **Future:** KataGo server for move analysis (not yet implemented)

## Design Language
- Ink-and-paper Go aesthetic throughout
- Calm, minimal, zen — no bright colors or flashy animations
- Mobile-first — must work equally well on mobile and desktop web
- Subtle feedback only — pulses, fades, not celebrations

## File Structure
- assess.html / assess.js — assessment screen (entry after auth)
- auth.html — authentication
- home.html — dashboard (placeholder, not yet built)
- play.html — live game against Claude
- problems.html — tsumego/puzzle screen
- styles.css — shared styles across all pages
- board.js — board rendering and touch/click interaction
- /functions — all Netlify serverless functions

## Serverless Functions (already built)
- assess.js — evaluates user answers to determine starting rank
- analyze-move.js — analyzes a single move
- claude-move.js — generates Claude's next move in a live game
- evaluate-move.js — evaluates a player's move
- game-summary.js — post-game analysis and summary
- game-hint.js — provides hints during a game
- problem.js — generates tsumego problems

## Current Roadmap
1. ✅ Auth (working end-to-end)
2. ✅ Mobile stone placement UI fixes
3. 🔄 Assessment screen (assess.html / assess.js)
4. ⬜ Dashboard (home.html)
5. ⬜ Teaching and tutoring flows
6. ⬜ KataGo server integration (Hetzner VPS)

## Supabase
- Auth is working — do not touch the auth flow unless explicitly asked
- User profile stores rank and board size preference
- All Supabase calls go through supabase-client.js

## Hard Rules — Always Follow These
- Every UI change must work on both mobile and desktop web
- problems.html and play.html must have consistent UI behavior
- Never break the existing Supabase auth flow
- All API calls to Anthropic must go through Netlify functions —
  never call the Anthropic API directly from the frontend
- Match the ink-and-paper aesthetic in all new UI elements
- Board and immediate feedback must both be visible without 
  scrolling on a standard mobile screen

## Known Issues Log
- Stone placement on mobile: ghost stone offset above finger ✅
- Move counter in problems: fixed ✅
- Move confirmation flash on placement: in progress
- Feedback below fold on mobile: in progress

## Future Feature (Pinned — Do Not Build Yet)
Zen koan + Buddhist sutta pairing system tied to Go puzzle types.
Five themes: Emptiness/Non-Duality, Illusion of Self, Radical 
Presence, Limits of Conceptual Frameworks, Cause and Effect.
Collections: 101 Zen Stories, Mumonkan (48), Blue Cliff Record 
(100), Book of Serenity (100).
Do not build this until the core app is complete.
```

---

**How to add it:**

In Claude Code, just say:
```
Create a file called CLAUDE.md in the root of the repo 
with the following content: [paste above]
