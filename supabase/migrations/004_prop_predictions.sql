-- ══════════════════════════════════════════════════════════
-- NBA Prop Predictions Table — Closed-Loop Learning
-- Run in Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS prop_predictions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sport TEXT NOT NULL DEFAULT 'nba',
  game_id TEXT NOT NULL,
  game_date DATE NOT NULL,
  player_name TEXT NOT NULL,
  player_id INTEGER,
  team TEXT,
  prop_type TEXT NOT NULL,
  line NUMERIC NOT NULL,
  predicted_side TEXT NOT NULL,
  predicted_prob NUMERIC NOT NULL,
  actual_value NUMERIC,
  hit BOOLEAN,
  brier_score NUMERIC,
  odds_at_pick INTEGER,
  ev_edge NUMERIC,
  status TEXT DEFAULT 'pending',
  brain_version TEXT,
  factors JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  graded_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_prop_pred_game ON prop_predictions(game_date, status);
CREATE INDEX IF NOT EXISTS idx_prop_pred_player ON prop_predictions(player_name, prop_type);
CREATE INDEX IF NOT EXISTS idx_prop_pred_status ON prop_predictions(status);

ALTER TABLE prop_predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read props" ON prop_predictions FOR SELECT USING (true);
CREATE POLICY "Public write props" ON prop_predictions FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update props" ON prop_predictions FOR UPDATE USING (true);
