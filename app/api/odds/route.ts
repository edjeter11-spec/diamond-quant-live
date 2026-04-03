import { NextResponse } from "next/server";
import { fetchMLBOdds, parseOddsLines, findBestLine } from "@/lib/odds/the-odds-api";
import { findArbitrage, findEVBets } from "@/lib/odds/arbitrage";
import { getApiKey, markKeyExhausted, getActiveKeyCount } from "@/lib/odds/api-keys";

export const revalidate = 30;

export async function GET() {
  const apiKey = getApiKey();

  if (!apiKey) {
    return NextResponse.json({
      games: [],
      timestamp: new Date().toISOString(),
      error: "No API keys configured",
    });
  }

  // Try with current key, fall back to next if exhausted
  for (let attempt = 0; attempt < 3; attempt++) {
    const key = getApiKey();
    if (!key) break;

    try {
      const rawGames = await fetchMLBOdds(key);

      // Check if we got real data (bookmakers present)
      const hasData = rawGames.some((g) => g.bookmakers.length > 0);
      if (!hasData && getActiveKeyCount() > 1) {
        markKeyExhausted(key);
        continue; // try next key
      }

      const games = rawGames.map((game) => {
        const oddsLines = parseOddsLines(game);
        const arbitrage = findArbitrage(oddsLines, `${game.away_team} @ ${game.home_team}`);
        const evBets = findEVBets(oddsLines, `${game.away_team} @ ${game.home_team}`);

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

      return NextResponse.json({
        games,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error(`Odds API error (key ${attempt + 1}):`, error.message);
      markKeyExhausted(key);
      // Try next key
    }
  }

  return NextResponse.json(
    { error: "All API keys exhausted", games: [] },
    { status: 503 }
  );
}
