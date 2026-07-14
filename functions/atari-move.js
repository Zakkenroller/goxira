'use strict';

const { corsHeaders, requireUser } = require('./_auth');

// Dedicated Atari Go (capture Go) minimax engine.
// KataGo is trained for standard Go and has no concept of Atari Go's win
// condition (first to N captures). This engine solves the right problem:
// every move is chosen to maximise captures and minimise being captured.
//
// Algorithm: alpha-beta minimax with iterative deepening and move ordering.
// Depth by difficulty: easier=3, auto/match=5, harder=7.
// Runs entirely serverless — no VPS needed.

const HEADERS = corsHeaders();

const DEPTH_BY_DIFFICULTY = { easier: 3, auto: 5, match: 5, harder: 7 };
const WIN  =  1_000_000;
const LOSE = -1_000_000;

// ── Board primitives ─────────────────────────────────────────────────────────

function neighbors(col, row, size) {
  const r = [];
  if (col > 0)        r.push([col - 1, row]);
  if (col < size - 1) r.push([col + 1, row]);
  if (row > 0)        r.push([col, row - 1]);
  if (row < size - 1) r.push([col, row + 1]);
  return r;
}

// Flood-fill: returns Set of "col,row" keys for the connected group at (col,row).
function getGroup(stones, col, row, size) {
  const color = stones[`${col},${row}`];
  if (!color) return new Set();
  const visited = new Set();
  const queue = [[col, row]];
  while (queue.length) {
    const [c, r] = queue.pop();
    const key = `${c},${r}`;
    if (visited.has(key)) continue;
    if (stones[key] !== color) continue;
    visited.add(key);
    for (const [nc, nr] of neighbors(c, r, size)) {
      if (!visited.has(`${nc},${nr}`)) queue.push([nc, nr]);
    }
  }
  return visited;
}

// Returns the number of distinct liberties (empty adjacent points) for a group.
function libertyCount(stones, group, size) {
  const libs = new Set();
  for (const key of group) {
    const [c, r] = key.split(',').map(Number);
    for (const [nc, nr] of neighbors(c, r, size)) {
      if (!stones[`${nc},${nr}`]) libs.add(`${nc},${nr}`);
    }
  }
  return libs.size;
}

// Returns true if placing color at (col,row) is legal.
// Temporarily mutates stones — always restores before returning.
function isLegal(stones, col, row, color, size) {
  const key = `${col},${row}`;
  if (stones[key]) return false;
  const opponent = color === 'B' ? 'W' : 'B';
  stones[key] = color;

  // Legal if it captures at least one opponent group.
  let captures = false;
  const seen = new Set();
  for (const [nc, nr] of neighbors(col, row, size)) {
    const nk = `${nc},${nr}`;
    if (stones[nk] !== opponent || seen.has(nk)) continue;
    const grp = getGroup(stones, nc, nr, size);
    grp.forEach(k => seen.add(k));
    if (libertyCount(stones, grp, size) === 0) { captures = true; break; }
  }

  // Otherwise legal only if own group retains at least one liberty.
  const legal = captures || libertyCount(stones, getGroup(stones, col, row, size), size) > 0;
  delete stones[key];
  return legal;
}

// Apply a move. Returns {stones, captures} (new immutable objects) or null if illegal.
function applyMove(stones, caps, col, row, color, size) {
  const key = `${col},${row}`;
  if (stones[key]) return null;
  const opponent = color === 'B' ? 'W' : 'B';

  const ns = { ...stones, [key]: color };
  const nc = { B: caps.B, W: caps.W };

  // Remove captured opponent groups.
  const removed = new Set();
  for (const [ac, ar] of neighbors(col, row, size)) {
    const ak = `${ac},${ar}`;
    if (ns[ak] !== opponent || removed.has(ak)) continue;
    const grp = getGroup(ns, ac, ar, size);
    if (libertyCount(ns, grp, size) === 0) {
      for (const k of grp) { delete ns[k]; removed.add(k); }
      nc[color] += grp.size;
    }
  }

  // Suicide check: own group must have at least one liberty after captures.
  if (libertyCount(ns, getGroup(ns, col, row, size), size) === 0) return null;

  return { stones: ns, captures: nc };
}

// Returns all legal moves for color as [{col, row}].
function legalMoves(stones, color, size) {
  const moves = [];
  for (let c = 0; c < size; c++) {
    for (let r = 0; r < size; r++) {
      if (!stones[`${c},${r}`] && isLegal(stones, c, r, color, size)) {
        moves.push({ col: c, row: r });
      }
    }
  }
  return moves;
}

// Heuristic priority for move ordering (higher = search first).
// Temporarily mutates stones — always restores.
function moveOrderScore(stones, col, row, color, size) {
  const opponent = color === 'B' ? 'W' : 'B';
  let score = 0;
  stones[`${col},${row}`] = color;

  const seen = new Set();
  for (const [nc, nr] of neighbors(col, row, size)) {
    const nk = `${nc},${nr}`;
    if (stones[nk] !== opponent || seen.has(nk)) continue;
    const grp = getGroup(stones, nc, nr, size);
    grp.forEach(k => seen.add(k));
    const libs = libertyCount(stones, grp, size);
    if (libs === 0) score += 2000 * grp.size;      // immediate capture
    else if (libs === 1) score += 100 * grp.size;  // puts opponent in atari
  }

  delete stones[`${col},${row}`];
  return score;
}

// Static evaluation at leaf nodes. Positive = engine winning.
function evaluate(stones, caps, target, engineColor, playerColor, size) {
  if (caps[engineColor] >= target) return WIN;
  if (caps[playerColor] >= target) return LOSE;

  // Capture lead.
  let score = (caps[engineColor] - caps[playerColor]) * 200;

  // Liberty-threat bonus: groups in atari or near-atari are dangerous.
  const visited = new Set();
  for (const key of Object.keys(stones)) {
    if (visited.has(key)) continue;
    const [c, r] = key.split(',').map(Number);
    const color = stones[key];
    const grp = getGroup(stones, c, r, size);
    grp.forEach(k => visited.add(k));
    const libs = libertyCount(stones, grp, size);
    // From engine's perspective: opponent group threatened = good, own threatened = bad.
    if (libs === 1)      score += color === playerColor ?  80 : -80;
    else if (libs === 2) score += color === playerColor ?  20 : -20;
  }

  return score;
}

// Alpha-beta minimax. isEngineMove=true means engine is about to play.
function minimax(stones, caps, depth, alpha, beta, isEngineMove,
                 engineColor, playerColor, target, size, deadline) {
  // Terminal checks — prefer faster wins (higher depth remaining = shallower = faster).
  if (caps[engineColor] >= target) return WIN + depth;
  if (caps[playerColor] >= target) return LOSE - depth;
  if (depth === 0 || Date.now() > deadline) {
    return evaluate(stones, caps, target, engineColor, playerColor, size);
  }

  const color = isEngineMove ? engineColor : playerColor;
  const moves = legalMoves(stones, color, size);

  if (moves.length === 0) {
    // No legal moves — treat as pass and continue.
    if (depth <= 1) return evaluate(stones, caps, target, engineColor, playerColor, size);
    return minimax(stones, caps, depth - 1, alpha, beta, !isEngineMove,
                   engineColor, playerColor, target, size, deadline);
  }

  // Move ordering: captures and atari-creators searched first for better pruning.
  moves.sort((a, b) =>
    moveOrderScore(stones, b.col, b.row, color, size) -
    moveOrderScore(stones, a.col, a.row, color, size)
  );

  if (isEngineMove) {
    let best = -Infinity;
    for (const m of moves) {
      const next = applyMove(stones, caps, m.col, m.row, color, size);
      if (!next) continue;
      const score = minimax(next.stones, next.captures, depth - 1, alpha, beta, false,
                            engineColor, playerColor, target, size, deadline);
      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (beta <= alpha) break; // prune
    }
    return best === -Infinity ? 0 : best;
  } else {
    let best = Infinity;
    for (const m of moves) {
      const next = applyMove(stones, caps, m.col, m.row, color, size);
      if (!next) continue;
      const score = minimax(next.stones, next.captures, depth - 1, alpha, beta, true,
                            engineColor, playerColor, target, size, deadline);
      if (score < best) best = score;
      if (score < beta) beta = score;
      if (beta <= alpha) break; // prune
    }
    return best === Infinity ? 0 : best;
  }
}

// Root search. Returns the best {col, row} move for engineColor.
function findBestMove(stones, caps, engineColor, playerColor, size, target, maxDepth) {
  const deadline = Date.now() + 20000; // 20s safety margin within 26s Netlify timeout
  const moves = legalMoves(stones, engineColor, size);
  if (moves.length === 0) return null;

  // Root-level move ordering.
  moves.sort((a, b) =>
    moveOrderScore(stones, b.col, b.row, engineColor, size) -
    moveOrderScore(stones, a.col, a.row, engineColor, size)
  );

  let bestMove = moves[0]; // safe fallback in case of timeout
  let alpha = -Infinity;

  for (const m of moves) {
    if (Date.now() > deadline) break;
    const next = applyMove(stones, caps, m.col, m.row, engineColor, size);
    if (!next) continue;
    const score = minimax(next.stones, next.captures, maxDepth - 1, alpha, Infinity, false,
                          engineColor, playerColor, target, size, deadline);
    if (score > alpha) {
      alpha = score;
      bestMove = m;
    }
  }

  return bestMove;
}

// ── Netlify handler ───────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS };

  const auth = await requireUser(event);
  if (auth.errorResponse) return auth.errorResponse;

  try {
    const { currentStones, engineColor, boardSize, atariTarget, difficulty, captures } =
      JSON.parse(event.body);

    if (!currentStones || !engineColor || !boardSize || !atariTarget) {
      return { statusCode: 400, headers: HEADERS,
               body: JSON.stringify({ error: 'missing required fields' }) };
    }

    const playerColor = engineColor === 'B' ? 'W' : 'B';
    const size   = parseInt(boardSize);
    const target = parseInt(atariTarget);
    const depth  = DEPTH_BY_DIFFICULTY[difficulty] ?? 5;
    const caps   = captures || { B: 0, W: 0 };

    const move = findBestMove(currentStones, caps, engineColor, playerColor, size, target, depth);

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ move: move ?? { col: -1, row: -1 } }),
    };
  } catch (e) {
    console.error('atari-move error:', e);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: e.message }) };
  }
};
