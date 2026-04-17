import { NextRequest, NextResponse } from "next/server";
import { getGameWeather } from "@/lib/mlb/weather-fatigue";
import { getCached, setCache } from "@/lib/odds/server-cache";

export const dynamic = "force-dynamic";

// Simple weather endpoint for the game-card badge.
// Caches per-team for 10 minutes (weather doesn't change that fast).
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const team = (searchParams.get("team") ?? "").toUpperCase();
  if (!team) return NextResponse.json({ ok: false, error: "team required" });

  const cacheKey = `weather_${team}`;
  const cached = getCached(cacheKey, 10 * 60 * 1000);
  if (cached) return NextResponse.json(cached);

  try {
    const report = await getGameWeather(team);
    const result = { ok: true, team, weather: report };
    if (report) setCache(cacheKey, result);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message ?? "weather lookup failed" });
  }
}
