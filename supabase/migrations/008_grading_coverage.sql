-- ══════════════════════════════════════════════════════════
-- 008 — Unified Grading Coverage
--
-- Problems fixed:
--  1. prop_predictions has no way to represent a PUSH (hit is a plain
--     boolean), so any prop/NRFI/YRFI pick that lands exactly on the line
--     gets silently recorded as a loss when `hit: grade.result === "win"`
--     is written. Add a `result` text column that can hold
--     'win' | 'loss' | 'push' and backfill it from the existing
--     `hit` boolean for old rows (push information for those rows is lost
--     already, but new rows will be correct going forward).
--  2. daily_picks_log has no column marking which surface a pick came
--     from (bot slate vs board Locks/Longshots/EV vs prop vs NRFI). The
--     existing `category` column conflates "parlay/lock/longshot/prop"
--     with what is really a surface + market split. Add `pick_source` so
--     board-sourced picks can be logged distinctly from bot-sourced ones
--     without breaking the existing `category` semantics or any code that
--     reads it today (additive, nullable, defaulted).
-- ══════════════════════════════════════════════════════════

ALTER TABLE prop_predictions
  ADD COLUMN IF NOT EXISTS result TEXT; -- 'win' | 'loss' | 'push', nullable until graded

-- Backfill from the legacy boolean for rows graded before this migration.
-- (Pushes among historical rows are unrecoverable — they were already
-- coerced to `hit = false` at write time — but this at least makes the
-- column consistent for every row going forward.)
UPDATE prop_predictions
SET result = CASE WHEN hit IS TRUE THEN 'win' WHEN hit IS FALSE THEN 'loss' ELSE NULL END
WHERE result IS NULL AND status = 'graded';

CREATE INDEX IF NOT EXISTS idx_prop_pred_result ON prop_predictions(sport, result);

ALTER TABLE daily_picks_log
  ADD COLUMN IF NOT EXISTS pick_source TEXT DEFAULT 'bot'; -- 'bot' | 'board' | 'prop' | 'nrfi'

CREATE INDEX IF NOT EXISTS idx_picks_log_source ON daily_picks_log(pick_source, pick_date DESC);
