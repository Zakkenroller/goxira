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

  async updateRank(userId, rank, score) {
    const { error } = await sb.from('users').update({
      current_rank: rank,
      rank_score: score,
    }).eq('id', userId);
    if (error) throw error;

    // Also log to rank_history
    await sb.from('rank_history').insert({
      user_id: userId,
      rank,
      rank_score: score,
    });
  },

  async markAssessmentDone(userId) {
    const { error } = await sb.from('users').update({ assessment_done: true }).eq('id', userId);
    if (error) throw error;
  },

  async saveGame(userId, sgf, boardSize, source) {
    const { data, error } = await sb.from('saved_games').insert({
      user_id: userId,
      sgf_content: sgf,
      board_size: boardSize,
      source,
    }).select().single();
    if (error) throw error;
    return data;
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
