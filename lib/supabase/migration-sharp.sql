-- ══════════════════════════════════════════════════════════
-- Diamond-Quant Live — Sharp Money Layer Migration
-- Run in Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════════════

-- ── odds_history: 5-min snapshots, auto-pruned to 60 min ──
CREATE TABLE IF NOT EXISTS odds_history (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sport          TEXT NOT NULL,
  game_id        TEXT NOT NULL,
  home_team      TEXT NOT NULL,
  away_team      TEXT NOT NULL,
  bookmaker      TEXT NOT NULL,
  market         TEXT NOT NULL,   -- 'moneyline' | 'spreads' | 'totals'
  home_price     INTEGER,         -- American odds
  away_price     INTEGER,
  spread         NUMERIC(5,1),    -- point spread (home)
  total          NUMERIC(5,1),    -- over/under line
  captured_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE odds_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read odds_history"   ON odds_history FOR SELECT USING (true);
CREATE POLICY "Public insert odds_history" ON odds_history FOR INSERT WITH CHECK (true);
CREATE POLICY "Public delete odds_history" ON odds_history FOR DELETE USING (true);

CREATE INDEX IF NOT EXISTS idx_odds_hist_game ON odds_history(game_id, bookmaker, market, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_odds_hist_sport ON odds_history(sport, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_odds_hist_time  ON odds_history(captured_at DESC);
