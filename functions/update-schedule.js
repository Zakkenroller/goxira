// SM-2 spaced repetition schedule updater.
// Called after each tsumego attempt to update the per-user-per-problem review schedule.
//
// SM-2 algorithm:
//   quality: 0–5 (0–2 = fail, 3–5 = pass with increasing ease)
//   ease_factor: starts 2.5, adjusted by (0.1 - (5-q)*(0.08 + (5-q)*0.02)), min 1.3
//   interval:
//     first correct  → 1 day
//     second correct → 6 days
//     subsequent     → round(prev_interval * ease_factor)
//   on failure: reset interval to 1, keep ease_factor adjustment

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Map attempt outcome to SM-2 quality score (0–5).
// solved:        true/false
// hintsUsed:     0, 1, 2+ (affects quality within solved=true band)
// attemptNumber: 1-based total attempts before getting it right (or giving up)
function qualityScore(solved, hintsUsed, attemptNumber) {
  if (!solved) return 1; // failed — below threshold, triggers reset
  if (hintsUsed === 0 && attemptNumber === 1) return 5; // perfect recall
  if (hintsUsed === 0) return 4;                        // correct but not first try
  if (hintsUsed === 1) return 3;                        // needed one hint
  return 2; // technically solved but required heavy scaffolding (treated as borderline fail)
}

// SM-2 step: given current state and quality (0–5), return next state.
function sm2Next(easeFactor, intervalDays, consecutiveCorrect, quality) {
  // Clamp quality
  const q = Math.max(0, Math.min(5, quality));

  let newEase = easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  newEase = Math.max(1.3, Math.round(newEase * 100) / 100);

  let newInterval;
  let newConsecutive;

  if (q < 3) {
    // Failed: reset streak and interval, but keep (reduced) ease_factor
    newInterval     = 1;
    newConsecutive  = 0;
  } else {
    newConsecutive = consecutiveCorrect + 1;
    if (newConsecutive === 1)      newInterval = 1;
    else if (newConsecutive === 2) newInterval = 6;
    else                           newInterval = Math.round(intervalDays * easeFactor);
  }

  const nextReviewDate = new Date();
  nextReviewDate.setDate(nextReviewDate.getDate() + newInterval);
  const nextReviewStr = nextReviewDate.toISOString().slice(0, 10); // YYYY-MM-DD

  return {
    ease_factor:          newEase,
    interval_days:        newInterval,
    consecutive_correct:  newConsecutive,
    next_review_date:     nextReviewStr,
    last_reviewed_at:     new Date().toISOString(),
  };
}

async function getSchedule(userId, problemId, authHeader) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/problem_schedule`);
  url.searchParams.set('user_id',   `eq.${userId}`);
  url.searchParams.set('problem_id', `eq.${problemId}`);
  url.searchParams.set('select',    'id,ease_factor,interval_days,consecutive_correct');
  url.searchParams.set('limit',     '1');

  const res = await fetch(url.toString(), {
    headers: {
      'apikey':        SUPABASE_ANON_KEY,
      'Authorization': authHeader,
    },
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

async function upsertSchedule(userId, problemId, state, authHeader) {
  const url = `${SUPABASE_URL}/rest/v1/problem_schedule`;
  const body = {
    user_id:             userId,
    problem_id:          problemId,
    ease_factor:         state.ease_factor,
    interval_days:       state.interval_days,
    consecutive_correct: state.consecutive_correct,
    next_review_date:    state.next_review_date,
    last_reviewed_at:    state.last_reviewed_at,
  };

  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'apikey':        SUPABASE_ANON_KEY,
      'Authorization': authHeader,
      'Content-Type':  'application/json',
      'Prefer':        'resolution=merge-duplicates',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase upsert error ${res.status}: ${text}`);
  }
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type':                 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  try {
    const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
    if (!authHeader.startsWith('Bearer ')) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    const { userId, problemId, solved, hintsUsed, attemptNumber } = JSON.parse(event.body);
    if (!userId || !problemId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'userId and problemId required' }) };
    }

    const quality  = qualityScore(!!solved, hintsUsed || 0, attemptNumber || 1);
    const existing = await getSchedule(userId, problemId, authHeader);

    const currentState = existing || {
      ease_factor:         2.5,
      interval_days:       1,
      consecutive_correct: 0,
    };

    const nextState = sm2Next(
      currentState.ease_factor,
      currentState.interval_days,
      currentState.consecutive_correct,
      quality,
    );

    await upsertSchedule(userId, problemId, nextState, authHeader);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        quality,
        nextReviewDate: nextState.next_review_date,
        intervalDays:   nextState.interval_days,
        easeFactor:     nextState.ease_factor,
      }),
    };
  } catch (e) {
    console.error('update-schedule error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
