-- ──────────────────────────────────────────────────────────
-- 012: RESTORE SIGNED-IN PROFILE READS
--
-- Regression from migration 011. That migration correctly stopped anonymous
-- callers reading every user's row (it was leaking email addresses), but it
-- did so with a column-level GRANT:
--
--   REVOKE SELECT ON user_profiles FROM anon;
--   GRANT  SELECT (id, display_name, avatar_url, last_active, created_at) ...
--
-- The problem: PostgREST evaluates column privileges against the columns the
-- QUERY asks for, and the client calls `.select("*")` (lib/supabase/auth.tsx,
-- fetchProfile). A `select *` needs privileges on EVERY column, so it fails
-- with 42501 "permission denied for table user_profiles" — for signed-in users
-- reading their OWN row, which the "Users read own profile" RLS policy was
-- always meant to allow.
--
-- Fallout: fetchProfile returned no row, `profile` stayed null, and
-- `isAdmin: profile?.is_admin ?? false` evaluated false for everyone. The
-- entire admin panel vanished, and Create Pick stopped working.
--
-- Fix: give `authenticated` full-column SELECT and let the RLS policies decide
-- WHICH ROWS they see — which is what RLS is for. `anon` keeps the narrow
-- five-column grant, so the email leak stays closed.
--
-- Verified before this migration:
--   anon select(*)                  -> 401 permission denied
--   anon select(id,display_name)    -> 200
-- ──────────────────────────────────────────────────────────

-- Signed-in users: all columns, still row-limited by RLS policy.
GRANT SELECT ON user_profiles TO authenticated;

-- Anonymous: unchanged from 011 — only the leaderboard-safe columns, and
-- explicitly NOT email, is_admin, is_premium, or invite_code.
REVOKE SELECT ON user_profiles FROM anon;
GRANT SELECT (id, display_name, avatar_url, last_active, created_at)
  ON user_profiles TO anon;

-- The two policies that gate rows for authenticated readers are unchanged and
-- still in force:
--   "Users read own profile"      USING (auth.uid() = id)
--   "Public read for leaderboard" USING (deleted_at IS NULL)
--
-- Note the second is permissive and ORs with the first, so an authenticated
-- user can read any non-deleted row. That is pre-existing behaviour, not
-- introduced here. It's worth tightening the leaderboard to a view exposing
-- only display columns, but that's a schema change beyond restoring the
-- regression, and doing it here would risk breaking the leaderboard while
-- admin is already down.
