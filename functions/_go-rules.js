'use strict';

// Shared deterministic Go rules engine.
// Computes captures, atari states, and liberty counts — no inference, no LLM.
// This is the ground truth that Claude prompts are grounded in; keep it exact.
//
// Board representation: stones = { "col,row": "B"|"W" }, col/row 0-indexed,
// row 0 at the TOP of the board.

const GOCOLS = 'ABCDEFGHJKLMNOPQRST'; // standard Go notation skips I

function toGoNotation(col, row, boardSize) {
  return GOCOLS[col] + (boardSize - row);
}

// Convert {col,row: color} stones to KataGo initialStones format [["B","D5"],...]
function stonesToKataGo(stones, boardSize) {
  return Object.entries(stones || {}).map(([key, color]) => {
    const [c, r] = key.split(',').map(Number);
    return [color, GOCOLS[c] + (boardSize - r)];
  });
}

// Flood-fill: returns Set of "col,row" keys for the connected group at (col,row).
function getGroup(stones, col, row) {
  const color = stones[`${col},${row}`];
  if (!color) return null;
  const visited = new Set();
  const queue = [[col, row]];
  while (queue.length) {
    const [c, r] = queue.pop();
    const key = `${c},${r}`;
    if (visited.has(key)) continue;
    if (stones[key] !== color) continue;
    visited.add(key);
    queue.push([c - 1, r], [c + 1, r], [c, r - 1], [c, r + 1]);
  }
  return visited;
}

// Returns the Set of empty adjacent points for a group.
function getLiberties(stones, group, boardSize) {
  const liberties = new Set();
  for (const key of group) {
    const [c, r] = key.split(',').map(Number);
    for (const [nc, nr] of [[c - 1, r], [c + 1, r], [c, r - 1], [c, r + 1]]) {
      if (nc < 0 || nc >= boardSize || nr < 0 || nr >= boardSize) continue;
      if (!stones[`${nc},${nr}`]) liberties.add(`${nc},${nr}`);
    }
  }
  return liberties;
}

// Returns { captured: [{count, notations}], atari: [{count, liberty}] }
// Describes what happens to OPPONENT stones after placing color at (col, row).
function analyzeMove(initialStones, col, row, color, boardSize) {
  const stones = Object.assign({}, initialStones);
  const opponent = color === 'B' ? 'W' : 'B';
  stones[`${col},${row}`] = color;

  const captured = [];
  const visitedCapture = new Set();

  // Identify adjacent opponent groups and check for capture
  for (const [nc, nr] of [[col - 1, row], [col + 1, row], [col, row - 1], [col, row + 1]]) {
    if (nc < 0 || nc >= boardSize || nr < 0 || nr >= boardSize) continue;
    const nkey = `${nc},${nr}`;
    if (stones[nkey] !== opponent || visitedCapture.has(nkey)) continue;
    const group = getGroup(stones, nc, nr);
    for (const k of group) visitedCapture.add(k);
    if (getLiberties(stones, group, boardSize).size === 0) {
      const notations = [...group].map(k => {
        const [gc, gr] = k.split(',').map(Number);
        return toGoNotation(gc, gr, boardSize);
      }).sort();
      captured.push({ count: group.size, notations });
      for (const k of group) delete stones[k]; // remove captured stones
    }
  }

  // After captures, identify adjacent opponent groups in atari (1 liberty)
  const atari = [];
  const visitedAtari = new Set();
  for (const [nc, nr] of [[col - 1, row], [col + 1, row], [col, row - 1], [col, row + 1]]) {
    if (nc < 0 || nc >= boardSize || nr < 0 || nr >= boardSize) continue;
    const nkey = `${nc},${nr}`;
    if (stones[nkey] !== opponent || visitedAtari.has(nkey)) continue;
    const group = getGroup(stones, nc, nr);
    for (const k of group) visitedAtari.add(k);
    const libs = getLiberties(stones, group, boardSize);
    if (libs.size === 1) {
      const [lc, lr] = [...libs][0].split(',').map(Number);
      atari.push({ count: group.size, liberty: toGoNotation(lc, lr, boardSize) });
    }
  }

  return { captured, atari };
}

// Render analyzeMove() output as a verified-facts sentence for Claude prompts.
// indirectNote adds the "(indirect threat or setup move)" suffix used when the
// move being described is a known-correct solution with no direct tactics.
function tacticalFactsString(result, moveNotation, toPlayWord, opponentWord, { indirectNote = false } = {}) {
  const parts = [];
  for (const g of result.captured) {
    parts.push(
      `${toPlayWord} captures ${g.count} ${opponentWord} stone${g.count > 1 ? 's' : ''} (at ${g.notations.join(', ')})`
    );
  }
  for (const g of result.atari) {
    parts.push(
      `puts ${g.count} ${opponentWord} stone${g.count > 1 ? 's' : ''} in atari — 1 liberty remaining at ${g.liberty}`
    );
  }
  if (!parts.length) {
    parts.push(indirectNote
      ? 'no immediate captures or atari (indirect threat or setup move)'
      : 'no immediate captures or atari');
  }
  return `Verified board facts after ${moveNotation}: ${parts.join('; ')}.`;
}

// ── Pre-move full-board liberty analysis ──────────────────────────────────
// Computes liberty counts for all groups on the board BEFORE the move is played.
// Filters to contested groups (≤ 6 liberties) to give Claude grounded context
// for distinguishing attack problems (killing the opponent group) from defense
// problems (making eyes for the to-play group).

const CONTESTED_LIBERTY_MAX = 6;

function computePremoveContext(stones, toPlay, boardSize) {
  const toPlayWord   = toPlay === 'B' ? 'Black' : 'White';
  const opponentWord = toPlay === 'B' ? 'White' : 'Black';
  const visited = new Set();
  const contested = [];

  for (const key of Object.keys(stones)) {
    if (visited.has(key)) continue;
    const [c, r] = key.split(',').map(Number);
    const group = getGroup(stones, c, r);
    for (const k of group) visited.add(k);
    const libs = getLiberties(stones, group, boardSize);
    if (libs.size > CONTESTED_LIBERTY_MAX) continue; // stable group — omit to reduce noise
    const color = stones[key];
    const colorWord = color === toPlay ? toPlayWord : opponentWord;
    const stoneCoords = [...group].map(k => {
      const [gc, gr] = k.split(',').map(Number);
      return toGoNotation(gc, gr, boardSize);
    }).sort().join(', ');
    const libCoords = [...libs].map(k => {
      const [lc, lr] = k.split(',').map(Number);
      return toGoNotation(lc, lr, boardSize);
    }).sort().join(', ');
    contested.push(
      `${colorWord} group [${stoneCoords}]: ${libs.size} libert${libs.size === 1 ? 'y' : 'ies'} (${libCoords})`
    );
  }

  return contested.length
    ? `Pre-move contested groups:\n${contested.join('\n')}`
    : '';
}

// Returns 'attack' if the solution fills a liberty of a low-liberty opponent group,
// 'defense' if it expands a low-liberty to-play group, or 'unknown'.
function inferProblemRole(stones, toPlay, solutionCol, solutionRow, boardSize) {
  const opponent = toPlay === 'B' ? 'W' : 'B';
  const solutionKey = `${solutionCol},${solutionRow}`;
  const visited = new Set();

  for (const [key, color] of Object.entries(stones)) {
    if (visited.has(key)) continue;
    const [c, r] = key.split(',').map(Number);
    const group = getGroup(stones, c, r);
    for (const k of group) visited.add(k);
    const libs = getLiberties(stones, group, boardSize);
    if (libs.size > CONTESTED_LIBERTY_MAX) continue; // match computePremoveContext threshold

    if (color === opponent && libs.has(solutionKey)) return 'attack';
    if (color === toPlay) {
      const adj = [
        [solutionCol - 1, solutionRow], [solutionCol + 1, solutionRow],
        [solutionCol, solutionRow - 1], [solutionCol, solutionRow + 1],
      ];
      if (adj.some(([ac, ar]) => group.has(`${ac},${ar}`))) return 'defense';
    }
  }
  return 'unknown';
}

module.exports = {
  GOCOLS,
  toGoNotation,
  stonesToKataGo,
  getGroup,
  getLiberties,
  analyzeMove,
  tacticalFactsString,
  computePremoveContext,
  inferProblemRole,
};
