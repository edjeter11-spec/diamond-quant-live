import { NextResponse } from "next/server";
import { analyzeAllGames } from "@/lib/bot/three-models";
import { getCached, setCache } from "@/lib/odds/server-cache";
import { fetchMLBOdds, parseOddsLines, findBestLine } from "@/lib/odds/the-odds-api";
import { getApiKey } from "@/lib/odds/api-keys";
import { filterRealArbs, filterRealEV } from "@/lib/odds/sportsbooks";
import { fetchTodayGames, getGameStatus, getTeamAbbrev } from "@/lib/mlb/stats-api";

export const dynamic = "force-dynamic";

export async function GET() {
  const cached = getCached("bot_analysis", 600_000); // 10 min cache
  if (cached) return NextResponse.json(cached);

  try {
    // Fetch odds + scores directly (not via internal API calls)
    const apiKey = getApiKey();

    const [scoresRaw, oddsRaw] = await Promise.all([
      fetchTodayGames().catch(() => []),
      apiKey ? fetchMLBOdds(apiKey).catch(() => []) : Promise.resolve([]),
    ]);

    // Build scores
    const scores = scoresRaw.map((game: any) => ({
      id: String(game.gamePk),
      homeTeam: game.teams?.home?.team?.name ?? "",
      awayTeam: game.teams?.away?.team?.name ?? "",
      homeAbbrev: getTeamAbbrev(game.teams?.home?.team?.name ?? ""),
      awayAbbrev: getTeamAbbrev(game.teams?.away?.team?.name ?? ""),
      homeScore: game.teams?.home?.score ?? 0,
      awayScore: game.teams?.away?.score ?? 0,
      status: getGameStatus(game),
      homePitcher: game.teams?.home?.probablePitcher?.fullName ?? "TBD",
      awayPitcher: game.teams?.away?.probablePitcher?.fullName ?? "TBD",
    }));

    // Build odds - filter stale games
    const now = Date.now();
    const oddsGames = oddsRaw
      .filter((g: any) => new Date(g.commence_time).getTime() > now - 4 * 60 * 60 * 1000)
      .map((game: any) => {
        const oddsLines = parseOddsLines(game);
        const evBets = filterRealEV(
          // inline EV calc not needed for bot analysis, just pass odds
          []
        );
        return {
          id: game.id,
          homeTeam: game.home_team,
          awayTeam: game.away_team,
          commenceTime: game.commence_time,
          oddsLines,
          evBets: [],
          bestLines: {
            bestHomeML: findBestLine(oddsLines, "home", "ml"),
            bestAwayML: findBestLine(oddsLines, "away", "ml"),
            bestOver: findBestLine(oddsLines, "home", "total_over"),
            bestUnder: findBestLine(oddsLines, "home", "total_under"),
          },
        };
      });

    console.log(`[Bot Analysis] Odds games: ${oddsGames.length}, Scores: ${scores.length}`);
    const analyses = await analyzeAllGames(oddsGames, scores);
    console.log(`[Bot Analysis] Produced ${analyses.length} analyses`);

    const response = {
      analyses,
      timestamp: new Date().toISOString(),
      gamesAnalyzed: analyses.length,
      debug: { oddsGamesCount: oddsGames.length, scoresCount: scores.length },
      highConfidence: analyses.filter((a: any) => a.consensus.confidence === "HIGH").length,
      disagreements: analyses.filter((a: any) => !a.consensus.modelsAgree).length,
    };

    setCache("bot_analysis", response);
    return NextResponse.json(response);
  } catch (error: any) {
    console.error("Bot analysis error:", error);
    return NextResponse.json({ error: error.message, analyses: [] }, { status: 500 });
  }
}
