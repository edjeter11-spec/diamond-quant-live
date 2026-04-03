import { NextResponse } from "next/server";
import { fetchMLBOdds, parseOddsLines } from "@/lib/odds/the-odds-api";
import { findArbitrage, findEVBets } from "@/lib/odds/arbitrage";

export const revalidate = 30;

export async function GET() {
  const apiKey = process.env.THE_ODDS_API_KEY;

  if (!apiKey) {
    return NextResponse.json({
      arbitrage: [],
      evBets: [],
      message: "Configure THE_ODDS_API_KEY for live arbitrage scanning",
      demo: true,
    });
  }

  try {
    const rawGames = await fetchMLBOdds(apiKey);
    const allArbs: any[] = [];
    const allEV: any[] = [];

    for (const game of rawGames) {
      const oddsLines = parseOddsLines(game);
      const gameName = `${game.away_team} @ ${game.home_team}`;

      const arbs = findArbitrage(oddsLines, gameName);
      const evBets = findEVBets(oddsLines, gameName);

      allArbs.push(...arbs);
      allEV.push(...evBets);
    }

    // Sort: best arbs first, best EV first
    allArbs.sort((a, b) => a.holdPercentage - b.holdPercentage);
    allEV.sort((a, b) => b.evPercentage - a.evPercentage);

    return NextResponse.json({
      arbitrage: allArbs,
      evBets: allEV.slice(0, 20), // top 20 EV bets
      gamesScanned: rawGames.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Arbitrage scan error:", error);
    return NextResponse.json({ error: "Scan failed" }, { status: 500 });
  }
}
