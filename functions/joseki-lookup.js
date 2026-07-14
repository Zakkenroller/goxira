// Joseki/Fuseki dictionary lookup.
//
// Two modes:
//   1. { category }                    → list root-level patterns for the given category
//   2. { positionHash }                → find patterns matching a specific position state
//   3. { parentHash, category }        → list continuations from a given position
//
// The opening_patterns table stores individual named sequences.
// Each row has:
//   moves        jsonb  — ordered array [{ color, x, y }, ...]
//   position_hash text  — stable hash of the move sequence for fast keyed lookup
//
// A "position hash" is computed client-side as the SHA-256 of the canonical
// sorted move list (color+coord pairs, sorted so board rotations/reflections
// are treated as distinct — intentional; joseki is corner-specific).
//
// This function returns up to 20 matching patterns ordered by difficulty.

const { corsHeaders } = require('./_auth');

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  try {
    const { positionHash, category, limit = 20 } = JSON.parse(event.body || '{}');

    const url = new URL(`${SUPABASE_URL}/rest/v1/opening_patterns`);

    if (positionHash) {
      // Exact position lookup — find patterns whose move sequence produces this hash
      url.searchParams.set('position_hash', `eq.${positionHash}`);
    } else if (category) {
      // Browse by category — return root patterns (fewest moves first)
      url.searchParams.set('category', `eq.${category}`);
      url.searchParams.set('order', 'difficulty.asc,name.asc');
    } else {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'positionHash or category required' }),
      };
    }

    url.searchParams.set('select', 'id,name,category,corner,difficulty,moves,position_hash,description,result,tags');
    url.searchParams.set('limit',  String(Math.min(Number(limit), 50)));

    const res = await fetch(url.toString(), {
      headers: {
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    if (!res.ok) throw new Error(`Supabase error ${res.status}`);
    const patterns = await res.json();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ patterns }),
    };
  } catch (e) {
    console.error('joseki-lookup error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
