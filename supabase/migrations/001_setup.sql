-- Run this ONCE in your Supabase Dashboard → SQL Editor
-- This creates the storage table for Diamond-Quant Live

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Allow public read/write (since this is a personal app)
ALTER TABLE app_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read" ON app_state FOR SELECT USING (true);
CREATE POLICY "Allow public insert" ON app_state FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update" ON app_state FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow public delete" ON app_state FOR DELETE USING (true);
