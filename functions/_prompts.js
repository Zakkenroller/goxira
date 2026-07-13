'use strict';

// Shared prompt-formatting helpers for KataGo data passed to Claude.

// Render KataGo top-5 candidate moves as indented prompt lines.
// studentMove (optional) marks the student's own move in the list.
function formatTopMovesForPrompt(topMoves, toPlayWord, studentMove = null) {
  if (!topMoves?.length) return '';
  return topMoves.slice(0, 5).map((m, i) => {
    const winPct = Math.round((m.winrate ?? 0) * 100);
    const score = m.scoreLead != null ? `, score ${m.scoreLead > 0 ? '+' : ''}${m.scoreLead.toFixed(1)}` : '';
    const pv = m.pv?.length ? ` → sequence: ${m.pv.join(', ')}` : '';
    const marker = studentMove && m.move === studentMove ? " ← student's move" : '';
    return `  ${i + 1}. ${m.move}: ${winPct}% for ${toPlayWord}${score}${pv}${marker}`;
  }).join('\n');
}

module.exports = { formatTopMovesForPrompt };
