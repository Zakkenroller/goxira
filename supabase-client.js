/**
 * supabase-client.js
 * Thin wrapper around Supabase JS v2.
 * SUPABASE_URL and SUPABASE_ANON_KEY are injected at build time
 * via a small config object the HTML page defines before loading this.
 *
 * Usage in HTML:
 *   <script>
 *     window.GOTUTOR_CONFIG = {
 *       supabaseUrl: 'https://xxxx.supabase.co',
 *       supabaseAnonKey: 'eyJ...'
 *     };
 *   </script>
 *   <script src="js/supabase-client.js"></script>
 */

const { createClient } = supabase; // from CDN

const cfg = window.GOTUTOR_CONFIG || {};
const sb  = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

// ── Auth helpers ────────────────────────────────────────────────────────── //

const Auth = {
  async signUp(email, password, displayName) {
    const { data, error } = await sb.auth.signUp({
      email, password,
      options: { data: { display_name: displayName } }
    });
    if (error) throw error;
    return data;
  },

  async signIn(email, password) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },

  async signInWithGoogle() {
    const { data, error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}/home.html` }
    });
    if (error) throw error;
    return data;
  },

  async signOut() {
    const { error } = await sb.auth.signOut();
    if (error) throw error;
    location.href = '/index.html';
  },

  async getSession() {
    const { data: { session } } = await sb.auth.getSession();
    return session;
  },

  async getUser() {
    const { data: { user } } = await sb.auth.getUser();
    return user;
  },

  onAuthChange(callback) {
    sb.auth.onAuthStateChange(callback);
  },
};

// ── User profile helpers ─────────────────────────────────────────────────── //

const UserDB = {
  async getProfile(userId) {
    const { data, error } = await sb
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
    if (error) return null;
    return data;
  },

  async createProfile(userId, displayName) {
    const { data, error } = await sb.from('users').insert({
      id: userId,
      display_name: displayName,
      current_rank: '30 kyu',
      rank_score: 0,
      assessment_done: false,
    }).select().single();
    if (error) throw error;
    return data;
  },

  async updateRank(userId, rank, score, confidence = null) {
    const update = { current_rank: rank, rank_score: score };
    if (confidence) update.rank_confidence = confidence;
    const { error } = await sb.from('users').update(update).eq('id', userId);
    if (error) throw error;

    // Also log to rank_history
    await sb.from('rank_history').insert({
      user_id: userId,
      rank,
      rank_score: score,
    });
  },

  // Set rank manually from the profile page.
  // isGranular=true means the user provided a specific rank (e.g., "15 kyu" from OGS) →
  // trust it immediately and set confidence='high'. Rough bucket → confidence stays 'low'.
  async setManualRank(userId, rank, score, isGranular) {
    const confidence = isGranular ? 'high' : 'low';
    let { error } = await sb.from('users').update({
      current_rank: rank,
      rank_score: score,
      rank_confidence: confidence,
      games_calibrated: 0, // reset: game data may not reflect the new rank
    }).eq('id', userId);

    // Fall back to base columns if extended columns don't exist in this DB
    if (error) {
      console.warn('Full rank update failed, trying minimal update:', error.message);
      ({ error } = await sb.from('users').update({
        current_rank: rank,
        rank_score: score,
      }).eq('id', userId));
    }

    if (error) throw error;

    const { error: histError } = await sb.from('rank_history').insert({ user_id: userId, rank, rank_score: score });
    if (histError) console.error('rank_history insert failed:', histError);
  },

  // Called by rank-calibrate.js response handler after a qualifying 9x9 game.
  async calibrateRank(userId, newScore, newGamesCalibrated) {
    const newRank = Rank.scoreToRank(newScore);
    const rankConfidence = newGamesCalibrated >= 5 ? 'high' : 'low';
    const update = {
      rank_score: newScore,
      current_rank: newRank,
      games_calibrated: newGamesCalibrated,
      rank_confidence: rankConfidence,
    };
    const { error } = await sb.from('users').update(update).eq('id', userId);
    if (error) throw error;

    await sb.from('rank_history').insert({ user_id: userId, rank: newRank, rank_score: newScore });
  },

  async markAssessmentDone(userId) {
    const { error } = await sb.from('users').update({ assessment_done: true }).eq('id', userId);
    if (error) throw error;
  },

  async saveGame(userId, sgf, boardSize, source, turns = null, outcome = null, playerColor = null) {
    const row = { user_id: userId, sgf_content: sgf, board_size: boardSize, source };
    if (turns?.length)  row.turns = turns;
    if (outcome)        row.outcome = outcome;
    if (playerColor)    row.player_color = playerColor;
    const { data, error } = await sb.from('saved_games').insert(row).select().single();
    if (error) throw error;
    return data;
  },

  async updateGameOutcome(userId, gameId, outcome, playerColor) {
    const { error } = await sb.from('saved_games')
      .update({ outcome, player_color: playerColor })
      .eq('id', gameId).eq('user_id', userId);
    if (error) console.error('updateGameOutcome:', error);
  },

  async deleteGame(userId, gameId) {
    const { error } = await sb.from('saved_games')
      .delete()
      .eq('id', gameId).eq('user_id', userId);
    if (error) throw error;
  },

  async saveAiSummary(gameId, summary) {
    const { error } = await sb.from('saved_games')
      .update({ ai_summary: summary })
      .eq('id', gameId);
    if (error) console.error('saveAiSummary error:', error);
  },

  async saveTurns(gameId, turns) {
    const { error } = await sb.from('saved_games')
      .update({ turns })
      .eq('id', gameId);
    if (error) console.error('saveTurns error:', error);
  },

  async setGamePublic(gameId, isPublic) {
    const { error } = await sb.from('saved_games')
      .update({ public: isPublic })
      .eq('id', gameId);
    if (error) throw error;
  },

  async getGames(userId, limit = 10) {
    const { data, error } = await sb
      .from('saved_games')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return [];
    return data;
  },

  async logAttempt(userId, problemId, boardSize, topic, solved, hintsUsed) {
    const { error } = await sb.from('problem_attempts').insert({
      user_id: userId,
      problem_id: problemId,
      board_size: boardSize,
      topic,
      solved,
      hints_used: hintsUsed,
    });
    if (error) console.error('Log attempt error:', error);
  },

  async getSolvedCount(userId) {
    const { count } = await sb
      .from('problem_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('solved', true);
    return count || 0;
  },
};

// ── Rank utilities ───────────────────────────────────────────────────────── //

const Rank = {
  // Convert numeric score to display rank
  // Score 0–2999 → kyus 30–1, score 3000+ → dan levels
  scoreToRank(score) {
    if (score < 3000) {
      const kyu = Math.max(1, 30 - Math.floor(score / 100));
      return `${kyu} kyu`;
    } else {
      const dan = Math.min(9, Math.floor((score - 3000) / 200) + 1);
      return `${dan} dan`;
    }
  },

  // Map score to the rough 5-bucket system used when confidence is 'low'.
  getBucket(score) {
    if (score < 400)  return '30\u201326 kyu';
    if (score < 900)  return '25\u201321 kyu';
    if (score < 1400) return '20\u201316 kyu';
    if (score < 2000) return '15\u201310 kyu';
    return '9 kyu and above';
  },

  // Return the rank string to display in the UI.
  // Uses specific rank when confidence='high'; rough bucket otherwise.
  displayRank(currentRank, rankScore, rankConfidence) {
    return rankConfidence === 'high' ? currentRank : this.getBucket(rankScore);
  },

  // Points awarded/deducted per problem
  pointsForProblem(solved, hintsUsed, difficulty = 1) {
    if (!solved) return -5 * difficulty;
    const base = 15 * difficulty;
    return Math.max(5, base - hintsUsed * 4);
  },
};

window.Auth  = Auth;
window.UserDB = UserDB;
window.Rank  = Rank;
window.sb    = sb;
