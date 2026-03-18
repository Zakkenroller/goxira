// Glossary — scans rendered text for known Go terms and wraps them in interactive tooltips.
//
// Usage:
//   1. Include <script src="glossary.js"></script> on any page that renders Claude text.
//   2. After inserting Claude's text into a DOM element, call: Glossary.wrap(element)
//
// Tooltips are injected inline as <abbr class="go-term" title="..."> elements.
// A shared floating tooltip div provides richer display with a small popover.

const Glossary = (() => {
  let terms = null; // loaded lazily from glossary.json

  // Load once, cache in module scope.
  async function loadTerms() {
    if (terms) return terms;
    try {
      const res = await fetch('/glossary.json');
      terms = res.ok ? await res.json() : {};
    } catch {
      terms = {};
    }
    return terms;
  }

  // Build a regex that matches any known term (case-insensitive, whole word).
  function buildPattern(termMap) {
    const escaped = Object.keys(termMap)
      .sort((a, b) => b.length - a.length) // longest first to avoid partial matches
      .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');
  }

  // Walk text nodes inside el and wrap recognized terms.
  // Skips text inside <a>, <abbr>, <code>, <pre> elements.
  function walkAndWrap(el, pattern, termMap) {
    const SKIP_TAGS = new Set(['A', 'ABBR', 'CODE', 'PRE', 'SCRIPT', 'STYLE']);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        let p = node.parentElement;
        while (p && p !== el) {
          if (SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
          p = p.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) textNodes.push(node);

    for (const textNode of textNodes) {
      const text = textNode.nodeValue;
      if (!pattern.test(text)) { pattern.lastIndex = 0; continue; }
      pattern.lastIndex = 0;

      const frag = document.createDocumentFragment();
      let last = 0;
      let m;
      while ((m = pattern.exec(text)) !== null) {
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const abbr = document.createElement('abbr');
        abbr.className = 'go-term';
        abbr.textContent = m[0];
        abbr.dataset.def = termMap[m[0]] || termMap[Object.keys(termMap).find(
          k => k.toLowerCase() === m[0].toLowerCase()
        )] || '';
        frag.appendChild(abbr);
        last = m.index + m[0].length;
      }
      pattern.lastIndex = 0;
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));

      textNode.parentNode.replaceChild(frag, textNode);
    }
  }

  // ── Tooltip overlay ──────────────────────────────────────────────────────
  function ensureTooltip() {
    let tip = document.getElementById('go-term-tooltip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'go-term-tooltip';
      tip.style.cssText = [
        'position:fixed',
        'z-index:9999',
        'max-width:280px',
        'background:#1a1814',
        'color:#f5f0e8',
        'border-radius:8px',
        'padding:0.6rem 0.85rem',
        'font-size:0.8rem',
        'line-height:1.5',
        'box-shadow:0 4px 20px rgba(0,0,0,0.35)',
        'pointer-events:none',
        'opacity:0',
        'transition:opacity 0.15s ease',
        'word-break:break-word',
      ].join(';');
      document.body.appendChild(tip);
    }
    return tip;
  }

  function showTooltip(abbr) {
    const tip = ensureTooltip();
    const def = abbr.dataset.def;
    if (!def) return;
    const term = abbr.textContent;
    tip.innerHTML = `<strong style="display:block;margin-bottom:0.2rem;font-size:0.75rem;letter-spacing:0.06em;text-transform:uppercase;opacity:0.55">${term}</strong>${def}`;

    const rect = abbr.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Position below the term; flip above if not enough room
    let top = rect.bottom + 6;
    let left = Math.max(8, rect.left);

    // Clamp horizontally
    if (left + 288 > vw - 8) left = vw - 296;

    // Flip above if tooltip would overflow viewport bottom
    // (estimate tip height ~80px)
    if (top + 80 > vh) top = rect.top - 86;

    tip.style.top  = `${top}px`;
    tip.style.left = `${left}px`;
    tip.style.opacity = '1';
  }

  function hideTooltip() {
    const tip = document.getElementById('go-term-tooltip');
    if (tip) tip.style.opacity = '0';
  }

  // Delegate events on document for all .go-term elements.
  function attachGlobalEvents() {
    if (Glossary._eventsAttached) return;
    Glossary._eventsAttached = true;

    document.addEventListener('mouseover', e => {
      if (e.target.classList && e.target.classList.contains('go-term')) showTooltip(e.target);
    });
    document.addEventListener('mouseout', e => {
      if (e.target.classList && e.target.classList.contains('go-term')) hideTooltip();
    });
    // Touch: tap to show, tap elsewhere to hide
    document.addEventListener('touchstart', e => {
      const t = e.target;
      if (t.classList && t.classList.contains('go-term')) {
        e.preventDefault();
        showTooltip(t);
      } else {
        hideTooltip();
      }
    }, { passive: false });
  }

  // ── Public API ───────────────────────────────────────────────────────────

  // Wrap all recognized Go terms inside `el` with interactive tooltips.
  // Safe to call multiple times — already-wrapped <abbr> nodes are skipped.
  async function wrap(el) {
    if (!el) return;
    const termMap = await loadTerms();
    if (!Object.keys(termMap).length) return;
    const pattern = buildPattern(termMap);
    walkAndWrap(el, pattern, termMap);
    attachGlobalEvents();
    injectStyles();
  }

  function injectStyles() {
    if (document.getElementById('go-term-styles')) return;
    const style = document.createElement('style');
    style.id = 'go-term-styles';
    style.textContent = `
      abbr.go-term {
        text-decoration: underline dotted rgba(120,90,40,0.5);
        text-underline-offset: 3px;
        cursor: help;
        border-bottom: none;
        color: inherit;
      }
      abbr.go-term:hover {
        text-decoration-color: rgba(120,90,40,0.9);
      }
    `;
    document.head.appendChild(style);
  }

  return { wrap, _eventsAttached: false };
})();

window.Glossary = Glossary;
