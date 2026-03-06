/**
 * board.js — SVG Go Board Renderer
 * Renders 9x9, 13x13, or 19x19 boards as interactive SVG.
 * Handles stone placement, hover states, and move navigation.
 */

const Board = (() => {
  const PADDING  = 28;   // px around the grid
  const CELL     = 36;   // px per cell (scaled by SVG viewBox)
  const COLORS = {
    board:       '#dcb878',
    boardDark:   '#c9a45e',
    line:        '#8b6914',
    hoshi:       '#5a3e0a',
    stoneBlack:  '#1a1410',
    stoneWhite:  '#f9f6f0',
    stoneStroke: '#8b6914',
    lastMove:    '#8b3a1e',
    hover:       'rgba(26,20,16,0.25)',
  };

  // Star point positions for each board size
  const HOSHI = {
    9:  [[2,2],[2,6],[6,2],[6,6],[4,4]],
    13: [[3,3],[3,9],[9,3],[9,9],[6,6],[3,6],[9,6],[6,3],[6,9]],
    19: [[3,3],[3,9],[3,15],[9,3],[9,9],[9,15],[15,3],[15,9],[15,15]],
  };

  /**
   * Create a board instance attached to a container element.
   * @param {HTMLElement} container
   * @param {number} size - 9, 13, or 19
   * @param {function} onMove - called with (col, row) when user places a stone
   */
  function create(container, size = 9, onMove = null) {
    const N      = size;
    const total  = PADDING * 2 + CELL * (N - 1);
    const stones = {}; // key: "col,row" → 'B' | 'W'
    let   currentColor = 'B';
    let   lastMove     = null;
    let   hoverPos     = null;
    let   interactive  = true;
    let   markers      = {}; // key: "col,row" → { type, label }

    // Build SVG
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${total} ${total}`);
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.classList.add('board-svg');
    container.appendChild(svg);

    // ── Background ──
    const bg = rect(svg, 0, 0, total, total, COLORS.board);
    // Subtle grain overlay via pattern
    const defs = el(svg, 'defs');
    const pat  = el(defs, 'pattern');
    pat.setAttribute('id', 'grain'); pat.setAttribute('x', '0'); pat.setAttribute('y', '0');
    pat.setAttribute('width', '4'); pat.setAttribute('height', '4');
    pat.setAttribute('patternUnits', 'userSpaceOnUse');
    const grainRect = el(pat, 'rect');
    grainRect.setAttribute('width', '4'); grainRect.setAttribute('height', '4');
    grainRect.setAttribute('fill', 'url(#grain)'); grainRect.setAttribute('opacity', '0.04');
    rect(svg, 0, 0, total, total, 'url(#grain)');

    // ── Grid lines ──
    const gridGroup = el(svg, 'g');
    for (let i = 0; i < N; i++) {
      const x = PADDING + i * CELL;
      const y = PADDING + i * CELL;
      line(gridGroup, x, PADDING, x, PADDING + (N-1)*CELL, COLORS.line, 0.7);
      line(gridGroup, PADDING, y, PADDING + (N-1)*CELL, y, COLORS.line, 0.7);
    }

    // ── Border (thick outer lines) ──
    const bx = PADDING, by = PADDING, bw = (N-1)*CELL, bh = (N-1)*CELL;
    line(gridGroup, bx, by, bx+bw, by, COLORS.hoshi, 1.5);
    line(gridGroup, bx, by+bh, bx+bw, by+bh, COLORS.hoshi, 1.5);
    line(gridGroup, bx, by, bx, by+bh, COLORS.hoshi, 1.5);
    line(gridGroup, bx+bw, by, bx+bw, by+bh, COLORS.hoshi, 1.5);

    // ── Star points ──
    const hoshiGroup = el(svg, 'g');
    (HOSHI[N] || []).forEach(([c, r]) => {
      circle(hoshiGroup, px(c), px(r), 3, COLORS.hoshi, 'none');
    });

    // ── Coordinate labels ──
    const labelGroup = el(svg, 'g');
    const COLS = 'ABCDEFGHJKLMNOPQRST'; // skip I (Go convention)
    for (let i = 0; i < N; i++) {
      const x = px(i), y = px(i);
      text(labelGroup, COLS[i], x, PADDING - 10, '8px', 'middle');
      text(labelGroup, COLS[i], x, PADDING + (N-1)*CELL + 18, '8px', 'middle');
      text(labelGroup, String(N - i), PADDING - 14, y + 3, '8px', 'end');
      text(labelGroup, String(N - i), PADDING + (N-1)*CELL + 14, y + 3, '8px', 'start');
    }

    // ── Stone & marker groups ──
    const stoneGroup  = el(svg, 'g');
    const markerGroup = el(svg, 'g');
    const hoverGroup  = el(svg, 'g');

    // ── Interaction overlay ──
    const overlay = rect(svg, 0, 0, total, total, 'transparent');
    overlay.style.cursor = 'crosshair';

    overlay.addEventListener('mousemove', (e) => {
      if (!interactive) return;
      const pos = svgPos(e, svg, total, N);
      if (!pos) { clearHover(); return; }
      const key = `${pos.col},${pos.row}`;
      if (hoverPos !== key) { hoverPos = key; drawHover(pos); }
    });
    overlay.addEventListener('mouseleave', clearHover);

    overlay.addEventListener('click', (e) => {
      if (!interactive) return;
      const pos = svgPos(e, svg, total, N);
      if (!pos) return;
      const key = `${pos.col},${pos.row}`;
      if (stones[key]) return; // occupied
      clearHover();
      if (onMove) onMove(pos.col, pos.row);
    });

    // Touch support
    overlay.addEventListener('touchend', (e) => {
      if (!interactive) return;
      e.preventDefault();
      const touch = e.changedTouches[0];
      const pos = svgPos(touch, svg, total, N);
      if (!pos) return;
      const key = `${pos.col},${pos.row}`;
      if (stones[key]) return;
      clearHover();
      if (onMove) onMove(pos.col, pos.row);
    });

    // ── Private helpers ──
    function px(i) { return PADDING + i * CELL; }

    function drawStones() {
      stoneGroup.innerHTML = '';
      Object.entries(stones).forEach(([key, color]) => {
        const [c, r] = key.split(',').map(Number);
        const x = px(c), y = px(r);
        const isLast = lastMove && lastMove[0] === c && lastMove[1] === r;
        drawStone(stoneGroup, x, y, color, isLast);
      });
    }

    function drawStone(parent, x, y, color, isLast = false) {
      const r = CELL * 0.46;
      const g = el(parent, 'g');

      // Shadow
      const shadow = el(g, 'circle');
      shadow.setAttribute('cx', x + 1.5); shadow.setAttribute('cy', y + 1.5);
      shadow.setAttribute('r', r);
      shadow.setAttribute('fill', 'rgba(0,0,0,0.25)');

      // Stone body
      const c = el(g, 'circle');
      c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', r);
      if (color === 'B') {
        c.setAttribute('fill', COLORS.stoneBlack);
        // Highlight
        const hl = el(g, 'ellipse');
        hl.setAttribute('cx', x - r*0.25); hl.setAttribute('cy', y - r*0.25);
        hl.setAttribute('rx', r*0.35); hl.setAttribute('ry', r*0.2);
        hl.setAttribute('fill', 'rgba(255,255,255,0.18)');
        hl.setAttribute('transform', `rotate(-30, ${x}, ${y})`);
      } else {
        const grad = createStoneGradient(parent, x, y, r, `sg_${x}_${y}`);
        c.setAttribute('fill', `url(#${grad})`);
        c.setAttribute('stroke', COLORS.stoneStroke);
        c.setAttribute('stroke-width', '0.5');
      }

      // Last move indicator
      if (isLast) {
        const dot = el(g, 'circle');
        dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('r', r*0.22);
        dot.setAttribute('fill', color === 'B' ? 'rgba(255,255,255,0.7)' : COLORS.lastMove);
      }
    }

    function createStoneGradient(parent, x, y, r, id) {
      let defs = svg.querySelector('defs');
      const grad = document.createElementNS('http://www.w3.org/2000/svg', 'radialGradient');
      grad.setAttribute('id', id);
      grad.setAttribute('cx', '40%'); grad.setAttribute('cy', '35%');
      grad.setAttribute('r', '65%');
      const s1 = el(grad, 'stop');
      s1.setAttribute('offset', '0%'); s1.setAttribute('stop-color', '#ffffff');
      const s2 = el(grad, 'stop');
      s2.setAttribute('offset', '100%'); s2.setAttribute('stop-color', '#e8e0d0');
      defs.appendChild(grad);
      return id;
    }

    function drawMarkers() {
      markerGroup.innerHTML = '';
      Object.entries(markers).forEach(([key, marker]) => {
        const [c, r] = key.split(',').map(Number);
        const x = px(c), y = px(r);
        const stone = stones[key];
        const fg = stone === 'B' ? 'rgba(255,255,255,0.85)' : 'rgba(26,20,16,0.85)';
        if (marker.type === 'flag') {
          const t = el(markerGroup, 'text');
          t.setAttribute('x', x); t.setAttribute('y', y + 5);
          t.setAttribute('text-anchor', 'middle');
          t.setAttribute('font-size', '14');
          t.textContent = '⚑';
          t.setAttribute('fill', COLORS.lastMove);
        } else if (marker.type === 'label') {
          const t = el(markerGroup, 'text');
          t.setAttribute('x', x); t.setAttribute('y', y + 4);
          t.setAttribute('text-anchor', 'middle');
          t.setAttribute('font-size', '10');
          t.setAttribute('font-weight', 'bold');
          t.setAttribute('fill', fg);
          t.textContent = marker.label;
        } else if (marker.type === 'triangle') {
          const s = CELL * 0.28;
          const pts = `${x},${y-s} ${x-s*0.87},${y+s*0.5} ${x+s*0.87},${y+s*0.5}`;
          const poly = el(markerGroup, 'polygon');
          poly.setAttribute('points', pts);
          poly.setAttribute('fill', 'none');
          poly.setAttribute('stroke', fg);
          poly.setAttribute('stroke-width', '1.5');
        }
      });
    }

    function drawHover(pos) {
      hoverGroup.innerHTML = '';
      const key = `${pos.col},${pos.row}`;
      if (stones[key]) return;
      const x = px(pos.col), y = px(pos.row);
      const c = el(hoverGroup, 'circle');
      c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', CELL * 0.42);
      c.setAttribute('fill', currentColor === 'B' ? 'rgba(26,20,16,0.3)' : 'rgba(249,246,240,0.6)');
      c.setAttribute('pointer-events', 'none');
    }

    function clearHover() { hoverGroup.innerHTML = ''; hoverPos = null; }

    // ── Public API ──
    return {
      /** Place a stone at (col, row) */
      place(col, row, color) {
        const key = `${col},${row}`;
        stones[key] = color;
        lastMove = [col, row];
        currentColor = color === 'B' ? 'W' : 'B';
        drawStones(); drawMarkers();
      },

      /** Remove stone at (col, row) */
      remove(col, row) {
        delete stones[`${col},${row}`];
        drawStones(); drawMarkers();
      },

      /** Set the entire board state from an object { "col,row": "B"|"W" } */
      setState(state, lm = null) {
        Object.assign(stones, state);
        if (lm) lastMove = lm;
        drawStones(); drawMarkers();
      },

      /** Clear all stones */
      clear() {
        for (const k in stones) delete stones[k];
        lastMove = null; markers = {};
        drawStones(); drawMarkers();
      },

      /** Set current player color */
      setColor(c) { currentColor = c; },
      getColor()  { return currentColor; },

      /** Add a marker */
      addMarker(col, row, type, label = '') {
        markers[`${col},${row}`] = { type, label };
        drawMarkers();
      },
      clearMarkers() { markers = {}; drawMarkers(); },

      /** Toggle interactivity */
      setInteractive(v) { interactive = v; overlay.style.cursor = v ? 'crosshair' : 'default'; },

      /** Get all stones */
      getStones() { return { ...stones }; },

      /** Get board size */
      getSize() { return N; },

      /** Resize to fill container width */
      resize() { /* SVG viewBox handles this automatically */ },
    };
  }

  // ── SVG helpers ──────────────────────────────────── //
  function el(parent, tag) {
    const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    parent.appendChild(e); return e;
  }
  function rect(parent, x, y, w, h, fill) {
    const r = el(parent, 'rect');
    r.setAttribute('x', x); r.setAttribute('y', y);
    r.setAttribute('width', w); r.setAttribute('height', h);
    r.setAttribute('fill', fill); return r;
  }
  function line(parent, x1, y1, x2, y2, stroke, w = 1) {
    const l = el(parent, 'line');
    l.setAttribute('x1', x1); l.setAttribute('y1', y1);
    l.setAttribute('x2', x2); l.setAttribute('y2', y2);
    l.setAttribute('stroke', stroke); l.setAttribute('stroke-width', w); return l;
  }
  function circle(parent, cx, cy, r, fill, stroke) {
    const c = el(parent, 'circle');
    c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', r);
    c.setAttribute('fill', fill); if (stroke !== 'none') c.setAttribute('stroke', stroke); return c;
  }
  function text(parent, content, x, y, size, anchor) {
    const t = el(parent, 'text');
    t.setAttribute('x', x); t.setAttribute('y', y);
    t.setAttribute('font-size', size); t.setAttribute('text-anchor', anchor);
    t.setAttribute('fill', '#5a3e0a'); t.setAttribute('font-family', 'Georgia, serif');
    t.setAttribute('opacity', '0.7');
    t.textContent = content; return t;
  }

  // Convert mouse/touch event to board position
  function svgPos(e, svg, total, N) {
    const rect = svg.getBoundingClientRect();
    const scaleX = total / rect.width;
    const scaleY = total / rect.height;
    const sx = (e.clientX - rect.left) * scaleX;
    const sy = (e.clientY - rect.top)  * scaleY;
    const col = Math.round((sx - PADDING) / CELL);
    const row = Math.round((sy - PADDING) / CELL);
    if (col < 0 || col >= N || row < 0 || row >= N) return null;
    return { col, row };
  }

  return { create };
})();

window.Board = Board;
