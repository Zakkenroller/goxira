const API = (() => {
  async function post(endpoint, body) {
    const res = await fetch(`/.netlify/functions/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Network error' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  }
  return {
    assess(messages, userContext) {
      return post('assess', { messages, userContext });
    },
    generateProblem(rank, topic, boardSize) {
      return post('problem', { rank, topic, boardSize });
    },
    evaluateMove(problem, col, row, attemptNumber, rank) {
      return post('evaluate-move', { problem, col, row, attemptNumber, rank });
    },
    analyzeMove(sgf, moveNumber, boardSize, rank, move, playerColor) {
      return post('analyze-move', { sgf, moveNumber, boardSize, rank, move, playerColor });
    },
    gameSummary(sgf, boardSize, rank, playerColor) {
      return post('game-summary', { sgf, boardSize, rank, playerColor });
    },
    getClaudeMove(sgf, color, boardSize, rank, currentStones) {
      return post('claude-move', { sgf, color, boardSize, rank, currentStones });
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
