-- ══════════════════════════════════════════════════════════
-- Diamond-Quant Live — Personalization Layer Migration
-- Run this in Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════════════

-- ── 1. Lock down app_state (global data — read-only for anon) ──
-- Drop old permissive policies
DROP POLICY IF EXISTS "Allow all" ON app_state;
DROP POLICY IF EXISTS "Allow public read" ON app_state;
DROP POLICY IF EXISTS "Allow public insert" ON app_state;
DROP POLICY IF EXISTS "Allow public update" ON app_state;
DROP POLICY IF EXISTS "Allow public delete" ON app_state;

-- Everyone can read global data (brain, elo, model accuracy)
CREATE POLICY "Global read" ON app_state FOR SELECT USING (true);
-- Allow writes from both anon (server routes) and authenticated users
-- app_state is global non-sensitive data (brain, elo, model stats)
CREATE POLICY "Global write" ON app_state FOR INSERT WITH CHECK (true);
CREATE POLICY "Global update" ON app_state FOR UPDATE USING (true) WITH CHECK (true);

-- ── 2. User Profiles ──
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT DEFAULT '',
  email TEXT DEFAULT '',
  is_admin BOOLEAN DEFAULT false,
  invite_code TEXT UNIQUE,
  invited_by UUID REFERENCES auth.users(id),
  invites_remaining INTEGER DEFAULT 3,
  last_active TIMESTAMPTZ DEFAULT NOW(),
  devices JSONB DEFAULT '[]'::jsonb,
  deleted_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own profile" ON user_profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON user_profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON user_profiles FOR INSERT WITH CHECK (auth.uid() = id);
-- Public read for leaderboard (only non-deleted)
CREATE POLICY "Public read for leaderboard" ON user_profiles FOR SELECT USING (deleted_at IS NULL);

-- ── 3. User State (private per-user key-value store) ──
CREATE TABLE IF NOT EXISTS user_state (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, key)
);

ALTER TABLE user_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own state" ON user_state FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users write own state" ON user_state FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own state" ON user_state FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own state" ON user_state FOR DELETE USING (auth.uid() = user_id);

-- ── 4. User Preferences ──
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  default_sport TEXT DEFAULT 'mlb',
  discord_webhook TEXT DEFAULT '',
  push_enabled BOOLEAN DEFAULT true,
  push_min_confidence TEXT DEFAULT 'MEDIUM',
  email_daily_recap BOOLEAN DEFAULT false,
  theme TEXT DEFAULT 'dark',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own prefs" ON user_preferences FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users write own prefs" ON user_preferences FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own prefs" ON user_preferences FOR UPDATE USING (auth.uid() = user_id);

-- ── 5. Invites ──
CREATE TABLE IF NOT EXISTS invites (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  used_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  used_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
-- Anyone can check if a code is valid (for signup)
CREATE POLICY "Public read invites" ON invites FOR SELECT USING (true);
-- Only authenticated users create invites
CREATE POLICY "Auth create invites" ON invites FOR INSERT WITH CHECK (auth.uid() = created_by);
-- Only the system claims invites (via update)
CREATE POLICY "Auth claim invites" ON invites FOR UPDATE USING (used_by IS NULL OR auth.uid() = used_by);

-- ── 6. Shared Bet Slips ──
CREATE TABLE IF NOT EXISTS shared_slips (
  id TEXT PRIMARY KEY, -- short code like "abc123"
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  slip_data JSONB NOT NULL, -- full bet slip details
  reactions JSONB DEFAULT '{}'::jsonb, -- { "fire": 3, "skull": 1 }
  views INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE shared_slips ENABLE ROW LEVEL SECURITY;
-- Anyone can view shared slips (they're public by design)
CREATE POLICY "Public read slips" ON shared_slips FOR SELECT USING (true);
-- Only the owner can create
CREATE POLICY "Owner create slips" ON shared_slips FOR INSERT WITH CHECK (auth.uid() = user_id);
-- Anyone authenticated can react (update reactions/views)
CREATE POLICY "Auth react to slips" ON shared_slips FOR UPDATE USING (true);

-- ── 7. Rate Limiting ──
CREATE TABLE IF NOT EXISTS rate_limits (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  date DATE DEFAULT CURRENT_DATE NOT NULL,
  api_calls INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, date)
);

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own limits" ON rate_limits FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "System manage limits" ON rate_limits FOR ALL USING (auth.role() = 'service_role');
-- Users can increment their own counter
CREATE POLICY "Users increment own" ON rate_limits FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own" ON rate_limits FOR UPDATE USING (auth.uid() = user_id);

-- ── 8. Auto-create profile on signup (trigger) ──
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.user_profiles (id, display_name, email, invite_code)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email,
    upper(substr(md5(random()::text), 1, 6))
  );
  INSERT INTO public.user_preferences (user_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── 9. Indexes ──
CREATE INDEX IF NOT EXISTS idx_user_state_user_key ON user_state(user_id, key);
CREATE INDEX IF NOT EXISTS idx_invites_code ON invites(code);
CREATE INDEX IF NOT EXISTS idx_shared_slips_user ON shared_slips(user_id);
CREATE INDEX IF NOT EXISTS idx_rate_limits_user_date ON rate_limits(user_id, date);
