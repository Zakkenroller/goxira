# Claude Notes

## Known Issues

### Mobile Stone Placement UX
- **Ambiguous placement feedback**: It's not clear enough to the user exactly where the stone will land when lifting their finger.
- **Awkward pause**: There is a noticeable delay/hesitation in the mobile interface during the stone placement flow (likely between drag-end and the confirm/commit step).

Both issues are in the touch interaction layer (`board.js`).
