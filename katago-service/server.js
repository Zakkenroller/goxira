// KataGo HTTP wrapper service
// Runs on the Hetzner VPS. Manages a persistent KataGo analysis engine process
// and exposes it as a simple HTTP API.

const { spawn } = require('child_process');
const readline = require('readline');
const http = require('http');

const KATAGO_BINARY      = process.env.KATAGO_BINARY      || '/usr/local/bin/katago';
const KATAGO_MODEL       = process.env.KATAGO_MODEL       || '/opt/katago/model.bin.gz';
const KATAGO_CONFIG      = process.env.KATAGO_CONFIG      || '/opt/katago/analysis.cfg';
const KATAGO_HUMAN_MODEL = process.env.KATAGO_HUMAN_MODEL || ''; // optional; enables humanSL play
const PORT               = parseInt(process.env.PORT || '3000');
const AUTH_TOKEN         = process.env.KATAGO_TOKEN;

// ---------- KataGo engine ----------

class KataGoEngine {
  constructor() {
    // pending: id -> { resolve, reject, expected, accumulated }
    // expected === 1: single-response query (resolve with one object)
    // expected > 1:   multi-response query (resolve with array when all received)
    this.pending = new Map();
    this.idCounter = 0;
    this.proc = null;
    this.ready = false;
  }

  start() {
    const args = ['analysis', '-model', KATAGO_MODEL, '-config', KATAGO_CONFIG];
    if (KATAGO_HUMAN_MODEL) args.push('-human-model', KATAGO_HUMAN_MODEL);
    this.proc = spawn(KATAGO_BINARY, args);

    // Watchdog: if KataGo doesn't report ready within 120s, it's stuck —
    // kill it and let the exit handler trigger a fresh restart.
    this._startupWatchdog = setTimeout(() => {
      if (!this.ready) {
        console.error('KataGo startup watchdog: not ready after 120s — killing to force restart');
        if (this.proc) this.proc.kill('SIGKILL');
      }
    }, 120000);

    this.proc.stderr.on('data', (data) => {
      const msg = data.toString();
      if (!this.ready && msg.includes('Started')) {
        this.ready = true;
        clearTimeout(this._startupWatchdog);
        console.log('KataGo ready');
      }
      if (msg.toLowerCase().includes('error') || msg.toLowerCase().includes('warning')) {
        console.error('KataGo:', msg.trim());
      }
    });

    const rl = readline.createInterface({ input: this.proc.stdout });
    rl.on('line', (line) => {
      line = line.trim();
      if (!line) return;
      let data;
      try { data = JSON.parse(line); } catch (_) { return; }

      const entry = this.pending.get(data.id);
      if (!entry) return;

      entry.accumulated.push(data);
      if (entry.accumulated.length >= entry.expected) {
        this.pending.delete(data.id);
        clearTimeout(entry.timer);
        if (entry.expected === 1) {
          entry.resolve(entry.accumulated[0]);
        } else {
          entry.resolve(entry.accumulated);
        }
      }
    });

    this.proc.on('exit', (code) => {
      console.error(`KataGo exited (code ${code}), restarting in 3s...`);
      this.ready = false;
      clearTimeout(this._startupWatchdog);
      // Reject all pending queries
      for (const [, entry] of this.pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error('KataGo restarted'));
      }
      this.pending.clear();
      setTimeout(() => this.start(), 3000);
    });
  }

  _send(params, expected, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (!this.ready) return reject(new Error('KataGo not ready'));

      const id = String(++this.idCounter);
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('KataGo query timeout'));
          // Kill the process — the exit handler will clear remaining pending
          // queries and restart KataGo. Without this, a hung KataGo process
          // causes every subsequent query to also hang until manual restart.
          console.error(`KataGo query ${id} timed out — killing process to force restart`);
          if (this.proc) this.proc.kill('SIGKILL');
        }
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer, expected, accumulated: [] });
      this.proc.stdin.write(JSON.stringify({ ...params, id }) + '\n');
    });
  }

  // Single-response query (for move generation)
  query(params) {
    return this._send(params, 1, 30000);
  }

  // Multi-response query (for full-game analysis)
  queryAll(params, expected) {
    return this._send(params, expected, 120000);
  }
}

const engine = new KataGoEngine();
engine.start();

// ---------- helpers ----------

const COLS = 'ABCDEFGHJKLMNOPQRST';

// Parse SGF move sequence into KataGo format: [["B","D4"],["W","Q16"],...]
function parseSGFMoves(sgf, boardSize) {
  const moves = [];
  const re = /;([BW])\[([a-z]{0,2})\]/g;
  let m;
  while ((m = re.exec(sgf)) !== null) {
    const coord = m[2];
    if (!coord) {
      moves.push([m[1], 'pass']);
    } else {
      const c = coord.charCodeAt(0) - 97;
      const r = coord.charCodeAt(1) - 97;
      moves.push([m[1], COLS[c] + (boardSize - r)]);
    }
  }
  return moves;
}

// Extract AB[] handicap stones from SGF header into KataGo initialStones format.
function parseInitialStones(sgf, boardSize) {
  const abProp = sgf.match(/\bAB((?:\[[a-z]{2}\])+)/);
  if (!abProp) return [];
  return [...abProp[1].matchAll(/\[([a-z]{2})\]/g)].map(m => {
    const c = m[1].charCodeAt(0) - 97;
    const r = m[1].charCodeAt(1) - 97;
    return ['B', COLS[c] + (boardSize - r)];
  });
}

// GTP move ("Q4") -> goxira {col, row}
function gtpToCoords(gtp, boardSize) {
  if (!gtp || gtp.toLowerCase() === 'pass') return { col: -1, row: -1 };
  const col = COLS.indexOf(gtp[0].toUpperCase());
  const row = boardSize - parseInt(gtp.slice(1), 10);
  if (col < 0 || col >= boardSize || row < 0 || row >= boardSize) return { col: -1, row: -1 };
  return { col, row };
}

// Convert "20 kyu" / "5 dan" to a KataGoHuman profile string e.g. "rank_20k" / "rank_5d".
// Returns null when the human model is not loaded or the rank cannot be parsed.
function rankToHumanSLProfile(rank) {
  if (!KATAGO_HUMAN_MODEL || !rank) return null;
  const m = rank.match(/(\d+)\s*(kyu|dan)/i);
  if (!m) return null;
  const n    = parseInt(m[1]);
  const type = m[2].toLowerCase();
  if (type === 'kyu') return `rank_${Math.min(20, Math.max(1, n))}k`;
  return `rank_${Math.min(9, Math.max(1, n))}d`;
}

// Scale KataGo strength by limiting visits based on opponent rank
function rankToMaxVisits(rank) {
  if (!rank) return 200;
  const m = rank.match(/(\d+)\s*(kyu|dan)/i);
  if (!m) return 200;
  const n = parseInt(m[1]);
  const type = m[2].toLowerCase();
  if (type === 'kyu') {
    if (n >= 20) return 30;
    if (n >= 15) return 50;
    if (n >= 10) return 100;
    if (n >= 5)  return 150;
    return 200;
  }
  return Math.min(800, 200 + n * 100);
}

function komi(boardSize) {
  return boardSize === 19 ? 7.5 : boardSize === 13 ? 6.5 : 5.5;
}

// ---------- HTTP plumbing ----------

function respond(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) });
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// ---------- Routes ----------

const server = http.createServer(async (req, res) => {
  // Auth
  if (AUTH_TOKEN) {
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${AUTH_TOKEN}`) {
      return respond(res, 401, { error: 'unauthorized' });
    }
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' });
    return res.end();
  }

  // Health check (GET or POST)
  if (req.url === '/health') {
    return respond(res, 200, { ok: true, ready: engine.ready, humanSL: !!KATAGO_HUMAN_MODEL });
  }

  if (req.method !== 'POST') return respond(res, 405, { error: 'method not allowed' });

  let body;
  try { body = await readBody(req); }
  catch (_) { return respond(res, 400, { error: 'invalid json' }); }

  // POST /move — get best move for a position
  if (req.url === '/move') {
    const { sgf, color, boardSize, rank, handicapStones, komi: komiOverride } = body;
    if (!sgf || !color || !boardSize) {
      return respond(res, 400, { error: 'missing required fields: sgf, color, boardSize' });
    }

    const moves = parseSGFMoves(sgf, boardSize);
    // Prefer explicit handicapStones from the caller; fall back to parsing AB[]
    // from the SGF header so callers like game-hint.js get correct context
    // without needing to know about handicap stones.
    const initialStones = Array.isArray(handicapStones)
      ? handicapStones.map(gtp => ['B', gtp])
      : parseInitialStones(sgf, boardSize);

    const humanSLProfile = rankToHumanSLProfile(rank);
    try {
      const result = await engine.query({
        ...(initialStones.length > 0 ? { initialStones, initialPlayer: 'W' } : {}),
        moves,
        rules: 'chinese',
        komi: komiOverride ?? komi(boardSize),
        boardXSize: boardSize,
        boardYSize: boardSize,
        analyzeTurns: [moves.length],
        // humanSL: 10 visits lets the engine search briefly while still respecting human policy.
        // Fallback: visit-throttle by rank when human model is not loaded.
        maxVisits: humanSLProfile ? 10 : rankToMaxVisits(rank),
        ...(humanSLProfile ? { overrideSettings: { humanSLProfile } } : {}),
      });

      const topMoves = (result.moveInfos || []).slice(0, 5).map(m => ({
        move: m.move,
        visits: m.visits,
        winrate: m.winrate,
        scoreLead: m.scoreLead,
        pv: (m.pv || []).slice(0, 5),
      }));
      const best = topMoves[0];
      if (!best) {
        return respond(res, 200, { move: { col: -1, row: -1, thinking: "I'll pass." }, analysis: null });
      }

      const coords    = gtpToCoords(best.move, boardSize);
      const winrate   = result.rootInfo?.winrate   ?? 0.5;
      const scoreLead = result.rootInfo?.scoreLead ?? null;
      const winPct    = Math.round(winrate * 100);

      return respond(res, 200, {
        move: { ...coords, thinking: `Winrate ${winPct}%` },
        winrate,
        scoreLead,
        analysis: {
          topMoves,
          rootWinrate: winrate,
          rootScoreLead: scoreLead,
        },
      });

    } catch (e) {
      console.error('/move error:', e.message);
      return respond(res, 500, { error: e.message });
    }
  }

  // POST /analyze — full game analysis (used by game-summary)
  // Returns per-turn winrate and score lead so game-summary can identify key moments
  if (req.url === '/analyze') {
    const { sgf, boardSize } = body;
    if (!sgf || !boardSize) {
      return respond(res, 400, { error: 'missing required fields: sgf, boardSize' });
    }

    const moves = parseSGFMoves(sgf, boardSize);
    const initialStones = parseInitialStones(sgf, boardSize);
    if (moves.length === 0) {
      return respond(res, 200, { turns: [] });
    }

    // Sample turns to keep analysis fast for long games.
    // Target at most ~20 data points; always include turn 0 and the last turn.
    const totalTurns = moves.length + 1;
    const step = Math.max(1, Math.ceil(totalTurns / 20));
    const analyzeTurns = [];
    for (let i = 0; i < totalTurns; i += step) analyzeTurns.push(i);
    if (analyzeTurns[analyzeTurns.length - 1] !== moves.length) analyzeTurns.push(moves.length);

    try {
      const results = await engine.queryAll({
        ...(initialStones.length > 0 ? { initialStones, initialPlayer: 'W' } : {}),
        moves,
        rules: 'chinese',
        komi: initialStones.length > 0 ? 0.5 : komi(boardSize),
        boardXSize: boardSize,
        boardYSize: boardSize,
        analyzeTurns,
        maxVisits: 20, // full-game pass: 20 visits × ~20 positions fits well within the Netlify timeout
      }, analyzeTurns.length);

      // Sort by turnNumber in case engine returns out of order
      results.sort((a, b) => a.turnNumber - b.turnNumber);

      const turns = results.map(r => ({
        turnNumber: r.turnNumber,
        winrate: r.rootInfo?.winrate ?? null,
        scoreLead: r.rootInfo?.scoreLead ?? null,
        bestMove: r.moveInfos?.[0]?.move ?? null,
        topMoves: (r.moveInfos || []).slice(0, 5).map(m => ({
          move: m.move,
          visits: m.visits,
          winrate: m.winrate,
          scoreLead: m.scoreLead,
          pv: (m.pv || []).slice(0, 5),
        })),
      }));

      return respond(res, 200, { turns });

    } catch (e) {
      console.error('/analyze error:', e.message);
      return respond(res, 500, { error: e.message });
    }
  }

  // POST /analyze-position — analyze a tsumego/problem position given stones (not SGF)
  // Input: { initialStones: [["B","D5"],["W","E5"]], moves: [["B","G4"]], boardSize }
  // Output: { winrate, scoreLead, bestMove }
  if (req.url === '/analyze-position') {
    const { initialStones, moves, boardSize } = body;
    if (!boardSize) return respond(res, 400, { error: 'missing boardSize' });

    const movesArr  = moves  || [];
    const stonesArr = initialStones || [];

    try {
      const result = await engine.query({
        initialStones: stonesArr,
        moves:         movesArr,
        rules:         'chinese',
        komi:          komi(boardSize),
        boardXSize:    boardSize,
        boardYSize:    boardSize,
        analyzeTurns:  [movesArr.length],
        maxVisits:     100,
      });

      const topMoves = (result.moveInfos || []).slice(0, 5).map(m => ({
        move: m.move,
        visits: m.visits,
        winrate: m.winrate,
        scoreLead: m.scoreLead,
        pv: (m.pv || []).slice(0, 5),
      }));
      const best = topMoves[0];
      return respond(res, 200, {
        winrate:   result.rootInfo?.winrate   ?? null,
        scoreLead: result.rootInfo?.scoreLead ?? null,
        bestMove:  best?.move ?? null,
        topMoves,
      });
    } catch (e) {
      console.error('/analyze-position error:', e.message);
      return respond(res, 500, { error: e.message });
    }
  }


  return respond(res, 404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`katago-service listening on 127.0.0.1:${PORT}`);
});
