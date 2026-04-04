// ──────────────────────────────────────────────────────────
// Supabase Client + Cloud Sync Layer
// Syncs brain, bets, picks, bankroll to the cloud
// Falls back to localStorage if Supabase is unavailable
// ──────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

// Key-value store using a single "app_state" table
// This avoids needing to create complex table schemas
// Each key stores a JSON blob

const TABLE = "app_state";

// ── Read from cloud (fall back to localStorage) ──

export async function cloudGet<T>(key: string, fallback: T): Promise<T> {
  // Try Supabase first
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from(TABLE)
        .select("value")
        .eq("key", key)
        .single();

      if (data && !error) {
        return data.value as T;
      }
    } catch {}
  }

  // Fall back to localStorage
  if (typeof window === "undefined") return fallback;
  try {
    const stored = localStorage.getItem(`dq_${key}`);
    if (stored) return JSON.parse(stored);
  } catch {}

  return fallback;
}

// ── Write to cloud + localStorage ──

export async function cloudSet(key: string, value: any): Promise<void> {
  // Always write to localStorage as backup
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(`dq_${key}`, JSON.stringify(value));
    } catch {}
  }

  // Write to Supabase
  if (supabase) {
    try {
      const { error } = await supabase
        .from(TABLE)
        .upsert(
          { key, value, updated_at: new Date().toISOString() },
          { onConflict: "key" }
        );

      if (error) {
        // Table might not exist yet — try to create it
        if (error.code === "42P01" || error.message?.includes("does not exist")) {
          await createTable();
          // Retry
          await supabase
            .from(TABLE)
            .upsert(
              { key, value, updated_at: new Date().toISOString() },
              { onConflict: "key" }
            );
        }
      }
    } catch {}
  }
}

// ── Create the table if it doesn't exist ──

async function createTable() {
  if (!supabase) return;
  // We can't create tables via the REST API directly
  // The user needs to create it via the Supabase dashboard
  console.warn(
    "[DQ] Supabase table 'app_state' not found. " +
    "Please go to your Supabase dashboard → SQL Editor and run:\n" +
    "CREATE TABLE app_state (key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMPTZ DEFAULT NOW());\n" +
    "ALTER TABLE app_state ENABLE ROW LEVEL SECURITY;\n" +
    "CREATE POLICY \"Allow all\" ON app_state FOR ALL USING (true) WITH CHECK (true);"
  );
}

// ── Check if Supabase is connected ──

export async function isCloudConnected(): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await supabase.from(TABLE).select("key").limit(1);
    return !error;
  } catch {
    return false;
  }
}
