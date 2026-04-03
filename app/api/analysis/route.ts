import { NextResponse } from "next/server";
import { fetchTodayGames, getGameStatus, getTeamAbbrev } from "@/lib/mlb/stats-api";
import { buildTeamStats, buildGameState } from "@/lib/mlb/team-ratings";
import { calculateLiveEdge, generateReasoning } from "@/lib/model/engine";

export const revalidate = 60;

// Team ID lookup for MLB Stats API
const TEAM_IDS: Record<string, number> = {
  "Arizona Diamondbacks": 109, "Atlanta Braves": 144, "Baltimore Orioles": 110,
  "Boston Red Sox": 111, "Chicago Cubs": 112, "Chicago White Sox": 145,
  "Cincinnati Reds": 113, "Cleveland Guardians": 114, "Colorado Rockies": 115,
  "Detroit Tigers": 116, "Houston Astros": 117, "Kansas City Royals": 118,
  "Los Angeles Angels": 108, "Los Angeles Dodgers": 119, "Miami Marlins": 146,
  "Milwaukee Brewers": 158, "Minnesota Twins": 142, "New York Mets": 121,
  "New York Yankees": 147, "Athletics": 133, "Oakland Athletics": 133,
  "Philadelphia Phillies": 143, "Pittsburgh Pirates": 134, "San Diego Padres": 135,
  "San Francisco Giants": 137, "Seattle Mariners": 136, "St. Louis Cardinals": 138,
  "Tampa Bay Rays": 139, "Texas Rangers": 140, "Toronto Blue Jays": 141,
  "Washington Nationals": 120,
};

export async function GET() {
  try {
    const games = await fetchTodayGames();

    const analyses = await Promise.all(
      games.slice(0, 8).map(async (game) => {
        const homeName = game.teams.home.team.name;
        const awayName = game.teams.away.team.name;
        const homeId = TEAM_IDS[homeName];
        const awayId = TEAM_IDS[awayName];

        // Build team stats from real MLB data
        const [homeStats, awayStats] = await Promise.all([
          buildTeamStats(homeName, homeId),
          buildTeamStats(awayName, awayId),
        ]);

        // Build game state
        const gameState = buildGameState(
          {
            inning: game.linescore?.currentInning ?? 0,
            inningHalf: game.linescore?.inningHalf ?? "top",
            outs: game.linescore?.outs ?? 0,
            homeScore: game.teams.home.score ?? 0,
            awayScore: game.teams.away.score ?? 0,
            status: getGameStatus(game),
          },
          game.teams.home.probablePitcher?.fullName ?? "TBD",
          game.teams.away.probablePitcher?.fullName ?? "TBD"
        );

        // Run the quant engine
        const homeWinProb = calculateLiveEdge(homeStats, awayStats, gameState);
        const reasoning = generateReasoning(homeStats, awayStats, gameState);

        return {
          gameId: String(game.gamePk),
          homeTeam: homeName,
          awayTeam: awayName,
          homeAbbrev: getTeamAbbrev(homeName),
          awayAbbrev: getTeamAbbrev(awayName),
          homeWinProb: Math.round(homeWinProb * 1000) / 10,
          awayWinProb: Math.round((1 - homeWinProb) * 1000) / 10,
          homeStats: {
            pitching: homeStats.pitching,
            hitting: homeStats.hitting,
            bullpen: homeStats.bullpen,
            defense: homeStats.defense,
          },
          awayStats: {
            pitching: awayStats.pitching,
            hitting: awayStats.hitting,
            bullpen: awayStats.bullpen,
            defense: awayStats.defense,
          },
          reasoning,
          status: getGameStatus(game),
        };
      })
    );

    return NextResponse.json({
      analyses,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Analysis API error:", error);
    return NextResponse.json({ error: "Analysis failed", analyses: [] }, { status: 500 });
  }
}
