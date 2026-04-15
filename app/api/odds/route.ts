import { NextResponse } from "next/server";
import { fetchOdds, parseOddsLines, findBestLine } from "@/lib/odds/the-odds-api";
import { findArbitrage, findEVBets } from "@/lib/odds/arbitrage";
import { getApiKey, markKeyExhausted, getActiveKeyCount } from "@/lib/odds/api-keys";
import { getCached, setCache, CACHE_TTL, stampEdge, getEdgeAge, cleanEdges } from "@/lib/odds/server-cache";
import { filterRealArbs, filterRealEV } from "@/lib/odds/sportsbooks";

export const revalidate = 60;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sport = searchParams.get("sport") || "baseball_mlb";
  const CACHE_KEY = `odds_${sport}`;

  const cached = getCached(CACHE_KEY, CACHE_TTL.ODDS);
  if (cached) {
    return NextResponse.json(cached);
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return NextResponse.json({ games: [], error: "No API keys configured" });
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const key = getApiKey();
    if (!key) break;

    try {
      const rawGames = await fetchOdds(key, sport);

      const hasData = rawGames.some((g) => g.bookmakers.length > 0);
      if (!hasData && getActiveKeyCount() > 1) {
        markKeyExhausted(key);
        continue;
      }

      // Filter: future games only + very recently started (30 min for live)
      const now = Date.now();
      const freshGames = rawGames.filter((g) => {
        const gameStart = new Date(g.commence_time).getTime();
        return gameStart > now - 30 * 60 * 1000; // only future + last 30 min
      });

      const games = freshGames.map((game) => {
        const oddsLines = parseOddsLines(game);
        // Arbitrage + EV computed here — no need for separate /api/arbitrage call
        const rawArbitrage = findArbitrage(oddsLines, `${game.away_team} @ ${game.home_team}`);
        const rawEvBets = findEVBets(oddsLines, `${game.away_team} @ ${game.home_team}`);
        // Filter out dead lines and suspicious edges
        const arbitrage = filterRealArbs(rawArbitrage);
        const evBets = filterRealEV(rawEvBets).map((bet: any) => {
          const edgeKey = `${game.id}-${bet.pick}-${bet.bookmaker}`;
          stampEdge(edgeKey);
          return { ...bet, edgeAge: getEdgeAge(edgeKey), firstSpotted: new Date(Date.now() - getEdgeAge(edgeKey) * 1000).toISOString() };
        });
        cleanEdges();

        return {
          id: game.id,
          homeTeam: game.home_team,
          awayTeam: game.away_team,
          commenceTime: game.commence_time,
          oddsLines,
          arbitrage,
          evBets,
          bestLines: {
            bestHomeML: findBestLine(oddsLines, "home", "ml"),
            bestAwayML: findBestLine(oddsLines, "away", "ml"),
            bestOver: findBestLine(oddsLines, "home", "total_over"),
            bestUnder: findBestLine(oddsLines, "home", "total_under"),
          },
        };
      });

      const response = { games, timestamp: new Date().toISOString() };
      setCache(CACHE_KEY, response);
      return NextResponse.json(response);
    } catch (error: any) {
      console.error(`Odds API error (attempt ${attempt + 1}):`, error.message);
      markKeyExhausted(key);
    }
  }

  // All keys failed — return cached if any (even stale)
  const stale = getCached(CACHE_KEY, CACHE_TTL.ODDS * 10);
  if (stale) return NextResponse.json({ ...stale, stale: true });

  return NextResponse.json({ error: "All API keys exhausted", games: [] }, { status: 503 });
}
