# Claude Notes

## Known Issues

### Mobile Stone Placement UX
Some work has been done on this but several problems remain. All issues are in the touch interaction layer (`board.js`).

- **Ghost stone too small**: The ghost stone that follows the finger is still slightly undersized — it should be large enough to clearly preview the placement.
- **No placement confirmation**: After lifting the finger there is a blank gap and a pause with no visual feedback. The user has no indication of where the stone landed until the app reports correct/incorrect. A confirmation indicator (e.g. the placed stone appearing immediately) is needed.
- **Cannot abandon placement**: There is no way to cancel a stone placement in progress. Dragging the ghost stone off the visible board area should cancel the placement rather than committing it.
- **Off-screen placement not blocked**: The player can currently place a stone on a part of the board that is scrolled out of view. Placement should be restricted to the visible board area only.
