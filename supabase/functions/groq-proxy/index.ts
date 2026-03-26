// ============================================================
// VAXELO AI — GROQ PROXY EDGE FUNCTION
// © 2026 Dawit Debela (codexme) — All rights reserved.
// Supabase Edge Function (Deno)
// ============================================================

const PRIMARY_MODEL = 'llama-3.3-70b-versatile';
const FALLBACK_MODEL = 'llama-3.1-8b-instant';
const FREE_DAILY_LIMIT = 5;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const resHeaders = { ...CORS_HEADERS, 'Content-Type': 'application/json' };

  try {
    const { messages, model, license_key, trial_token } = await req.json();

    const groqApiKey = Deno.env.get('GROQ_API_KEY');
    if (!groqApiKey) {
      return new Response(
        JSON.stringify({ error: 'Service configuration error' }),
        { status: 500, headers: resHeaders }
      );
    }

    // ── License / trial gate ──────────────────────────────────
    if (license_key && license_key.length > 6) {
      // Pro user — unlimited (key accepted client-side; server validates format)
    } else if (trial_token) {
      const limited = await isRateLimited(trial_token);
      if (limited) {
        return new Response(
          JSON.stringify({
            error: 'Daily free limit reached. Upgrade to Pro for unlimited signals.',
            code: 'TRIAL_ENDED'
          }),
          { status: 429, headers: resHeaders }
        );
      }
    } else {
      return new Response(
        JSON.stringify({
          error: 'No license or trial token — please reinstall the extension.',
          code: 'TRIAL_EXPIRED'
        }),
        { status: 403, headers: resHeaders }
      );
    }

    // ── Call Groq ─────────────────────────────────────────────
    const selectedModel = model || PRIMARY_MODEL;
    let groqRes = await callGroq(groqApiKey, selectedModel, messages);

    // Hard rate limit from Groq itself
    if (groqRes.status === 429) {
      return new Response(
        JSON.stringify({ error: 'AI rate limited — try again in a moment.' }),
        { status: 429, headers: resHeaders }
      );
    }

    // Model unavailable — fall back
    if ((groqRes.status === 400 || groqRes.status === 404) && selectedModel !== FALLBACK_MODEL) {
      groqRes = await callGroq(groqApiKey, FALLBACK_MODEL, messages);
    }

    if (!groqRes.ok) {
      return new Response(
        JSON.stringify({ error: `AI service error (${groqRes.status})` }),
        { status: 502, headers: resHeaders }
      );
    }

    const data = await groqRes.json();

    // Track usage (non-blocking — never fail the request over this)
    if (trial_token && !(license_key && license_key.length > 6)) {
      trackUsage(trial_token).catch(() => {});
    }

    return new Response(JSON.stringify({ data }), { status: 200, headers: resHeaders });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: resHeaders }
    );
  }
});

// ── Helpers ───────────────────────────────────────────────────

async function callGroq(apiKey: string, model: string, messages: unknown[]) {
  return fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages, temperature: 0.1, max_tokens: 1500 }),
  });
}

async function isRateLimited(trialToken: string): Promise<boolean> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return false; // fail open if DB unreachable

  const today = new Date().toISOString().split('T')[0];

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/trial_calls?trial_token=eq.${encodeURIComponent(trialToken)}&called_date=eq.${today}&select=id`,
      {
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
        },
      }
    );
    const rows = await res.json();
    return Array.isArray(rows) && rows.length >= FREE_DAILY_LIMIT;
  } catch {
    return false; // fail open
  }
}

async function trackUsage(trialToken: string): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return;

  const today = new Date().toISOString().split('T')[0];

  await fetch(`${supabaseUrl}/rest/v1/trial_calls`, {
    method: 'POST',
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ trial_token: trialToken, called_date: today }),
  });
}
