/**
 * api.js — fetch wrappers for all Netlify serverless functions
 * All Claude API calls go through these; the key never touches the browser.
 */

const API = (() => {
  async function post(endpoint, body) {
    const session = await Auth.getSession();
    const headers = { 'Content-Type': 'application/json' };
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }
    const res = await fetch(`/api/${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Network error' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  return {
    /**
     * Run the level assessment conversation.
     * @param {Array} messages - [{role, content}] conversation history
     * @param {string} userContext - brief description of user's background
     */
    assess(messages, userContext) {
      return post('assess', { messages, userContext });
    },

    /**
     * Generate a new Go problem for a given rank.
     * @param {string} rank - e.g. "20 kyu"
     * @param {string} topic - optional topic hint
     * @param {number} boardSize - 9, 13, or 19
     */
    generateProblem(rank, topic, boardSize = 9) {
      return post('problem', { rank, topic, boardSize });
    },

    /**
     * Evaluate a user's move on a problem.
     * @param {object} problem - the problem object
     * @param {number} col - user's move column
     * @param {number} row - user's move row
     * @param {number} attemptNumber - 1, 2, 3...
     * @param {string} rank
     */
    evaluateMove(problem, col, row, attemptNumber, rank) {
      return post('evaluate-move', { problem, col, row, attemptNumber, rank });
    },

    /**
     * Analyze a single move in a game replay.
     * @param {string} sgf - full SGF content
     * @param {number} moveNumber - which move to analyze
     * @param {number} boardSize
     * @param {string} rank
     */
    analyzeMove(sgf, moveNumber, boardSize, rank) {
      return post('analyze-move', { sgf, moveNumber, boardSize, rank });
    },

    /**
     * Generate an end-of-game summary with key moments.
     * @param {string} sgf
     * @param {number} boardSize
     * @param {string} rank
     * @param {string} playerColor - 'B' or 'W'
     */
    gameSummary(sgf, boardSize, rank, playerColor) {
      return post('game-summary', { sgf, boardSize, rank, playerColor });
    },

    /**
     * Get Claude's next move in a live game (plays at user's level).
     * @param {string} sgf - current game SGF
     * @param {string} color - 'B' or 'W' (Claude's color)
     * @param {number} boardSize
     * @param {string} rank - user's rank (Claude matches this)
     */
    getClaudeMove(sgf, color, boardSize, rank) {
      return post('claude-move', { sgf, color, boardSize, rank });
    },
  };
})();

// ── UI helpers shared across pages ──────────────────────────────────────── //

const UI = {
  // Show a toast notification
  toast(message, type = '') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const t = document.createElement('div');
    t.className = `toast${type ? ' toast--' + type : ''}`;
    t.textContent = message;
    container.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  },

  // Set button loading state
  setLoading(btn, loading, label = '') {
    if (loading) {
      btn.dataset.originalText = btn.innerHTML;
      btn.innerHTML = `<span class="loader"></span>`;
      btn.disabled = true;
    } else {
      btn.innerHTML = label || btn.dataset.originalText || 'Submit';
      btn.disabled = false;
    }
  },

  // Simple streaming text effect
  typeText(element, text, speed = 12) {
    element.textContent = '';
    let i = 0;
    const tick = () => {
      if (i < text.length) {
        element.textContent += text[i++];
        setTimeout(tick, speed);
      }
    };
    tick();
  },

  // Redirect if not logged in
  async requireAuth() {
    const session = await Auth.getSession();
    if (!session) {
      location.href = '/auth.html';
      return null;
    }
    return session;
  },

  // Render rank badge HTML
  rankBadge(rank, className = '') {
    return `<span class="rank-badge ${className}">${rank}</span>`;
  },
};

window.API = API;
window.UI  = UI;
