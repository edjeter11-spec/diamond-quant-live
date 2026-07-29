import { NextResponse } from "next/server";
import { getCached } from "@/lib/odds/server-cache";
import { getApiKey, getActiveKeyCount, getKeyCount } from "@/lib/odds/api-keys";
import { cloudGet } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

export async function GET() {
  // Try in-memory cache first (instant), fall back to Supabase
  let usage = getCached("odds_api_usage", 3600_000) ?? null;
  if (!usage) {
    usage = await cloudGet<any>("odds_api_usage", null);
  }
  const hasKey = !!getApiKey();
  // Aggregate key-rotation state — the cached `remaining` above only reflects
  // the LAST key that made a real API call, which is misleading now that
  // rotation tries all 10 keys per request (a fresh key can read 499 right
  // after 5 others just got marked exhausted). activeKeys/totalKeys give a
  // true picture of overall quota health across the whole pool.
  const activeKeys = getActiveKeyCount();
  const totalKeys = getKeyCount();
  return NextResponse.json({
    hasKey,
    ...(usage ?? {}),
    activeKeys,
    totalKeys,
    quotaCritical: activeKeys <= 2,
  });
}
