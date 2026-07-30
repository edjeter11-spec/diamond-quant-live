-- ══════════════════════════════════════════════════════════
-- 009 — Manual Picks (admin-authored, website → Discord)
--
-- New table backing the admin "Create Pick" flow: an admin writes a pick
-- on the website (bet, units, confidence, write-up), publishes it, and the
-- Discord bot posts/edits/retracts/grades the corresponding Discord message
-- using the stored message/channel id. Deliberately separate from
-- daily_picks_log/prop_predictions — those are model/cron-generated and
-- have no author, draft state, or Discord message linkage; this table is
-- human-authored and needs both.
-- ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS manual_picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES auth.users(id),

  sport TEXT NOT NULL, -- 'mlb' | 'nba' | 'nfl' | 'nhl'
  game TEXT,
  market TEXT,
  pick_text TEXT NOT NULL,
  units NUMERIC NOT NULL DEFAULT 1,
  confidence TEXT, -- free-text label, e.g. 'Lock', 'Lean', 'Longshot'
  writeup TEXT,

  status TEXT NOT NULL DEFAULT 'draft', -- 'draft' | 'published' | 'retracted'
  result TEXT, -- 'pending' | 'win' | 'loss' | 'push' | 'void', null until graded
  profit_units NUMERIC,

  discord_channel_id TEXT,
  discord_message_id TEXT,

  published_at TIMESTAMPTZ,
  retracted_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_manual_picks_status ON manual_picks(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_manual_picks_sport ON manual_picks(sport, status);
