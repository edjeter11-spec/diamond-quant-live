// ──────────────────────────────────────────────────────────
// User-Scoped Cloud Sync Layer
// Private data (bankroll, bets, parlays, bot state) per user
// Falls back to localStorage for guests
// ──────────────────────────────────────────────────────────

import { supabase } from "./client";

// Keys that are USER-PRIVATE (stored in user_state table)
const PRIVATE_KEYS = new Set([
  "bankroll", "betHistory", "savedParlays",
  "smart_bot", "smart_bot_nba",
  "user_clv_mlb", "user_clv_nba",
]);

// Keys that are GLOBAL (stored in app_state table)
const GLOBAL_KEYS = new Set([
  "brain", "brain_nba", "elo_mlb", "elo_nba",
  "model_accuracy", "clv_mlb", "clv_nba",
]);

// ── Get current user ID from Supabase session ──
async function getCurrentUserId(): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}

// ── Read user-private data ──
export async function userGet<T>(key: string, fallback: T): Promise<T> {
  const userId = await getCurrentUserId();

  // If logged in, read from user_state
  if (supabase && userId) {
    try {
      const { data, error } = await supabase
        .from("user_state")
        .select("value")
        .eq("user_id", userId)
        .eq("key", key)
        .single();
      if (data && !error) return data.value as T;
    } catch {}
  }

  // Fall back to localStorage (guests or offline)
  if (typeof window === "undefined") return fallback;
  try {
    const stored = localStorage.getItem(`dq_${key}`);
    if (stored) return JSON.parse(stored);
  } catch {}

  return fallback;
}

// ── Write user-private data ──
// Throttle map to prevent spam
const userSyncThrottle: Record<string, number> = {};

export async function userSet(key: string, value: any): Promise<void> {
  // Always write to localStorage as cache
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(`dq_${key}`, JSON.stringify(value));
    } catch {}
  }

  // Throttle cloud writes (1 per key per 30s)
  const now = Date.now();
  if (userSyncThrottle[key] && now - userSyncThrottle[key] < 30000) return;
  userSyncThrottle[key] = now;

  const userId = await getCurrentUserId();
  if (!supabase || !userId) return;

  try {
    await supabase.from("user_state").upsert(
      { user_id: userId, key, value, updated_at: new Date().toISOString() },
      { onConflict: "user_id,key" }
    );
  } catch {}
}

// ── Bulk read all user state (for hydration on login) ──
export async function userGetAll(): Promise<Record<string, any>> {
  const userId = await getCurrentUserId();
  if (!supabase || !userId) return {};

  try {
    const { data } = await supabase
      .from("user_state")
      .select("key, value")
      .eq("user_id", userId);

    const result: Record<string, any> = {};
    for (const row of data ?? []) {
      result[row.key] = row.value;
    }
    return result;
  } catch {
    return {};
  }
}

// ── Migrate localStorage data to user_state on first login ──
export async function migrateLocalToUser(): Promise<{ migrated: string[]; skipped: string[] }> {
  const userId = await getCurrentUserId();
  if (!supabase || !userId) return { migrated: [], skipped: [] };

  const migrated: string[] = [];
  const skipped: string[] = [];

  for (const key of PRIVATE_KEYS) {
    try {
      const localData = localStorage.getItem(`dq_${key}`);
      if (!localData) { skipped.push(key); continue; }

      // Check if user already has this key in cloud
      const { data: existing } = await supabase
        .from("user_state")
        .select("key")
        .eq("user_id", userId)
        .eq("key", key)
        .single();

      if (existing) { skipped.push(key); continue; }

      // Migrate
      const value = JSON.parse(localData);
      await supabase.from("user_state").insert({
        user_id: userId,
        key,
        value,
        updated_at: new Date().toISOString(),
      });
      migrated.push(key);
    } catch {
      skipped.push(key);
    }
  }

  return { migrated, skipped };
}

// ── Smart router: picks the right sync function based on key ──
export function isPrivateKey(key: string): boolean {
  return PRIVATE_KEYS.has(key);
}

export function isGlobalKey(key: string): boolean {
  return GLOBAL_KEYS.has(key);
}

// ── Check if user is logged in (synchronous check from cached session) ──
export function isLoggedIn(): boolean {
  if (typeof window === "undefined") return false;
  // Check for Supabase auth token in localStorage
  const keys = Object.keys(localStorage);
  return keys.some(k => k.startsWith("sb-") && k.endsWith("-auth-token"));
}
