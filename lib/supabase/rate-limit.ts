// ──────────────────────────────────────────────────────────
// Per-User Rate Limiting
// Tracks API calls per user per day
// Protects the paid Odds API key from abuse
// ──────────────────────────────────────────────────────────

import { supabase } from "./client";

const DAILY_LIMIT = 500; // max API-triggering requests per user per day
const GUEST_LIMIT = 100; // guests get fewer calls

// In-memory cache to avoid hitting Supabase on every request
const cache: Record<string, { count: number; expires: number }> = {};

export async function checkRateLimit(userId: string | null): Promise<{ allowed: boolean; remaining: number }> {
  const key = userId ?? "guest";
  const limit = userId ? DAILY_LIMIT : GUEST_LIMIT;
  const now = Date.now();

  // Check cache first
  if (cache[key] && cache[key].expires > now) {
    if (cache[key].count >= limit) return { allowed: false, remaining: 0 };
    cache[key].count++;
    return { allowed: true, remaining: limit - cache[key].count };
  }

  // Initialize cache entry (expires at midnight ET)
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  cache[key] = { count: 1, expires: midnight.getTime() };

  // If logged in, persist to Supabase
  if (supabase && userId) {
    try {
      const today = new Date().toISOString().split("T")[0];
      const { data } = await supabase
        .from("rate_limits")
        .select("api_calls")
        .eq("user_id", userId)
        .eq("date", today)
        .single();

      if (data) {
        cache[key].count = data.api_calls + 1;
        await supabase.from("rate_limits").update({
          api_calls: cache[key].count,
          updated_at: new Date().toISOString(),
        }).eq("user_id", userId).eq("date", today);
      } else {
        await supabase.from("rate_limits").insert({
          user_id: userId,
          date: today,
          api_calls: 1,
        });
      }

      if (cache[key].count >= limit) return { allowed: false, remaining: 0 };
    } catch {}
  }

  return { allowed: true, remaining: limit - cache[key].count };
}

// Get headers from the Supabase auth token in request
export function getUserIdFromRequest(req: Request): string | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;
  // Token is in format "Bearer <jwt>" — we'd need to decode it
  // For now, return null (server routes don't need per-user tracking yet)
  return null;
}
