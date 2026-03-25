// ============================================================
// VAXELO AI — NETLIFY PROXY FUNCTION
// © 2026 Dawit Debela (codexme) — vaxelo.xyz
// Receives AI analysis requests from the extension,
// calls Groq server-side with the secret API key,
// and returns structured signals.
// GROQ_API_KEY must be set in Netlify environment variables.
// ============================================================

const PROXY_MODEL = 'llama-3.3-70b-versatile';
const FALLBACK_MODEL = 'llama-3.1-8b-instant';
const MAX_TOKENS = 600;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Basic per-IP request throttle (in-memory, resets on cold start)
const _ipTimestamps = new Map();
const IP_WINDOW_MS = 60_000;
const IP_MAX_RPM = 20;

function isRateLimited(ip) {
  const now = Date.now();
  const timestamps = (_ipTimestamps.get(ip) || []).filter(t => now - t < IP_WINDOW_MS);
  if (timestamps.length >= IP_MAX_RPM) return true;
  timestamps.push(now);
  _ipTimestamps.set(ip, timestamps);
  return false;
}

async function callGroq(groqApiKey, model, messages) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${groqApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: MAX_TOKENS,
      temperature: 0.1,
      response_format: { type: 'json_object' },
    }),
  });
  return res;
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    // Per-IP throttle
    const clientIp = event.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
    if (isRateLimited(clientIp)) {
      return { statusCode: 429, headers, body: JSON.stringify({ error: 'Rate limited — try again in a moment' }) };
    }

    // Parse body
    const body = JSON.parse(event.body || '{}');
    const { messages, model } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'messages array required' }) };
    }

    const groqApiKey = process.env.GROQ_API_KEY;
    if (!groqApiKey) {
      console.error('[Signal] GROQ_API_KEY not configured');
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server configuration error' }) };
    }

    const selectedModel = (typeof model === 'string' && model.length < 100) ? model : PROXY_MODEL;

    // Primary Groq call
    let groqRes = await callGroq(groqApiKey, selectedModel, messages);

    // 429 from Groq — surface it directly, don't retry
    if (groqRes.status === 429) {
      return { statusCode: 429, headers, body: JSON.stringify({ error: 'Rate limited — try again in a moment' }) };
    }

    // Model not found — retry once with fallback model
    if ((groqRes.status === 400 || groqRes.status === 404) && selectedModel !== FALLBACK_MODEL) {
      console.warn(`[Signal] ${selectedModel} unavailable, retrying with ${FALLBACK_MODEL}`);
      groqRes = await callGroq(groqApiKey, FALLBACK_MODEL, messages);
      if (groqRes.status === 429) {
        return { statusCode: 429, headers, body: JSON.stringify({ error: 'Rate limited — try again in a moment' }) };
      }
    }

    const data = await groqRes.json();

    if (!groqRes.ok) {
      const errMsg = data?.error?.message || `Groq returned HTTP ${groqRes.status}`;
      console.error('[Signal] Groq error:', errMsg);
      return { statusCode: 502, headers, body: JSON.stringify({ error: errMsg }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ data }) };

  } catch (err) {
    // Single catch-all — prevents Netlify/Cloudflare from returning an HTML 502
    console.error('[Signal] Unhandled error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
