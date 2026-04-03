import { NextResponse } from "next/server";
import { fetchPlayerProps, parsePlayerProps } from "@/lib/odds/the-odds-api";
import { devig } from "@/lib/model/kelly";
import { getApiKey } from "@/lib/odds/api-keys";
import { getCached, setCache, CACHE_TTL } from "@/lib/odds/server-cache";

// Increased revalidate — props don't change as fast as MLs
export const revalidate = 120;

const PROP_MARKETS = [
  "pitcher_strikeouts",
  "batter_hits",
  "batter_total_bases",
  "batter_home_runs",
  "batter_rbis",
  "batter_runs_scored",
  "batter_stolen_bases",
  "pitcher_outs",
];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const market = searchParams.get("market") || "pitcher_strikeouts";

  // Check server cache — keyed by market
  const cacheKey = `props_${market}`;
  const cached = getCached(cacheKey, CACHE_TTL.PROPS);
  if (cached) {
    return NextResponse.json(cached);
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return NextResponse.json({ props: [], markets: PROP_MARKETS, error: "No API keys available" });
  }

  try {
    // Reuse cached event list from /api/odds instead of fetching again
    const eventsCacheKey = "mlb_events";
    let todayGames = getCached(eventsCacheKey, CACHE_TTL.EVENTS);

    if (!todayGames) {
      // Only fetch events if not cached — this is 1 API call
      const { fetchMLBOdds } = await import("@/lib/odds/the-odds-api");
      const games = await fetchMLBOdds(apiKey);
      todayGames = games
        .filter((g) => {
          const gameTime = new Date(g.commence_time);
          const now = new Date();
          // Include games from 4hrs ago through next 24hrs
          return gameTime.getTime() - now.getTime() < 24 * 60 * 60 * 1000 &&
                 gameTime.getTime() > now.getTime() - 4 * 60 * 60 * 1000;
        })
        .slice(0, 4)
        .map((g) => ({ id: g.id, away_team: g.away_team, home_team: g.home_team }));
      setCache(eventsCacheKey, todayGames);
    }

    const allProps: any[] = [];
    // Fetch props — each game is 1 API call
    for (const game of todayGames) {
      try {
        const data = await fetchPlayerProps(apiKey, game.id, market);
        const props = parsePlayerProps(data);
        for (const prop of props) {
          prop.team = `${game.away_team} @ ${game.home_team}`;
        }
        allProps.push(...props);
      } catch {
        // Game may not have props for this market yet
      }
    }

    const grouped = groupByPlayer(allProps);

    const response = {
      props: grouped,
      markets: PROP_MARKETS,
      events: todayGames.map((g: any) => ({ id: g.id, game: `${g.away_team} @ ${g.home_team}` })),
      message: grouped.length === 0 ? "No props available yet for this market" : undefined,
    };

    setCache(cacheKey, response);
    return NextResponse.json(response);
  } catch (error) {
    console.error("Props API error:", error);
    // Return stale cache if available
    const stale = getCached(cacheKey, CACHE_TTL.PROPS * 5);
    if (stale) return NextResponse.json(stale);
    return NextResponse.json({ props: [], markets: PROP_MARKETS, error: "Failed to fetch props" });
  }
}

function groupByPlayer(props: ReturnType<typeof parsePlayerProps>) {
  const grouped = new Map<string, typeof props>();
  for (const prop of props) {
    const key = `${prop.playerName}-${prop.market}`;
    const existing = grouped.get(key) || [];
    existing.push(prop);
    grouped.set(key, existing);
  }

  return Array.from(grouped.entries()).map(([_key, lines]) => {
    const bestOver = lines.reduce((best, l) => l.overPrice > best.overPrice ? l : best, lines[0]);
    const bestUnder = lines.reduce((best, l) => l.underPrice > best.underPrice ? l : best, lines[0]);
    const { prob1: fairOverProb } = devig(bestOver.overPrice, bestUnder.underPrice);

    return {
      playerName: lines[0].playerName,
      line: lines[0].line,
      market: lines[0].market,
      team: lines[0].team,
      books: lines.map((l) => ({ bookmaker: l.bookmaker, overPrice: l.overPrice, underPrice: l.underPrice })),
      bestOver: { bookmaker: bestOver.bookmaker, price: bestOver.overPrice },
      bestUnder: { bookmaker: bestUnder.bookmaker, price: bestUnder.underPrice },
      fairOverProb: Math.round(fairOverProb * 10000) / 100,
      fairUnderProb: Math.round((1 - fairOverProb) * 10000) / 100,
    };
  });
}
