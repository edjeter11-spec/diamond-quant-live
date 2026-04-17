-- ══════════════════════════════════════════════════════════
-- Public Track Record — daily_picks_log
-- Logs each day's published picks (Parlay of the Day, Top Locks,
-- NBA brain picks) and grades them after games complete.
-- Feeds the /results page so users can verify hit rate.
-- ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS daily_picks_log (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sport           TEXT NOT NULL,                       -- 'mlb' | 'nba'
  pick_date       DATE NOT NULL,                       -- ET date
  category        TEXT NOT NULL,                       -- 'parlay' | 'lock' | 'longshot' | 'prop'
  pick_text       TEXT NOT NULL,                       -- "Yankees ML"
  game            TEXT,                                -- "Yankees @ Red Sox"
  market          TEXT,                                -- 'moneyline' | 'total' | etc.
  odds            INTEGER,                             -- American
  bookmaker       TEXT,
  ev_percentage   NUMERIC(5,2),
  fair_prob       NUMERIC(5,2),
  confidence      TEXT,
  -- Settlement
  result          TEXT DEFAULT 'pending',              -- 'win' | 'loss' | 'push' | 'void'
  settled_at      TIMESTAMPTZ,
  profit_units    NUMERIC(6,2),                        -- +1.00 / -1.00 / +1.91 etc.
  -- Source
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_picks_log_date     ON daily_picks_log(pick_date DESC);
CREATE INDEX IF NOT EXISTS idx_picks_log_status   ON daily_picks_log(result);
CREATE INDEX IF NOT EXISTS idx_picks_log_sport    ON daily_picks_log(sport, pick_date DESC);
CREATE INDEX IF NOT EXISTS idx_picks_log_category ON daily_picks_log(category, pick_date DESC);

ALTER TABLE daily_picks_log ENABLE ROW LEVEL SECURITY;
-- Public read — this is the verifiable track record
CREATE POLICY "Public read picks log" ON daily_picks_log FOR SELECT USING (true);
-- Writes restricted to service_role (cron only; bypasses RLS)

-- ══════════════════════════════════════════════════════════
-- User Profiles: premium fields (idempotent)
-- ══════════════════════════════════════════════════════════
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS subscription_status TEXT;
