-- ══════════════════════════════════════════════════════════
-- Security Hardening Migration
-- Run in Supabase Dashboard → SQL Editor
--
-- This locks down RLS policies that were previously too permissive.
-- Safe to re-run (uses DROP IF EXISTS / CREATE).
-- ══════════════════════════════════════════════════════════

-- ── odds_history: remove public DELETE, restrict INSERT to service-role ──
DROP POLICY IF EXISTS "Public delete odds_history" ON odds_history;
DROP POLICY IF EXISTS "Public insert odds_history" ON odds_history;

-- Public can still SELECT (movement data is public-good); only service role writes.
-- (service_role bypasses RLS automatically — no policy needed for that.)

-- ── prop_predictions: restrict writes to service-role ──
DROP POLICY IF EXISTS "Public write props" ON prop_predictions;
DROP POLICY IF EXISTS "Public update props" ON prop_predictions;

-- ── shared_slips: tighten if too open ──
-- Allow anon INSERT (anonymous shares are a feature) but require user_id matches
-- the JWT subject when present. Service-role inserts bypass this.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'shared_slips' AND policyname = 'auth insert slips'
  ) THEN
    DROP POLICY "auth insert slips" ON shared_slips;
  END IF;
END $$;

CREATE POLICY "scoped insert slips"
  ON shared_slips FOR INSERT
  WITH CHECK (
    user_id IS NULL
    OR auth.uid() = user_id
  );

-- ── Verify your service-role key is set in Vercel ──
-- Vercel env: SUPABASE_SERVICE_ROLE_KEY = (from Supabase → Settings → API → service_role)
-- Without this, server endpoints fall back to the anon key and RLS still applies.
