# Claude Notes

## Core Directive: Accuracy

Goxira is a teaching tool. Inaccurate advice is worse than no advice — a student who internalizes a wrong lesson must first unlearn it.

**Do not say what you do not know.** Every feedback message, hint, or commentary must be grounded in what the system can actually verify. When the data isn't there to support a claim, say less and say it honestly. Confabulated Go advice actively harms students.

Claude has general Go knowledge but cannot reliably evaluate specific board positions without engine support. **KataGo integration is planned.** Until then, all advice-giving functions must respect these hard limits:

- **No move verdicts without board state.** Do not claim a move was good or bad unless the system has the full position. `analyze-move.js` only receives the move coordinate — it must not pretend to evaluate it.
- **No invented key moments.** Game summaries must only flag moments the model can actually assess from the SGF. Fewer real observations beat fabricated ones.
- **Hints speak to principles, not verdicts.** Live commentary can observe what's on the board; it cannot claim to know the best line.
- **Problem explanations stay grounded.** `problem.js` knows the correct answer coordinate but not the visual board — explanations must reflect what can be said about the move type and general tactical idea, not invented specifics.
- **Encouragement is not a license to fudge.** Being warm and supportive is good; inventing praise or false confidence about a position is not.

## Known Issues

### Mobile Stone Placement UX
Some work has been done on this but several problems remain. All issues are in the touch interaction layer (`board.js`).

- **Ghost stone too small**: The ghost stone that follows the finger is still slightly undersized — it should be large enough to clearly preview the placement.
- **No placement confirmation**: After lifting the finger there is a blank gap and a pause with no visual feedback. The user has no indication of where the stone landed until the app reports correct/incorrect. A confirmation indicator (e.g. the placed stone appearing immediately) is needed.
- **Cannot abandon placement**: There is no way to cancel a stone placement in progress. Dragging the ghost stone off the visible board area should cancel the placement rather than committing it.
- **Off-screen placement not blocked**: The player can currently place a stone on a part of the board that is scrolled out of view. Placement should be restricted to the visible board area only.
