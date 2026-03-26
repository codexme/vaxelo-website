-- ============================================================
-- VAXELO AI — DATABASE TABLES
-- Run this in Supabase Dashboard → SQL Editor
-- ============================================================

-- Trial tokens issued on new installs
CREATE TABLE IF NOT EXISTS trial_tokens (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  token      text UNIQUE NOT NULL,
  fingerprint text,
  created_at timestamptz DEFAULT now()
);

-- One row per API call (used to enforce FREE_DAILY_LIMIT = 5)
CREATE TABLE IF NOT EXISTS trial_calls (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  trial_token  text NOT NULL,
  called_date  date NOT NULL DEFAULT CURRENT_DATE,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trial_calls_token_date
  ON trial_calls (trial_token, called_date);

-- Block direct client reads (service role bypasses RLS)
ALTER TABLE trial_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE trial_calls  ENABLE ROW LEVEL SECURITY;
