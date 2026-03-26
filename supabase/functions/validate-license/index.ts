// ============================================================
// VAXELO AI — VALIDATE LICENSE EDGE FUNCTION
// © 2026 Dawit Debela (codexme) — All rights reserved.
// Supabase Edge Function (Deno)
// Handles: create_trial token on new installs
// ============================================================

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
    const { action, fingerprint } = await req.json();

    if (action === 'create_trial') {
      const trialToken = crypto.randomUUID();

      // Persist token (non-blocking — extension still gets the token even if DB write fails)
      persistTrialToken(trialToken, fingerprint || '').catch(() => {});

      return new Response(
        JSON.stringify({ trial_token: trialToken }),
        { status: 200, headers: resHeaders }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Unknown action' }),
      { status: 400, headers: resHeaders }
    );

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: resHeaders }
    );
  }
});

async function persistTrialToken(token: string, fingerprint: string): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return;

  await fetch(`${supabaseUrl}/rest/v1/trial_tokens`, {
    method: 'POST',
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({
      token,
      fingerprint,
      created_at: new Date().toISOString(),
    }),
  });
}
