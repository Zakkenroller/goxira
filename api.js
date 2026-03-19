const API = (() => {
  async function post(endpoint, body, timeoutMs = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`/.netlify/functions/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Network error' }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return res.json();
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Request timed out. Please try again.');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    assess(messages, userContext) {
      return post('assess', { messages, userContext });
    },
    generateProblem(rank, topic, boardSize, category, userId) {
      return post('problem', { rank, topic, boardSize, category, userId });
    },
    updateSchedule(userId, problemId, solved, hintsUsed, attemptNumber) {
      return post('update-schedule', { userId, problemId, solved, hintsUsed, attemptNumber });
    },
    josekiLookup(positionHash, category) {
      return post('joseki-lookup', { positionHash, category });
    },
    josekiDeviation(moveSequence, deviationMove, boardSize, rank) {
      return post('joseki-deviation', { moveSequence, deviationMove, boardSize, rank });
    },
    evaluateMove(problem, col, row, attemptNumber, rank) {
      return post('evaluate-move', { problem, col, row, attemptNumber, rank });
    },
    analyzeMove(sgf, moveNumber, boardSize, rank, move, playerColor, currentStones, precomputedAnalysis) {
      return post('analyze-move', { sgf, moveNumber, boardSize, rank, move, playerColor, currentStones, precomputedAnalysis });
    },
    gameSummary(sgf, boardSize, rank, playerColor, turns = null) {
      const body = { sgf, boardSize, rank, playerColor };
      if (turns?.length) body.turns = turns;
      return post('game-summary', body);
    },
    getHint(sgf, boardSize, rank, playerColor, currentStones, moveNumber) {
      return post('game-hint', { sgf, boardSize, rank, playerColor, currentStones, moveNumber });
    },
    ogsSearch(username) {
      return post('ogs-import', { action: 'search', username });
    },
    ogsGetSGF(gameId) {
      return post('ogs-import', { action: 'sgf', gameId });
    },
  };
})();

const UI = {
  toast(message, type) {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const t = document.createElement('div');
    t.className = 'toast' + (type ? ' toast--' + type : '');
    t.textContent = message;
    container.appendChild(t);
    setTimeout(function() { t.remove(); }, 3200);
  },
  async requireAuth() {
    const session = await Auth.getSession();
    if (!session) { location.href = 'auth.html'; return null; }
    return session;
  },
};

window.API = API;
window.UI = UI;
