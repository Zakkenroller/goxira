'use strict';

// Shared Anthropic Messages API caller.
// Raw fetch by design: the functions bundle has no package.json and zero npm
// dependencies is a project goal (self-hostability). Every caller MUST catch
// ClaudeApiError and degrade honestly — never let a Claude outage surface as
// a raw 500 to the student (see CLAUDE.md degradation table).

class ClaudeApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ClaudeApiError';
    this.status = status; // HTTP status, or 0 for timeout/network failure
  }
}

// Returns the text of the first content block. Throws ClaudeApiError on any
// non-2xx response, timeout, network failure, or missing text content.
async function callClaude({ model, system, messages, maxTokens, timeoutMs = 20000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res, data;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
      signal: controller.signal,
    });
    data = await res.json().catch(() => null);
  } catch (e) {
    if (e.name === 'AbortError') throw new ClaudeApiError(`Claude API timeout after ${timeoutMs}ms`);
    throw new ClaudeApiError(`Claude API network error: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new ClaudeApiError(
      `Claude API error ${res.status}: ${data?.error?.message || 'unknown'}`,
      res.status
    );
  }
  const text = data?.content?.[0]?.text;
  if (typeof text !== 'string') {
    throw new ClaudeApiError('Claude API returned no text content', res.status);
  }
  return text;
}

module.exports = { callClaude, ClaudeApiError };
