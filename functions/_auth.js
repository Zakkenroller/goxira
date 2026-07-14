'use strict';

// Authentication + CORS helpers for Netlify functions.
//
// Why this exists: every AI endpoint spends real money (Anthropic API,
// KataGo VPS CPU). All pages already require a Supabase login client-side,
// so requiring the session token server-side blocks scripted abuse without
// changing any user flow.
//
// requireUser(event) validates the Supabase JWT from the Authorization
// header by calling ${SUPABASE_URL}/auth/v1/user — the same URL + anon key
// the functions already have, so self-hosters need no new secrets.
//
// Rollout: enforcement is gated on REQUIRE_AUTH=true so the frontend change
// (api.js attaching the token) can deploy first. Until the flag is set,
// unauthenticated requests are logged and allowed.
//
// Failure policy: a token Supabase rejects is a hard 401 (fail closed);
// a network error reaching Supabase is logged and allowed (fail open) —
// an attacker can't induce that, and blocking every student because the
// auth endpoint blipped is worse than one uncounted request.

const VALIDATION_TTL_MS = 60 * 1000;
const tokenCache = new Map(); // token -> { userId, expiresAt } (warm-lambda reuse)

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': process.env.SITE_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
}

// Returns the user id, or null if Supabase definitively rejects the token.
// Throws on network/availability errors.
async function validateToken(token) {
  const cached = tokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.userId;

  const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'apikey': process.env.SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${token}`,
    },
  });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`Supabase auth endpoint returned ${res.status}`);
  const user = await res.json();
  if (!user?.id) return null;

  if (tokenCache.size > 500) tokenCache.clear(); // bound warm-lambda memory
  tokenCache.set(token, { userId: user.id, expiresAt: Date.now() + VALIDATION_TTL_MS });
  return user.id;
}

// Returns { userId } when the request may proceed (userId is null when auth
// is not enforced and no valid token was sent), or { errorResponse } to be
// returned from the handler as-is.
async function requireUser(event) {
  const enforce = process.env.REQUIRE_AUTH === 'true';
  const header = event.headers?.['authorization'] || event.headers?.['Authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (token) {
    try {
      const userId = await validateToken(token);
      if (userId) return { userId };
    } catch (e) {
      console.error('Auth validation unavailable, allowing request:', e.message);
      return { userId: null };
    }
  }

  if (!enforce) {
    if (!token) console.warn('Unauthenticated request allowed (REQUIRE_AUTH not enabled)');
    return { userId: null };
  }

  return {
    errorResponse: {
      statusCode: 401,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Please sign in to use this feature.' }),
    },
  };
}

module.exports = { corsHeaders, requireUser };
