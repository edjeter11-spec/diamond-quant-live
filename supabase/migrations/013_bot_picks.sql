-- ──────────────────────────────────────────────────────────
-- 013: SERVER-SIDE BOT CHALLENGE LEDGER
--
-- The moneyline bot's bankroll and pick history lived in localStorage, which
-- means there was never a track record — only a per-browser illusion of one.
-- Your phone and your laptop showed different bankrolls, clearing site data
-- reset it to $5,000, and no outcome was ever graded server-side. Nothing
-- could be measured because nothing was stored.
--
-- That matters more now: a walk-forward backtest over 2024 and 2025 put this
-- model at ~62% accuracy, +5.5% skill over an always-pick-home baseline, and
-- the effect strengthens with confidence (81% correct on its top band). Those
-- are backtest numbers. This table is what turns them into a real, forward
-- record — or disproves them honestly.
--
-- One row per pick, graded against final scores like manual_picks.
-- ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bot_picks (
  id TEXT PRIMARY KEY,                    -- e.g. smart-mlb-2026-08-03-0
  sport TEXT NOT NULL DEFAULT 'mlb',
  slate_date DATE NOT NULL,               -- ET sports day
  game_id TEXT,                           -- MLB gamePk, for settlement matching
  game TEXT NOT NULL,                     -- "Away @ Home"
  pick TEXT NOT NULL,                     -- "Team ML"
  market TEXT NOT NULL DEFAULT 'moneyline',
  odds INTEGER NOT NULL,
  bookmaker TEXT,
  stake NUMERIC(10,2) NOT NULL,

  -- What the model believed BEFORE the game. Stored so a later calibration
  -- change can be evaluated against what was actually predicted at the time,
  -- rather than silently rewriting history.
  model_prob NUMERIC(5,4) NOT NULL,       -- calibrated consensus, 0-1
  raw_prob NUMERIC(5,4),                  -- pre-calibration, for comparison
  ev_percentage NUMERIC(6,2),
  pitcher_score INTEGER,
  market_score INTEGER,
  trend_score INTEGER,
  confidence TEXT,

  result TEXT NOT NULL DEFAULT 'pending'
    CHECK (result IN ('pending','win','loss','push')),
  payout NUMERIC(10,2) NOT NULL DEFAULT 0,
  profit_units NUMERIC(10,2),
  final_score TEXT,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bot_picks_slate_idx ON bot_picks (sport, slate_date DESC);
CREATE INDEX IF NOT EXISTS bot_picks_pending_idx ON bot_picks (result) WHERE result = 'pending';

-- Public read: the whole point is a verifiable record. Writes are service-role
-- only (no INSERT/UPDATE/DELETE policy), so nobody can fabricate a winner or
-- quietly delete a loser — which is exactly the integrity property a track
-- record needs to mean anything.
ALTER TABLE bot_picks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read bot picks" ON bot_picks;
CREATE POLICY "Public read bot picks" ON bot_picks FOR SELECT USING (true);

GRANT SELECT ON bot_picks TO anon, authenticated;

-- APPLIED to production 2026-08-03 via the dashboard SQL editor. The live
-- table omits the CHECK constraint on `result` and the partial pending index
-- (the editor timed out on the full statement and a trimmed version ran);
-- both are additive and can be applied later without data migration.
