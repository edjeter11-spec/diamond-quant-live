import { NextResponse } from "next/server";
import { fetchMLBOdds, parseOddsLines, findBestLine } from "@/lib/odds/the-odds-api";
import { findArbitrage, findEVBets } from "@/lib/odds/arbitrage";

export const revalidate = 30;

export async function GET() {
  const apiKey = process.env.THE_ODDS_API_KEY;

  if (!apiKey) {
    return NextResponse.json({
      games: [],
      timestamp: new Date().toISOString(),
      demo: false,
      error: "API key not configured",
    });
  }

  try {
    const rawGames = await fetchMLBOdds(apiKey);

    const games = rawGames.map((game) => {
      const oddsLines = parseOddsLines(game);
      const arbitrage = findArbitrage(oddsLines, `${game.away_team} @ ${game.home_team}`);
      const evBets = findEVBets(oddsLines, `${game.away_team} @ ${game.home_team}`);

      const bestHomeML = findBestLine(oddsLines, "home", "ml");
      const bestAwayML = findBestLine(oddsLines, "away", "ml");
      const bestOver = findBestLine(oddsLines, "home", "total_over");
      const bestUnder = findBestLine(oddsLines, "home", "total_under");

      return {
        id: game.id,
        homeTeam: game.home_team,
        awayTeam: game.away_team,
        commenceTime: game.commence_time,
        oddsLines,
        arbitrage,
        evBets,
        bestLines: { bestHomeML, bestAwayML, bestOver, bestUnder },
      };
    });

    return NextResponse.json({
      games,
      timestamp: new Date().toISOString(),
      demo: false,
    });
  } catch (error) {
    console.error("Odds API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch odds", games: [], demo: false },
      { status: 500 }
    );
  }
}

