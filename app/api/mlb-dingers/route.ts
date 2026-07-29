import { NextResponse } from "next/server";
import { getDailyDingers, attachOdds } from "@/lib/mlb/dingers";
import { getCached, setCache } from "@/lib/odds/server-cache";

export const revalidate = 1800; // 30 min — this route is compute-heavy (multi-call joins)
export const maxDuration = 60;

const CACHE_KEY = "mlb_dingers_v1";
const CACHE_TTL = 30 * 60 * 1000; // 30 min
const STALE_TTL = 3 * 60 * 60 * 1000; // serve up to 3h stale on hard failure

const CDN_CACHE = "public, s-maxage=1800, stale-while-revalidate=3600";

async function fetchOddsProps(origin: string) {
  try {
    const res = await fetch(
      `${origin}/api/players?market=batter_home_runs&sport=baseball_mlb`,
      { next: { revalidate: 600 }, signal: AbortSignal.timeout(10000) },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.props) ? data.props : [];
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  const cached = getCached(CACHE_KEY, CACHE_TTL);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { "Cache-Control": CDN_CACHE },
    });
  }

  try {
    const result = await getDailyDingers("mlb");

    // Pull real batter_home_runs odds from the already-integrated Odds API
    // route and match by player name for a bettable price + EV badge.
    const origin = new URL(req.url).origin;
    const props = await fetchOddsProps(origin);
    const withOdds = attachOdds(result.candidates, props);

    const response = { ...result, candidates: withOdds };
    setCache(CACHE_KEY, response);
    return NextResponse.json(response, {
      headers: { "Cache-Control": CDN_CACHE },
    });
  } catch (error) {
    console.error("Dingers API error:", error);
    const stale = getCached(CACHE_KEY, STALE_TTL);
    if (stale) return NextResponse.json(stale);
    return NextResponse.json({
      candidates: [],
      gamesAnalyzed: 0,
      generatedAt: new Date().toISOString(),
      message: "Dingers temporarily unavailable",
    });
  }
}
