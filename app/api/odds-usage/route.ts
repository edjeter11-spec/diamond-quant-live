import { NextResponse } from "next/server";
import { getCached } from "@/lib/odds/server-cache";
import { getApiKey } from "@/lib/odds/api-keys";

export const dynamic = "force-dynamic";

export async function GET() {
  const usage = getCached("odds_api_usage", 3600_000) ?? null;
  const hasKey = !!getApiKey();
  return NextResponse.json({ hasKey, ...usage });
}
