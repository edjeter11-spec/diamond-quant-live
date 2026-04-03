import { NextResponse } from "next/server";
import { fetchMLBOdds, parseOddsLines } from "@/lib/odds/the-odds-api";
import { findArbitrage, findEVBets } from "@/lib/odds/arbitrage";
import { getApiKey } from "@/lib/odds/api-keys";

export const revalidate = 30;

export async function GET() {
  const apiKey = getApiKey();

  if (!apiKey) {
    return NextResponse.json({ arbitrage: [], evBets: [], error: "No API keys available" });
  }

  try {
    const rawGames = await fetchMLBOdds(apiKey);
    const allArbs: any[] = [];
    const allEV: any[] = [];

    for (const game of rawGames) {
      const oddsLines = parseOddsLines(game);
      const gameName = `${game.away_team} @ ${game.home_team}`;
      allArbs.push(...findArbitrage(oddsLines, gameName));
      allEV.push(...findEVBets(oddsLines, gameName));
    }

    allArbs.sort((a, b) => a.holdPercentage - b.holdPercentage);
    allEV.sort((a, b) => b.evPercentage - a.evPercentage);

    return NextResponse.json({
      arbitrage: allArbs,
      evBets: allEV.slice(0, 20),
      gamesScanned: rawGames.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Arbitrage scan error:", error);
    return NextResponse.json({ error: "Scan failed", arbitrage: [], evBets: [] }, { status: 500 });
  }
}
