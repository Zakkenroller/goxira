/**
 * _errorCategories.js
 * Shared mapping between KataGo studyKeywords and rank-adaptive error categories.
 * Used by game-summary.js (to tag errors) and analyze-patterns.js (to filter by rank).
 */

// Categories unlock progressively as the student's rankScore increases.
// rankScore: 0 = 30 kyu, ~100/kyu, 2000 ≈ 1 kyu, 2100+ = dan levels.
const CATEGORIES = {
  capture:    { minScore: 0,    label: 'Capturing & Atari',     sensei: 'Atari' },
  basic_life: { minScore: 0,    label: 'Basic Life & Death',    sensei: 'LifeAndDeath' },
  connection: { minScore: 0,    label: 'Connection & Cutting',  sensei: 'Cutting' },
  ladder:     { minScore: 1000, label: 'Ladders & Nets',        sensei: 'Ladder' },
  ko:         { minScore: 1000, label: 'Ko Fights',             sensei: 'Ko' },
  shape:      { minScore: 1000, label: 'Stone Shape',           sensei: 'Shape' },
  direction:  { minScore: 1000, label: 'Direction of Play',     sensei: 'Direction' },
  joseki:     { minScore: 1500, label: 'Joseki & Opening',      sensei: 'Joseki' },
  influence:  { minScore: 1500, label: 'Influence & Thickness', sensei: 'Thickness' },
  endgame:    { minScore: 2000, label: 'Endgame Precision',     sensei: 'Endgame' },
};

// Map Claude's studyKeyword values (from game-summary) to category keys.
const KEYWORD_TO_CATEGORY = {
  Atari:           'capture',
  Net:             'capture',
  Snapback:        'capture',
  Tesuji:          'capture',
  LifeAndDeath:    'basic_life',
  Eye:             'basic_life',
  FalseEye:        'basic_life',
  TwoEyes:         'basic_life',
  Seki:            'basic_life',
  Semeai:          'basic_life',
  CapturingRace:   'basic_life',
  Cutting:         'connection',
  Connecting:      'connection',
  CrossCut:        'connection',
  Ladder:          'ladder',
  LadderBreaker:   'ladder',
  Ko:              'ko',
  KoFight:         'ko',
  Shape:           'shape',
  GoodShape:       'shape',
  EmptyTriangle:   'shape',
  Hane:            'shape',
  Keima:           'shape',
  Kosumi:          'shape',
  Nobi:            'shape',
  Tobi:            'shape',
  Direction:       'direction',
  BigPoint:        'direction',
  Fuseki:          'direction',
  Tenuki:          'direction',
  Joseki:          'joseki',
  Thickness:       'influence',
  Influence:       'influence',
  Moyo:            'influence',
  Invasion:        'influence',
  Reduction:       'influence',
  Aji:             'influence',
  Sabaki:          'influence',
  Shinogi:         'influence',
  Territory:       'influence',
  Endgame:         'endgame',
  Yose:            'endgame',
  Sente:           'endgame',
  Gote:            'endgame',
};

/**
 * Convert a studyKeyword (from game-summary Claude output) to a category key.
 * Returns null if no mapping found.
 */
function keywordToCategory(keyword) {
  if (!keyword) return null;
  return KEYWORD_TO_CATEGORY[keyword] || null;
}

/**
 * Return the list of category keys visible to a student at a given rankScore.
 */
function visibleCategories(rankScore) {
  return Object.entries(CATEGORIES)
    .filter(([, meta]) => rankScore >= meta.minScore)
    .map(([key]) => key);
}

/**
 * Return full category metadata for a key.
 */
function categoryMeta(key) {
  return CATEGORIES[key] || null;
}

/**
 * Return all category keys and metadata.
 */
function allCategories() {
  return CATEGORIES;
}

module.exports = { keywordToCategory, visibleCategories, categoryMeta, allCategories };
