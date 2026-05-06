import { NextResponse } from "next/server";
import { getCached } from "@/lib/odds/server-cache";
import { getApiKey } from "@/lib/odds/api-keys";
import { cloudGet } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

export async function GET() {
  // Try in-memory cache first (instant), fall back to Supabase
  let usage = getCached("odds_api_usage", 3600_000) ?? null;
  if (!usage) {
    usage = await cloudGet<any>("odds_api_usage", null);
  }
  const hasKey = !!getApiKey();
  return NextResponse.json({ hasKey, ...(usage ?? {}) });
}
