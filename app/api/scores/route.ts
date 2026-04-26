import { NextResponse } from "next/server";
import { fetchTodayGames, fetchGamesForDate, getGameStatus, getTeamAbbrev } from "@/lib/mlb/stats-api";

export const revalidate = 15;

function isoDateOffset(daysAhead: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d.toISOString().split("T")[0];
}

function yyyymmdd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

async function fetchNbaScoreboard(date: string): Promise<any[]> {
  try {
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${date}`,
      { next: { revalidate: 60 } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.events ?? [];
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sport = (searchParams.get("sport") || "baseball_mlb").toLowerCase();

  try {
    if (sport === "nba" || sport === "basketball_nba") {
      return getNbaScores();
    }
    return getMlbScores();
  } catch (error) {
    console.error("Scores API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch scores", games: [] },
      { status: 500 }
    );
  }
}

async function getMlbScores() {
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

    return NextResponse.json(
      { games: formatted, timestamp: new Date().toISOString() },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=300" } },
    );
  } catch (error) {
    console.error("MLB Scores API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch scores", games: [] },
      { status: 500 }
    );
  }
}

async function getNbaScores() {
  const STALE_MS = 5 * 60 * 60 * 1000;
  const now = Date.now();

  const formatEvent = (event: any) => {
    const comp = event.competitions?.[0];
    if (!comp) return null;
    const home = comp.competitors?.find((c: any) => c.homeAway === "home");
    const away = comp.competitors?.find((c: any) => c.homeAway === "away");
    if (!home || !away) return null;

    const homeTeam = home.team?.name ?? "";
    const awayTeam = away.team?.name ?? "";
    const status = comp.status?.type?.name ?? "scheduled";
    const statusLower = status.toLowerCase();
    const startMs = new Date(comp.startDate).getTime();

    return {
      id: event.id,
      homeTeam,
      homeAbbrev: (home.team?.abbreviation ?? "").toUpperCase(),
      awayTeam,
      awayAbbrev: (away.team?.abbreviation ?? "").toUpperCase(),
      homeScore: parseInt(home.score ?? "0"),
      awayScore: parseInt(away.score ?? "0"),
      status: statusLower === "in" ? "live" : statusLower === "final" ? "final" : "pre",
      inning: 0,
      inningHalf: "top",
      outs: 0,
      startTime: comp.startDate,
      venue: comp.venue?.fullName ?? "TBD",
      homePitcher: home.probables?.[0]?.fullName ?? "TBD",
      awayPitcher: away.probables?.[0]?.fullName ?? "TBD",
      homePitcherId: home.probables?.[0]?.id ?? null,
      awayPitcherId: away.probables?.[0]?.id ?? null,
      weather: null,
      detailedStatus: comp.status?.displayValue ?? status,
    };
  };

  let games: any[] = [];
  const todayEvents = await fetchNbaScoreboard(yyyymmdd(new Date()));
  games = todayEvents.map(formatEvent).filter((g: any) => {
    if (!g) return false;
    const startMs = new Date(g.startTime).getTime();
    if (!Number.isFinite(startMs)) return true;
    const aged = now - startMs > STALE_MS;
    if (g.status === "final" && aged) return false;
    return true;
  });

  // Look ahead up to 3 days when today has no non-final games
  const hasUpcoming = games.some((g: any) => g.status !== "final");
  if (!hasUpcoming) {
    for (let i = 1; i <= 3; i++) {
      const nextDate = new Date();
      nextDate.setUTCDate(nextDate.getUTCDate() + i);
      const nextEvents = await fetchNbaScoreboard(yyyymmdd(nextDate));
      const nextGames = nextEvents.map(formatEvent).filter((g: any) => {
        if (!g) return false;
        const startMs = new Date(g.startTime).getTime();
        if (!Number.isFinite(startMs)) return true;
        const aged = now - startMs > STALE_MS;
        if (g.status === "final" && aged) return false;
        return true;
      });
      if (nextGames.length > 0) {
        games = [...games, ...nextGames];
        break;
      }
    }
  }

  return NextResponse.json(
    { games, timestamp: new Date().toISOString() },
    { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=300" } },
  );
}
