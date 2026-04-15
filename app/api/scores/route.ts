import { NextResponse } from "next/server";
import { fetchTodayGames, getGameStatus, getTeamAbbrev } from "@/lib/mlb/stats-api";

export const revalidate = 15;

export async function GET() {
  try {
    const games = await fetchTodayGames();

    const formatted = games.map((game) => ({
      id: String(game.gamePk),
      homeTeam: game.teams.home.team.name,
      homeAbbrev: getTeamAbbrev(game.teams.home.team.name),
      awayTeam: game.teams.away.team.name,
      awayAbbrev: getTeamAbbrev(game.teams.away.team.name),
      homeScore: game.teams.home.score ?? 0,
      awayScore: game.teams.away.score ?? 0,
      status: getGameStatus(game),
      inning: game.linescore?.currentInning ?? 0,
      inningHalf: game.linescore?.inningHalf?.toLowerCase() ?? "top",
      outs: game.linescore?.outs ?? 0,
      startTime: game.gameDate,
      venue: game.venue.name,
      homePitcher: game.teams.home.probablePitcher?.fullName ?? "TBD",
      awayPitcher: game.teams.away.probablePitcher?.fullName ?? "TBD",
      homePitcherId: game.teams.home.probablePitcher?.id ?? null,
      awayPitcherId: game.teams.away.probablePitcher?.id ?? null,
      weather: game.weather ?? null,
      detailedStatus: game.status.detailedState,
    }));

    return NextResponse.json({ games: formatted, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("Scores API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch scores", games: [] },
      { status: 500 }
    );
  }
}
