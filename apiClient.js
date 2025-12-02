// Minimal API client wrapper for OpenAI Responses API.
const RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';
const DEFAULT_TIMEOUT_MS = 15000;

async function callResponses(apiKey, payload, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(RESPONSES_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    let data = null;
    if (!res.ok) {
      try {
        data = await res.json();
      } catch (e) {
        // ignore parse errors, fall back to status text
      }
      const apiMessage = data?.error?.message || res.statusText || 'unknown error';
      throw new Error(`API error: ${res.status} ${apiMessage}`);
    }

    data = data || (await res.json());
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

// Expose to popup.js
window.callResponses = callResponses;
