-- ══════════════════════════════════════════════════════════
-- 014: Make daily_picks_log's dedup key actually unique
--
-- logDailyPicks (lib/bot/track-record.ts) dedups by SELECTing today's rows
-- and skipping any pick already present. That is a read-then-write race with
-- nothing backing it: 005_track_record.sql created four indexes and NONE of
-- them is UNIQUE. Two overlapping cron invocations both read "not present"
-- and both insert.
--
-- The consequence isn't a cosmetic duplicate row — settlePendingPicks grades
-- each copy independently, and getTrackRecordStats sums profit_units across
-- all of them, so one real pick contributes its win twice to the PUBLIC
-- record on /results. No duplicates exist yet (verified via
-- scripts/check-dupe-picks.mts), so this can be added safely as-is.
--
-- (pick_date, sport, category, pick_text) is exactly the key logDailyPicks
-- already treats as the identity of a pick, so this makes the database
-- enforce the invariant the code was only hoping for.
-- ══════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS daily_picks_log_dedup_uidx
  ON daily_picks_log (pick_date, sport, category, pick_text);
