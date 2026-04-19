-- ──────────────────────────────────────────────────────────
-- 007 — Web Push Subscriptions
-- Stores VAPID push subscriptions per user (one row per device).
-- Populated by /api/push/subscribe, read by the cron sender.
-- ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_notified_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_push_sub_user ON push_subscriptions(user_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can read/delete their own subscriptions
CREATE POLICY "Users read own subs" ON push_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users insert own subs" ON push_subscriptions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own subs" ON push_subscriptions
  FOR DELETE USING (auth.uid() = user_id);
