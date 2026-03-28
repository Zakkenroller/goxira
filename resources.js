/**
 * resources.js — Static curated learning resources
 * Organised by error category (mirrors _errorCategories.js) and rank tier.
 * Links point to channel pages and search results — stable for years.
 *
 * Last reviewed: 2026-03
 */

const Resources = (() => {

  // ── Keyword → category mapping ─────────────────────────────────────────────
  // Mirrors KEYWORD_TO_CATEGORY in functions/_errorCategories.js.
  // Duplicated here because that file is a Node module (require/module.exports)
  // and cannot be loaded directly in the browser.
  const KEYWORD_TO_CATEGORY = {
    Atari:         'capture',
    Net:           'capture',
    Snapback:      'capture',
    Tesuji:        'capture',
    LifeAndDeath:  'basic_life',
    Eye:           'basic_life',
    FalseEye:      'basic_life',
    TwoEyes:       'basic_life',
    Seki:          'basic_life',
    Semeai:        'basic_life',
    CapturingRace: 'basic_life',
    Cutting:       'connection',
    Connecting:    'connection',
    CrossCut:      'connection',
    Ladder:        'ladder',
    LadderBreaker: 'ladder',
    Ko:            'ko',
    KoFight:       'ko',
    Shape:         'shape',
    GoodShape:     'shape',
    EmptyTriangle: 'shape',
    Hane:          'shape',
    Keima:         'shape',
    Kosumi:        'shape',
    Nobi:          'shape',
    Tobi:          'shape',
    Direction:     'direction',
    BigPoint:      'direction',
    Fuseki:        'direction',
    Tenuki:        'direction',
    Joseki:        'joseki',
    Thickness:     'influence',
    Influence:     'influence',
    Moyo:          'influence',
    Invasion:      'influence',
    Reduction:     'influence',
    Aji:           'influence',
    Sabaki:        'influence',
    Shinogi:       'influence',
    Territory:     'influence',
    Endgame:       'endgame',
    Yose:          'endgame',
    Sente:         'endgame',
    Gote:          'endgame',
  };

  // Tsumego problem categories (from tsumego_problems.category) → error category
  const PROBLEM_TOPIC_TO_CATEGORY = {
    life_death: 'basic_life',
    tesuji:     'capture',
    shape:      'shape',
  };

  // ── YouTube resources ───────────────────────────────────────────────────────
  // One or two entries per category. Channel-page and channel-search URLs only —
  // no specific video IDs (those can disappear; channels last for years).
  //
  // Channels:
  //   Dwyrin (@dwyrin)      — Back to Basics series; fundamentals-first approach
  //   Nick Sibicky (@nicksibicky) — Seattle Go Center lectures; broad topic coverage
  //   In Sente (@insente)   — Strategic and endgame content by Shawn Ray
  const YOUTUBE = {
    capture: [
      { label: 'Back to Basics — captures & tactics', channel: 'Dwyrin',       url: 'https://www.youtube.com/@dwyrin/search?query=capture' },
      { label: 'Tesuji lecture series',               channel: 'Nick Sibicky', url: 'https://www.youtube.com/@nicksibicky/search?query=tesuji' },
    ],
    basic_life: [
      { label: 'Life and Death — Back to Basics',     channel: 'Dwyrin',       url: 'https://www.youtube.com/@dwyrin/search?query=life+death' },
      { label: 'Life & Death lecture series',          channel: 'Nick Sibicky', url: 'https://www.youtube.com/@nicksibicky/search?query=life+death' },
    ],
    connection: [
      { label: 'Cutting and connecting basics',        channel: 'Dwyrin',       url: 'https://www.youtube.com/@dwyrin/search?query=cut+connect' },
      { label: 'Connection lecture',                   channel: 'Nick Sibicky', url: 'https://www.youtube.com/@nicksibicky/search?query=connection' },
    ],
    ladder: [
      { label: 'Ladders — Back to Basics',             channel: 'Dwyrin',       url: 'https://www.youtube.com/@dwyrin/search?query=ladder' },
      { label: 'Ladder & net lecture',                 channel: 'Nick Sibicky', url: 'https://www.youtube.com/@nicksibicky/search?query=ladder' },
    ],
    ko: [
      { label: 'Ko fights explained',                  channel: 'Nick Sibicky', url: 'https://www.youtube.com/@nicksibicky/search?query=ko+fight' },
      { label: 'Ko fundamentals',                      channel: 'In Sente',     url: 'https://www.youtube.com/@insente/search?query=ko' },
    ],
    shape: [
      { label: 'Good shape — Back to Basics',          channel: 'Dwyrin',       url: 'https://www.youtube.com/@dwyrin/search?query=shape' },
      { label: 'Shape lecture series',                 channel: 'Nick Sibicky', url: 'https://www.youtube.com/@nicksibicky/search?query=shape' },
    ],
    direction: [
      { label: 'Direction of play',                    channel: 'In Sente',     url: 'https://www.youtube.com/@insente/search?query=direction' },
      { label: 'Big moves & direction lecture',        channel: 'Nick Sibicky', url: 'https://www.youtube.com/@nicksibicky/search?query=direction' },
    ],
    joseki: [
      { label: 'Joseki for kyu players',               channel: 'Nick Sibicky', url: 'https://www.youtube.com/@nicksibicky/search?query=joseki' },
      { label: 'Opening principles',                   channel: 'In Sente',     url: 'https://www.youtube.com/@insente/search?query=opening' },
    ],
    influence: [
      { label: 'Influence and thickness',              channel: 'In Sente',     url: 'https://www.youtube.com/@insente/search?query=influence+thickness' },
      { label: 'Influence lecture',                    channel: 'Nick Sibicky', url: 'https://www.youtube.com/@nicksibicky/search?query=influence' },
    ],
    endgame: [
      { label: 'Endgame (yose) fundamentals',          channel: 'In Sente',     url: 'https://www.youtube.com/@insente/search?query=endgame+yose' },
      { label: 'Endgame lecture series',               channel: 'Nick Sibicky', url: 'https://www.youtube.com/@nicksibicky/search?query=endgame' },
    ],
  };

  // ── Book recommendations ────────────────────────────────────────────────────
  // Three tiers keyed to rank_score thresholds (same scale as _errorCategories.js:
  // 0 = 30 kyu, ~100 per kyu step; 1000 ≈ 20 kyu; 2000 ≈ 10 kyu).
  const BOOKS = [
    {
      tier:  'beginner',
      label: 'Recommended reading for your level',
      books: [
        { title: 'Go: A Complete Introduction to the Game', author: 'Cho Chikun' },
        { title: 'Graded Go Problems for Beginners, Vol. 1', author: 'Kano Yoshinori' },
      ],
    },
    {
      tier:  'intermediate',
      label: 'Recommended reading for your level',
      books: [
        { title: 'Lessons in the Fundamentals of Go', author: 'Kageyama Toshiro' },
        { title: 'Life and Death',                    author: 'James Davies' },
        { title: 'Tesuji',                            author: 'James Davies' },
      ],
    },
    {
      tier:  'advanced',
      label: 'Recommended reading for your level',
      books: [
        { title: 'Attack and Defense',    author: 'Ishida Akira & James Davies' },
        { title: 'The Direction of Play', author: 'Kajiwara Takeo' },
        { title: 'Positional Judgment',   author: 'Cho Chikun' },
      ],
    },
  ];

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Return up to 2 YouTube links for a Claude studyKeyword (e.g. "LifeAndDeath").
   * Returns [] when no mapping exists — callers should check length before rendering.
   */
  function videosForKeyword(studyKeyword) {
    const cat = KEYWORD_TO_CATEGORY[studyKeyword];
    return cat ? (YOUTUBE[cat] || []).slice(0, 2) : [];
  }

  /**
   * Return 1 YouTube link for a tsumego problem topic ('life_death', 'tesuji', 'shape').
   * Returns [] when no mapping exists.
   */
  function videosForProblemTopic(topic) {
    const cat = PROBLEM_TOPIC_TO_CATEGORY[topic] || KEYWORD_TO_CATEGORY[topic];
    return cat ? (YOUTUBE[cat] || []).slice(0, 1) : [];
  }

  /**
   * Return the book tier appropriate for a student's rank_score.
   */
  function booksForScore(rankScore) {
    if (rankScore >= 2000) return BOOKS[2];
    if (rankScore >= 1000) return BOOKS[1];
    return BOOKS[0];
  }

  return { videosForKeyword, videosForProblemTopic, booksForScore };
})();

window.Resources = Resources;
