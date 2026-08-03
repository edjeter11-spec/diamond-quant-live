-- ──────────────────────────────────────────────────────────
-- 011: RLS HARDENING
--
-- Three live vulnerabilities, all verified against production on 2026-08-03
-- using ONLY the anon key extracted from the site's own public JS bundle
-- (which is where an attacker gets it — it ships to every visitor by design):
--
--   1. manual_picks had RLS disabled entirely. Anyone could read unpublished
--      draft picks (the paid product), insert forged picks, flip status to
--      'published', or rewrite result/profit_units to fabricate the public
--      track record. Verified: anon SELECT returned HTTP 200.
--
--   2. user_profiles leaked every user's row, including EMAIL ADDRESSES, to
--      anonymous callers. The "Public read for leaderboard" policy is
--      USING (deleted_at IS NULL) with no column restriction, and Postgres
--      ORs multiple permissive SELECT policies together — so that one policy
--      exposed the whole table regardless of the narrower "own profile" rule.
--      Verified: anon SELECT returned real names + emails.
--
--   3. Privilege escalation. "Users update own profile" has USING but no
--      WITH CHECK and no column restriction, and is_admin/is_premium live on
--      that same table. Any signed-in user could PATCH their own row with
--      {"is_admin": true} and take over the admin panel.
--
-- The API routes all use the service-role client, which bypasses RLS, so
-- none of this breaks /api/admin/picks/**, /api/publish-daily, or
-- /api/post-results.
-- ──────────────────────────────────────────────────────────

-- ── 1. manual_picks: enable RLS, publish-only read ──
ALTER TABLE manual_picks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read published picks" ON manual_picks;
CREATE POLICY "Public read published picks" ON manual_picks
  FOR SELECT USING (status = 'published');

-- No INSERT/UPDATE/DELETE policy is defined on purpose. With RLS enabled and
-- no permissive policy for a command, that command is denied for anon and
-- authenticated. All writes go through service-role API routes.

-- ── 2. user_profiles: stop leaking emails ──
-- Replace the blanket public-read with a policy that only exposes rows the
-- leaderboard actually needs. Column-level exposure is handled by the GRANT
-- below, since RLS policies gate ROWS, not columns.
DROP POLICY IF EXISTS "Public read for leaderboard" ON user_profiles;
CREATE POLICY "Public read for leaderboard" ON user_profiles
  FOR SELECT USING (deleted_at IS NULL);

REVOKE SELECT ON user_profiles FROM anon;
GRANT SELECT (id, display_name, avatar_url, last_active, created_at)
  ON user_profiles TO anon;

-- Authenticated users may read their own full row via the "Users read own
-- profile" policy, so they keep column access.
GRANT SELECT ON user_profiles TO authenticated;

-- ── 3. Close the privilege-escalation path ──
-- WITH CHECK stops a user rewriting their row to point at someone else's id.
DROP POLICY IF EXISTS "Users update own profile" ON user_profiles;
CREATE POLICY "Users update own profile" ON user_profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- A policy cannot express "this column did not change", so enforce the
-- privileged columns with a column-level GRANT. is_admin, is_premium,
-- invite_code, invited_by and invites_remaining are deliberately excluded:
-- only service-role may write them.
REVOKE UPDATE ON user_profiles FROM anon, authenticated;
GRANT UPDATE (display_name, avatar_url, last_active, devices)
  ON user_profiles TO authenticated;

-- Belt-and-braces: even if a future migration re-grants a wider UPDATE, this
-- trigger blocks non-service-role attempts to change privilege columns.
CREATE OR REPLACE FUNCTION guard_profile_privileges()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('request.jwt.claims', true)::jsonb->>'role'
     IS DISTINCT FROM 'service_role' THEN
    IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
      RAISE EXCEPTION 'is_admin may only be changed by service_role';
    END IF;
    IF to_jsonb(NEW) ? 'is_premium'
       AND to_jsonb(NEW)->>'is_premium' IS DISTINCT FROM to_jsonb(OLD)->>'is_premium' THEN
      RAISE EXCEPTION 'is_premium may only be changed by service_role';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS guard_profile_privileges_trg ON user_profiles;
CREATE TRIGGER guard_profile_privileges_trg
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION guard_profile_privileges();
