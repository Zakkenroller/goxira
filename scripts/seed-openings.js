#!/usr/bin/env node
/**
 * seed-openings.js — Populate the opening_patterns table with joseki and fuseki patterns.
 *
 * Usage:
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_KEY=your_service_role_key \
 *   node scripts/seed-openings.js
 *
 * Uses the service role key (not the anon key) so it can bypass RLS.
 * Skips any pattern whose position_hash already exists in the table.
 *
 * Coordinates: x = column (0 = leftmost), y = row (0 = top), 0-indexed on a 19×19 board.
 * Star points (hoshi): (3,3), (3,9), (3,15), (9,3), (9,9), (9,15), (15,3), (15,9), (15,15)
 */

'use strict';
const crypto = require('crypto');

// ── Position hash ─────────────────────────────────────────────────────────────
// Stable identifier for a move sequence; order matters (replays must be deterministic).
function positionHash(moves) {
  const repr = moves.map(m => `${m.color}${m.x},${m.y}`).join('|');
  return crypto.createHash('sha256').update(repr).digest('hex').slice(0, 20);
}

// ── Pattern definitions ───────────────────────────────────────────────────────
//
// JOSEKI: corner sequences, played in the top-left quadrant for consistency.
//   All sequences start at the first stone played in the corner.
//   Coordinates verified against standard Go references.
//
// FUSEKI: whole-board opening frameworks, 4–6 moves showing key positions.
//   White's moves represent typical responses; specific continuations may vary.

const PATTERNS = [

  // ════════════════════════════════════════════════════════════════════
  // JOSEKI
  // ════════════════════════════════════════════════════════════════════

  {
    name: 'Star Point — 3-3 Invasion',
    category: 'joseki',
    corner: 'top-left',
    difficulty: 1,
    description:
      'The most common modern joseki (popularised by AlphaGo). White invades Black\'s ' +
      '4-4 star point at the 3-3 point. White lives small in the corner; Black builds ' +
      'a strong outside wall facing the centre.',
    result: 'equal',
    tags: ['star-point', '4-4', 'san-san', 'invasion', 'beginner'],
    moves: [
      { color: 'B', x: 3, y: 3 },   // Black's 4-4 star point
      { color: 'W', x: 2, y: 2 },   // White invades 3-3
      { color: 'B', x: 3, y: 2 },   // Black blocks — prevents White extending right
      { color: 'W', x: 2, y: 3 },   // White turns toward the corner
      { color: 'B', x: 2, y: 4 },   // Black descends, sealing White from below
      { color: 'W', x: 3, y: 4 },   // White extends into corner
      { color: 'B', x: 4, y: 3 },   // Black seals — takes outside influence
    ],
  },

  {
    name: 'Star Point — Keima Shimari',
    category: 'joseki',
    corner: 'top-left',
    difficulty: 1,
    description:
      'After claiming the 4-4 star point, Black uses a knight\'s move to form a two-stone ' +
      'corner enclosure (shimari). The resulting shape is flexible — hard to invade and ' +
      'projects influence toward both the top edge and the left side.',
    result: 'influence',
    tags: ['star-point', '4-4', 'shimari', 'enclosure', 'beginner'],
    moves: [
      { color: 'B', x: 3,  y: 3  },  // Black's 4-4 star point
      { color: 'W', x: 15, y: 15 },  // White plays elsewhere (bottom-right)
      { color: 'B', x: 5,  y: 2  },  // Black's knight's move shimari toward the top edge
    ],
  },

  {
    name: 'Star Point — One-Space Low Approach',
    category: 'joseki',
    corner: 'top-left',
    difficulty: 2,
    description:
      'White approaches Black\'s 4-4 stone with a one-space low approach. Black extends ' +
      'downward to maintain a flexible position. The resulting shape gives Black territory ' +
      'potential along the left side while White aims for influence.',
    result: 'equal',
    tags: ['star-point', '4-4', 'approach', 'kakari', 'intermediate'],
    moves: [
      { color: 'B', x: 3, y: 3 },  // Black's 4-4 star point
      { color: 'W', x: 5, y: 3 },  // White's one-space low approach (ikken kakari)
      { color: 'B', x: 3, y: 5 },  // Black extends — one-space low extension
      { color: 'W', x: 5, y: 5 },  // White jumps into the centre
      { color: 'B', x: 2, y: 3 },  // Black protects the corner
    ],
  },

  {
    name: 'Komoku — Basic Corner',
    category: 'joseki',
    corner: 'top-left',
    difficulty: 1,
    description:
      'Black plays the 3-4 (komoku) corner point — the most common classical corner move. ' +
      'The asymmetric placement creates natural tension: one side is stronger (the 4th-line ' +
      'direction) and one is weaker (the 3rd-line side). White must choose how to approach.',
    result: 'territory',
    tags: ['komoku', '3-4', 'classical', 'beginner'],
    moves: [
      { color: 'B', x: 2, y: 3 },  // Black's komoku — 3rd from left, 4th from top
      { color: 'W', x: 5, y: 2 },  // White's keima approach from the right
      { color: 'B', x: 2, y: 5 },  // Black extends — one-space jump toward the bottom
      { color: 'W', x: 3, y: 2 },  // White peeps at the top
      { color: 'B', x: 2, y: 2 },  // Black connects, securing the corner
    ],
  },

  {
    name: 'Star Point — Two-Space High Pincer',
    category: 'joseki',
    corner: 'top-left',
    difficulty: 2,
    description:
      'After White approaches Black\'s 4-4 stone, Black answers with a two-space high ' +
      'pincer — an aggressive response that pressures White and fights for the left side. ' +
      'This leads to complex, double-wing fighting sequences.',
    result: 'influence',
    tags: ['star-point', '4-4', 'pincer', 'fighting', 'intermediate'],
    moves: [
      { color: 'B', x: 3, y: 3  },  // Black's 4-4 star point
      { color: 'W', x: 5, y: 3  },  // White's one-space low approach
      { color: 'B', x: 3, y: 6  },  // Black's two-space high pincer
      { color: 'W', x: 5, y: 5  },  // White jumps to the centre to escape
      { color: 'B', x: 4, y: 4  },  // Black blocks, maintaining pressure
    ],
  },

  // ════════════════════════════════════════════════════════════════════
  // FUSEKI
  // ════════════════════════════════════════════════════════════════════

  {
    name: 'Nirensei — Twin Stars',
    category: 'fuseki',
    corner: null,
    difficulty: 1,
    description:
      'Black plays two star points on the same side (top-left and bottom-left), forming ' +
      'a framework that emphasises outside influence over the left side of the board. ' +
      'The two star points are connected by the left-side star point at (3,9).',
    result: 'influence',
    tags: ['nirensei', 'star-point', 'influence', 'beginner'],
    moves: [
      { color: 'B', x: 3,  y: 3  },  // Black's top-left star point
      { color: 'W', x: 15, y: 3  },  // White mirrors — top-right star point
      { color: 'B', x: 3,  y: 15 },  // Black's bottom-left star (nirensei complete)
      { color: 'W', x: 15, y: 15 },  // White mirrors — bottom-right star point
    ],
  },

  {
    name: 'Sanrensei — Three Stars',
    category: 'fuseki',
    corner: null,
    difficulty: 2,
    description:
      'Black plays three star points along the left side: top-left, left-centre, and ' +
      'bottom-left. This powerful influence-oriented opening controls a vast left-side ' +
      'moyo. The challenge is converting that potential into real territory against invasions.',
    result: 'influence',
    tags: ['sanrensei', 'star-point', 'moyo', 'influence', 'intermediate'],
    moves: [
      { color: 'B', x: 3,  y: 3  },  // Top-left star
      { color: 'W', x: 15, y: 3  },  // White takes top-right star
      { color: 'B', x: 3,  y: 9  },  // Black's left-side centre star
      { color: 'W', x: 15, y: 9  },  // White takes right-side centre star
      { color: 'B', x: 3,  y: 15 },  // Black's bottom-left star (sanrensei complete)
      { color: 'W', x: 15, y: 15 },  // White mirrors — bottom-right star
    ],
  },

  {
    name: 'Chinese Opening — Low Framework',
    category: 'fuseki',
    corner: null,
    difficulty: 2,
    description:
      'Black builds a flexible right-side framework with a star point (4-4), a komoku ' +
      '(3-4) on the same side, and an extension along the 4th line. The "Low Chinese" ' +
      'is solid — it leans toward territory while still projecting some centre influence.',
    result: 'territory',
    tags: ['chinese', 'framework', 'komoku', 'star-point', 'intermediate'],
    moves: [
      { color: 'B', x: 15, y: 3  },  // Black's top-right star point (4-4)
      { color: 'W', x: 3,  y: 3  },  // White takes top-left star
      { color: 'B', x: 16, y: 15 },  // Black's bottom-right komoku (3rd from right, 4th from bottom)
      { color: 'W', x: 3,  y: 15 },  // White takes bottom-left star
      { color: 'B', x: 15, y: 9  },  // Black extends on the right side — completes the framework
    ],
  },

  {
    name: 'Chinese Opening — High Framework',
    category: 'fuseki',
    corner: null,
    difficulty: 2,
    description:
      'A variation of the Chinese Opening where Black\'s side stone is on the 4th line ' +
      '(high) rather than the 3rd line (low). The "High Chinese" sacrifices some bottom-line ' +
      'territory for greater centre influence and a more flexible fighting position.',
    result: 'influence',
    tags: ['chinese', 'high', 'framework', 'komoku', 'star-point', 'intermediate'],
    moves: [
      { color: 'B', x: 15, y: 3  },  // Black's top-right star point
      { color: 'W', x: 3,  y: 3  },  // White takes top-left star
      { color: 'B', x: 15, y: 16 },  // Black's bottom-right komoku (4th from right, 3rd from bottom)
      { color: 'W', x: 3,  y: 15 },  // White takes bottom-left star
      { color: 'B', x: 15, y: 9  },  // Black's 4th-line extension — High Chinese complete
    ],
  },

  {
    name: 'Orthodox Opening',
    category: 'fuseki',
    corner: null,
    difficulty: 3,
    description:
      'The classical opening: Black plays komoku in multiple corners, building a solid ' +
      'territorial base from the 3rd line before fighting for the centre. This balanced ' +
      'approach is favoured by players who prefer structured, territory-based Go.',
    result: 'territory',
    tags: ['orthodox', 'komoku', 'classical', 'territory', 'advanced'],
    moves: [
      { color: 'B', x: 15, y: 2  },  // Black's top-right komoku (4th from right, 3rd from top)
      { color: 'W', x: 3,  y: 2  },  // White's top-left komoku
      { color: 'B', x: 2,  y: 15 },  // Black's bottom-left komoku (3rd from left, 4th from bottom)
      { color: 'W', x: 15, y: 15 },  // White takes bottom-right star point
      { color: 'B', x: 15, y: 9  },  // Black extends on the right
      { color: 'W', x: 9,  y: 3  },  // White takes top-centre star point
    ],
  },

];

// ── Seed ─────────────────────────────────────────────────────────────────────

async function seed() {
  const url  = process.env.SUPABASE_URL;
  const key  = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY before running.');
    process.exit(1);
  }

  // Fetch existing hashes to avoid duplicates.
  const existRes = await fetch(`${url}/rest/v1/opening_patterns?select=position_hash`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!existRes.ok) {
    const txt = await existRes.text();
    console.error('Failed to fetch existing patterns:', existRes.status, txt);
    process.exit(1);
  }
  const existing = new Set((await existRes.json()).map(r => r.position_hash));
  console.log(`${existing.size} patterns already in DB.`);

  let inserted = 0;
  let skipped  = 0;

  for (const p of PATTERNS) {
    const hash = positionHash(p.moves);

    if (existing.has(hash)) {
      console.log(`  skip  ${p.name}`);
      skipped++;
      continue;
    }

    const body = {
      name:          p.name,
      category:      p.category,
      corner:        p.corner,
      difficulty:    p.difficulty,
      description:   p.description,
      result:        p.result,
      tags:          p.tags,
      moves:         p.moves,
      position_hash: hash,
    };

    const ins = await fetch(`${url}/rest/v1/opening_patterns`, {
      method: 'POST',
      headers: {
        apikey:         key,
        Authorization:  `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer:         'return=minimal',
      },
      body: JSON.stringify(body),
    });

    if (ins.ok) {
      console.log(`  insert ${p.name}`);
      inserted++;
    } else {
      const txt = await ins.text();
      console.error(`  ERROR  ${p.name}: ${ins.status} ${txt}`);
    }
  }

  console.log(`\nDone. Inserted ${inserted}, skipped ${skipped}.`);
}

seed().catch(e => { console.error(e); process.exit(1); });
