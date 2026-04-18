import { NextResponse } from "next/server";
import { fetchTodayGames, fetchGamesForDate, getGameStatus, getTeamAbbrev } from "@/lib/mlb/stats-api";

export const revalidate = 15;

function isoDateOffset(daysAhead: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d.toISOString().split("T")[0];
}

export async function GET() {
  try {
    let games = await fetchTodayGames();

    const STALE_MS = 5 * 60 * 60 * 1000; // drop finals + ghost-live games >5h past first pitch
    const now = Date.now();
    const format = (game: any) => ({
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
    });
    const keep = (g: any) => {
      const startMs = new Date(g.startTime).getTime();
      if (!Number.isFinite(startMs)) return true;
      const aged = now - startMs > STALE_MS;
      if (g.status === "final" && aged) return false;
      if (g.status === "live" && aged && (g.inning ?? 0) <= 1
          && (g.homeScore ?? 0) + (g.awayScore ?? 0) === 0) return false;
      return true;
    };

    let formatted = games.map(format).filter(keep);

    // Look ahead up to 3 days when today has no non-final games
    const hasUpcoming = formatted.some((g: any) => g.status !== "final");
    if (!hasUpcoming) {
      for (let i = 1; i <= 3; i++) {
        const next = await fetchGamesForDate(isoDateOffset(i));
        const nextFormatted = next.map(format).filter(keep);
        if (nextFormatted.length > 0) {
          formatted = [...formatted, ...nextFormatted];
          break;
        }
      }
    }

    return NextResponse.json({ games: formatted, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("Scores API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch scores", games: [] },
      { status: 500 }
    );
  }
}
