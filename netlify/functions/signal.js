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
const IP_MAX_RPM = 20; // 20 req/min per IP

function isRateLimited(ip) {
  const now = Date.now();
  const timestamps = (_ipTimestamps.get(ip) || []).filter(t => now - t < IP_WINDOW_MS);
  if (timestamps.length >= IP_MAX_RPM) return true;
  timestamps.push(now);
  _ipTimestamps.set(ip, timestamps);
  return false;
}

exports.handler = async (event) => {
  // CORS headers — only allow the extension origin
  const headers = {
    'Access-Control-Allow-Origin': '*', // extension has no fixed origin
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // Per-IP throttle
  const clientIp = event.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(clientIp)) {
    return {
      statusCode: 429, headers,
      body: JSON.stringify({ error: 'Too many requests — slow down' })
    };
  }

  // Parse request body
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { messages, model, licenseKey, extensionId } = body;

  // Validate messages
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'messages array required' }) };
  }

  // Server-side Groq API key — never exposed to extension
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) {
    console.error('[Signal] GROQ_API_KEY not set in environment');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  const selectedModel = (typeof model === 'string' && model.length < 100) ? model : PROXY_MODEL;

  // Call Groq
  try {
    const groqRes = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: selectedModel,
        messages,
        max_tokens: MAX_TOKENS,
        temperature: 0.1,
        response_format: { type: 'json_object' }
      })
    });

    const data = await groqRes.json();

    if (!groqRes.ok) {
      // If model not found, retry with fallback
      if (groqRes.status === 404 || groqRes.status === 400) {
        const fallbackRes = await fetch(GROQ_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${groqApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: FALLBACK_MODEL,
            messages,
            max_tokens: MAX_TOKENS,
            temperature: 0.1,
            response_format: { type: 'json_object' }
          })
        });
        const fallbackData = await fallbackRes.json();
        if (!fallbackRes.ok) {
          return {
            statusCode: 502, headers,
            body: JSON.stringify({ error: fallbackData?.error?.message || 'Groq API error' })
          };
        }
        return {
          statusCode: 200, headers,
          body: JSON.stringify({ ok: true, data: fallbackData, model: FALLBACK_MODEL })
        };
      }

      const errMsg = data?.error?.message || `Groq returned HTTP ${groqRes.status}`;
      console.error('[Signal] Groq error:', errMsg);
      return { statusCode: 502, headers, body: JSON.stringify({ error: errMsg }) };
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ ok: true, data, model: selectedModel })
    };

  } catch (err) {
    console.error('[Signal] Network error calling Groq:', err.message);
    return {
      statusCode: 503, headers,
      body: JSON.stringify({ error: 'Proxy network error — try again shortly' })
    };
  }
};
