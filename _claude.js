/**
 * _claude.js — shared Anthropic API helper
 * Used by all Netlify functions. Never imported by the browser.
 */

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

async function callClaude(systemPrompt, messages, maxTokens = 1000) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.content[0].text;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

function ok(body) {
  return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(body) };
}

function err(message, code = 500) {
  return { statusCode: code, headers: corsHeaders(), body: JSON.stringify({ error: message }) };
}

module.exports = { callClaude, ok, err, corsHeaders };
