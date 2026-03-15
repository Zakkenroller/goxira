/**
 * board.js — SVG Go Board Renderer
 * Renders 9x9, 13x13, or 19x19 boards as interactive SVG.
 * Handles stone placement, hover states, move navigation, and captures.
 */

const Board = (() => {
  const PADDING  = 28;
  const CELL     = 36;
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

  const HOSHI = {
    9:  [[2,2],[2,6],[6,2],[6,6],[4,4]],
    13: [[3,3],[3,9],[9,3],[9,9],[6,6],[3,6],[9,6],[6,3],[6,9]],
    19: [[3,3],[3,9],[3,15],[9,3],[9,9],[9,15],[15,3],[15,9],[15,15]],
  };

  function create(container, size = 9, onMove = null) {
    const N      = size;
    const total  = PADDING * 2 + CELL * (N - 1);
    const stones = {};
    let   currentColor = 'B';
    let   lastMove     = null;
    let   hoverPos     = null;
    let   interactive  = true;
    let   markers      = {};
    let   koPoint      = null; // forbidden ko point "col,row"
    let   captures     = { B: 0, W: 0 }; // stones captured by each color
    let   pulseLast    = false; // true only during the drawStones() call after place()
    let   pendingPos   = null;  // key of stone awaiting auto-confirm, or null
    let   pendingTimer = null;  // setTimeout handle for auto-confirm
    const CONFIRM_DELAY = 800;  // ms before a pending stone auto-confirms

    // Build SVG
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${total} ${total}`);
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.classList.add('board-svg');
    container.appendChild(svg);

    // ── Background ──
    rect(svg, 0, 0, total, total, COLORS.board);
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
    const COLS = 'ABCDEFGHJKLMNOPQRST';
    for (let i = 0; i < N; i++) {
      const x = px(i), y = px(i);
      text(labelGroup, COLS[i], x, PADDING - 10, '8px', 'middle');
      text(labelGroup, COLS[i], x, PADDING + (N-1)*CELL + 18, '8px', 'middle');
      text(labelGroup, String(N - i), PADDING - 14, y + 3, '8px', 'end');
      text(labelGroup, String(N - i), PADDING + (N-1)*CELL + 14, y + 3, '8px', 'start');
    }

    const stoneGroup  = el(svg, 'g');
    const markerGroup = el(svg, 'g');
    const hoverGroup  = el(svg, 'g');

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
      if (stones[key]) return;
      if (key === koPoint) return; // ko rule
      clearHover();
      if (onMove) onMove(pos.col, pos.row);
    });

    // ── Touch: drag-to-place ──────────────────────────────────────
    // touchstart → show ghost stone; touchmove → ghost follows finger;
    // touchend → place stone at wherever the ghost currently is.
    let activeTouchId = null;

    // Minimum ghost stone radius in screen pixels for touch.
    // Large enough to peek out around a fingertip on any board size.
    const TOUCH_GHOST_PX = 22;

    overlay.addEventListener('touchstart', (e) => {
      if (!interactive) return;
      e.preventDefault();
      // Cancel any pending auto-confirm so the player can change their mind
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; pendingPos = null; clearHover(); }
      const touch = e.changedTouches[0];
      activeTouchId = touch.identifier;
      const pos = svgPos(touch, svg, total, N);
      if (pos) { hoverPos = `${pos.col},${pos.row}`; drawHover(pos, true); }
    }, { passive: false });

    overlay.addEventListener('touchmove', (e) => {
      if (!interactive) return;
      e.preventDefault();
      let touch = null;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === activeTouchId) { touch = e.changedTouches[i]; break; }
      }
      if (!touch) return;
      const pos = svgPos(touch, svg, total, N);
      if (pos) {
        const key = `${pos.col},${pos.row}`;
        if (hoverPos !== key) { hoverPos = key; drawHover(pos, true); }
      } else {
        clearHover();
      }
    }, { passive: false });

    overlay.addEventListener('touchend', (e) => {
      if (!interactive) return;
      let touch = null;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === activeTouchId) { touch = e.changedTouches[i]; break; }
      }
      if (!touch) return;
      activeTouchId = null;
      e.preventDefault();
      clearHover();
      const pos = svgPos(touch, svg, total, N);
      if (!pos) return;
      const key = `${pos.col},${pos.row}`;
      if (stones[key]) return;
      if (key === koPoint) return;
      // Show pending stone with progress ring; auto-confirms after CONFIRM_DELAY
      pendingPos = key;
      drawPending(pos);
      pendingTimer = setTimeout(() => {
        pendingPos = null; pendingTimer = null;
        clearHover();
        if (onMove) onMove(pos.col, pos.row);
      }, CONFIRM_DELAY);
    });

    overlay.addEventListener('touchcancel', () => {
      activeTouchId = null;
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; pendingPos = null; }
      clearHover();
    });

    // ── Private helpers ──
    function px(i) { return PADDING + i * CELL; }

    // Get orthogonal neighbors within board
    function neighbors(col, row) {
      return [[col-1,row],[col+1,row],[col,row-1],[col,row+1]]
        .filter(([c,r]) => c >= 0 && c < N && r >= 0 && r < N);
    }

    // Flood-fill: get all stones in a connected group
    function getGroup(col, row) {
      const color = stones[`${col},${row}`];
      if (!color) return [];
      const group   = [];
      const visited = new Set();
      const queue   = [[col, row]];
      while (queue.length) {
        const [c, r] = queue.pop();
        const key = `${c},${r}`;
        if (visited.has(key)) continue;
        visited.add(key);
        if (stones[key] !== color) continue;
        group.push([c, r]);
        neighbors(c, r).forEach(([nc, nr]) => {
          if (!visited.has(`${nc},${nr}`)) queue.push([nc, nr]);
        });
      }
      return group;
    }

    // Count liberties (empty adjacent points) for a group
    function getLiberties(group) {
      const liberties = new Set();
      group.forEach(([c, r]) => {
        neighbors(c, r).forEach(([nc, nr]) => {
          if (!stones[`${nc},${nr}`]) liberties.add(`${nc},${nr}`);
        });
      });
      return liberties.size;
    }

    // Remove a group from the board, return captured count
    function removeGroup(group) {
      group.forEach(([c, r]) => delete stones[`${c},${r}`]);
      return group.length;
    }

    // Apply capture logic after placing a stone at (col, row)
    // Returns number of stones captured, or -1 if move is illegal (suicide)
    function applyCaptures(col, row, color) {
      const opponent = color === 'B' ? 'W' : 'B';
      let   totalCaptured = 0;
      let   newKoPoint    = null;
      const capturedGroups = [];

      // Check all opponent neighbors for capture
      neighbors(col, row).forEach(([nc, nr]) => {
        const key = `${nc},${nr}`;
        if (stones[key] === opponent) {
          const group = getGroup(nc, nr);
          if (getLiberties(group) === 0) {
            capturedGroups.push(group);
          }
        }
      });

      // Remove captured groups
      capturedGroups.forEach(group => {
        totalCaptured += removeGroup(group);
      });

      // Ko detection: if exactly one stone was captured, that point is the new ko point
      if (capturedGroups.length === 1 && capturedGroups[0].length === 1) {
        const [kc, kr] = capturedGroups[0][0];
        // Only a ko if the capturing stone also has exactly one liberty
        const placedGroup = getGroup(col, row);
        if (getLiberties(placedGroup) === 1) {
          newKoPoint = `${kc},${kr}`;
        }
      }

      // Suicide check: if own group has no liberties after captures, illegal
      if (totalCaptured === 0) {
        const placedGroup = getGroup(col, row);
        if (getLiberties(placedGroup) === 0) {
          // Undo placement
          delete stones[`${col},${row}`];
          return -1;
        }
      }

      // Update capture counts
      captures[color] += totalCaptured;
      koPoint = newKoPoint;

      return totalCaptured;
    }

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
      const shadow = el(g, 'circle');
      shadow.setAttribute('cx', x + 1.5); shadow.setAttribute('cy', y + 1.5);
      shadow.setAttribute('r', r);
      shadow.setAttribute('fill', 'rgba(0,0,0,0.25)');
      const c = el(g, 'circle');
      c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', r);
      if (color === 'B') {
        c.setAttribute('fill', COLORS.stoneBlack);
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
      if (isLast) {
        const dot = el(g, 'circle');
        dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('r', r*0.22);
        dot.setAttribute('fill', color === 'B' ? 'rgba(255,255,255,0.7)' : COLORS.lastMove);
      }
      // Placement pulse: expanding ring that plays once on stone landing
      if (isLast && pulseLast) {
        const ring = el(g, 'circle');
        ring.setAttribute('cx', x); ring.setAttribute('cy', y); ring.setAttribute('r', String(r));
        ring.setAttribute('fill', 'none');
        ring.setAttribute('stroke',
          color === 'B' ? 'rgba(255,255,255,0.55)' : 'rgba(139,105,20,0.55)');
        ring.setAttribute('stroke-width', '2');
        ring.setAttribute('pointer-events', 'none');
        const aR = el(ring, 'animate');
        aR.setAttribute('attributeName', 'r');
        aR.setAttribute('from', String(r * 0.9)); aR.setAttribute('to', String(r * 2.4));
        aR.setAttribute('dur', '0.4s'); aR.setAttribute('fill', 'freeze');
        const aO = el(ring, 'animate');
        aO.setAttribute('attributeName', 'opacity');
        aO.setAttribute('from', '1'); aO.setAttribute('to', '0');
        aO.setAttribute('dur', '0.4s'); aO.setAttribute('fill', 'freeze');
      }
    }

    function createStoneGradient(parent, x, y, r, id) {
      const defs = svg.querySelector('defs');
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

    // isTouch: when true, ensure the ghost is large enough to peek out around a fingertip.
    function drawHover(pos, isTouch = false) {
      hoverGroup.innerHTML = '';
      const key = `${pos.col},${pos.row}`;
      if (stones[key]) return;
      const x = px(pos.col);
      const y = px(pos.row);
      let ghostR = CELL * 0.46;

      if (isTouch) {
        // Convert minimum screen radius → SVG units and take whichever is larger
        const svgRect = svg.getBoundingClientRect();
        const vb      = svg.viewBox.baseVal;
        const scale   = (vb.height || total) / Math.max(svgRect.height, 1);
        ghostR = Math.max(CELL * 0.46, TOUCH_GHOST_PX * scale);
      }

      const c = el(hoverGroup, 'circle');
      c.setAttribute('cx', String(x)); c.setAttribute('cy', String(y));
      c.setAttribute('r', String(ghostR));
      if (currentColor === 'B') {
        c.setAttribute('fill', 'rgba(26,20,16,0.55)');
      } else {
        c.setAttribute('fill', 'rgba(249,246,240,0.82)');
        c.setAttribute('stroke', COLORS.stoneStroke);
        c.setAttribute('stroke-width', '1');
      }
      c.setAttribute('pointer-events', 'none');
    }

    // Draw a pending stone (normal size) with a clockwise progress arc that
    // fills over CONFIRM_DELAY ms, showing the player the auto-confirm countdown.
    function drawPending(pos) {
      hoverGroup.innerHTML = '';
      const x = px(pos.col);
      const y = px(pos.row);
      const r = CELL * 0.46;

      // Stone at intersection, slightly transparent to signal "not confirmed yet"
      const c = el(hoverGroup, 'circle');
      c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', String(r));
      if (currentColor === 'B') {
        c.setAttribute('fill', 'rgba(26,20,16,0.72)');
      } else {
        c.setAttribute('fill', 'rgba(249,246,240,0.88)');
        c.setAttribute('stroke', COLORS.stoneStroke);
        c.setAttribute('stroke-width', '0.5');
      }
      c.setAttribute('pointer-events', 'none');

      // Clockwise progress ring that fills over CONFIRM_DELAY
      const ringR = r * 1.35;
      const circ  = 2 * Math.PI * ringR;
      const ring  = el(hoverGroup, 'circle');
      ring.setAttribute('cx', x); ring.setAttribute('cy', y);
      ring.setAttribute('r', String(ringR));
      ring.setAttribute('fill', 'none');
      ring.setAttribute('stroke',
        currentColor === 'B' ? 'rgba(255,255,255,0.75)' : 'rgba(139,105,20,0.85)');
      ring.setAttribute('stroke-width', String(CELL * 0.08));
      ring.setAttribute('stroke-dasharray', String(circ));
      ring.setAttribute('stroke-dashoffset', String(circ));
      ring.setAttribute('stroke-linecap', 'round');
      ring.setAttribute('transform', `rotate(-90,${x},${y})`);
      ring.setAttribute('pointer-events', 'none');
      const anim = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
      anim.setAttribute('attributeName', 'stroke-dashoffset');
      anim.setAttribute('from', String(circ));
      anim.setAttribute('to', '0');
      anim.setAttribute('dur', `${CONFIRM_DELAY}ms`);
      anim.setAttribute('fill', 'freeze');
      ring.appendChild(anim);
    }

    function clearHover() { hoverGroup.innerHTML = ''; hoverPos = null; }

    // ── Public API ──
    return {
      /**
       * Place a stone with full capture logic.
       * Returns { captured: N } or { illegal: true } for suicide moves.
       */
      place(col, row, color) {
        const key = `${col},${row}`;
        if (stones[key]) return { illegal: true };

        stones[key] = color;
        const captured = applyCaptures(col, row, color);

        if (captured === -1) {
          // Suicide — stone was removed by applyCaptures
          return { illegal: true };
        }

        lastMove = [col, row];
        currentColor = color === 'B' ? 'W' : 'B';
        pulseLast = true; drawStones(); drawMarkers(); pulseLast = false;
        return { captured };
      },

      /** Place without capture logic (for setting up problems) */
      placeSetup(col, row, color) {
        stones[`${col},${row}`] = color;
        drawStones(); drawMarkers();
      },

      remove(col, row) {
        delete stones[`${col},${row}`];
        drawStones(); drawMarkers();
      },

      setState(state, lm = null) {
        for (const k in stones) delete stones[k];
        Object.assign(stones, state);
        if (lm) lastMove = lm;
        drawStones(); drawMarkers();
      },

      clear() {
        for (const k in stones) delete stones[k];
        lastMove = null; markers = {}; koPoint = null;
        captures = { B: 0, W: 0 };
        drawStones(); drawMarkers();
      },

      setColor(c) { currentColor = c; },
      getColor()  { return currentColor; },

      addMarker(col, row, type, label = '') {
        markers[`${col},${row}`] = { type, label };
        drawMarkers();
      },
      clearMarkers() { markers = {}; drawMarkers(); },

      setInteractive(v) { interactive = v; overlay.style.cursor = v ? 'crosshair' : 'default'; },

      getStones() { return { ...stones }; },
      getSize()   { return N; },
      getCaptures() { return { ...captures }; },
      resize() {},
    };
  }

  // ── SVG helpers ──
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

  function svgPos(e, svg, total, N) {
    const rect = svg.getBoundingClientRect();
    const vb   = svg.viewBox.baseVal;

    // Reject touches outside the visible intersection of the SVG and the viewport.
    // Without this, a finger on a part of the board scrolled off-screen still maps
    // to a valid grid position, making it impossible to cancel by dragging off-screen.
    const visLeft   = Math.max(rect.left,   0);
    const visTop    = Math.max(rect.top,    0);
    const visRight  = Math.min(rect.right,  window.innerWidth);
    const visBottom = Math.min(rect.bottom, window.innerHeight);
    if (e.clientX < visLeft || e.clientX > visRight ||
        e.clientY < visTop  || e.clientY > visBottom) return null;

    // Use current viewBox (which may have been cropped) for correct mapping
    const vbW = vb.width  || total;
    const vbH = vb.height || total;
    const vbX = vb.x      || 0;
    const vbY = vb.y      || 0;

    const scaleX = vbW / rect.width;
    const scaleY = vbH / rect.height;
    const svgX = (e.clientX - rect.left) * scaleX + vbX;
    const svgY = (e.clientY - rect.top)  * scaleY + vbY;

    const col = Math.round((svgX - PADDING) / CELL);
    const row = Math.round((svgY - PADDING) / CELL);
    if (col < 0 || col >= N || row < 0 || row >= N) return null;
    return { col, row };
  }

  return { create };
})();

window.Board = Board;