-- ══════════════════════════════════════════════════════════
-- 010 — Published picks: grading + system-authored rows
--
-- The daily board (Parlay of the Day, pinned player props) is published to
-- Discord by the system, not by a human admin, so those rows have no
-- auth.users id. `created_by NOT NULL REFERENCES auth.users(id)` blocked
-- them entirely — the recap had nothing to grade against.
--
-- Also adds the prop fields the grader needs (player/line/side/market key)
-- and a slate date, so a day's published picks can be pulled as a set.
-- ══════════════════════════════════════════════════════════

-- Allow system-published rows. Admin-authored picks still carry a real user id.
ALTER TABLE manual_picks ALTER COLUMN created_by DROP NOT NULL;

-- Who published this: 'admin' (a person via /admin/picks) or 'system'
-- (the automated daily board). Recaps and track-record splits need to tell
-- them apart — mixing hand-made picks into an automated accuracy number
-- would misrepresent both.
ALTER TABLE manual_picks
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'admin';

-- Structured prop fields. pick_text stays the human-readable line; these are
-- what lib/mlb/prop-grader.ts actually grades against.
ALTER TABLE manual_picks
  ADD COLUMN IF NOT EXISTS player_name TEXT,
  ADD COLUMN IF NOT EXISTS market_key TEXT,   -- e.g. 'batter_hits'
  ADD COLUMN IF NOT EXISTS line NUMERIC,
  ADD COLUMN IF NOT EXISTS side TEXT,         -- 'over' | 'under'
  ADD COLUMN IF NOT EXISTS odds INTEGER,
  ADD COLUMN IF NOT EXISTS bookmaker TEXT,
  ADD COLUMN IF NOT EXISTS actual_value NUMERIC, -- what the player recorded
  -- ET slate date (YYYY-MM-DD). Grouping key for the daily recap; a
  -- timestamp alone would split a night game across two dates.
  ADD COLUMN IF NOT EXISTS slate_date TEXT;

-- Groups a day's published picks into one Discord post (parlay vs props), so
-- the recap can edit that exact message instead of posting a duplicate.
ALTER TABLE manual_picks
  ADD COLUMN IF NOT EXISTS batch_key TEXT;

CREATE INDEX IF NOT EXISTS idx_manual_picks_slate
  ON manual_picks(slate_date, sport, status);
CREATE INDEX IF NOT EXISTS idx_manual_picks_batch
  ON manual_picks(batch_key);
-- Ungraded published picks — the recap's working set.
CREATE INDEX IF NOT EXISTS idx_manual_picks_pending
  ON manual_picks(status, result) WHERE result IS NULL;
