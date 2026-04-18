import { NextResponse } from "next/server";
import { getNBATeamAbbrev } from "@/lib/nba/stats-api";

// Home arena for each NBA team abbreviation
const NBA_ARENAS: Record<string, string> = {
  ATL: "State Farm Arena", BOS: "TD Garden", BKN: "Barclays Center",
  CHA: "Spectrum Center", CHI: "United Center", CLE: "Rocket Mortgage FieldHouse",
  DAL: "American Airlines Center", DEN: "Ball Arena", DET: "Little Caesars Arena",
  GSW: "Chase Center", HOU: "Toyota Center", IND: "Gainbridge Fieldhouse",
  LAC: "Crypto.com Arena", LAL: "Crypto.com Arena", MEM: "FedExForum",
  MIA: "Kaseya Center", MIL: "Fiserv Forum", MIN: "Target Center",
  NOP: "Smoothie King Center", NYK: "Madison Square Garden", OKC: "Paycom Center",
  ORL: "Amway Center", PHI: "Wells Fargo Center", PHX: "Footprint Center",
  POR: "Moda Center", SAC: "Golden 1 Center", SAS: "Frost Bank Center",
  TOR: "Scotiabank Arena", UTA: "Delta Center", WAS: "Capital One Arena",
};

export const revalidate = 30;

function mapStatus(name: string): "pre" | "live" | "final" {
  if (name === "STATUS_FINAL") return "final";
  if (name === "STATUS_IN_PROGRESS" || name === "STATUS_HALFTIME") return "live";
  return "pre";
}

function getPeriodLabel(period: number): string {
  if (period <= 0) return "";
  if (period <= 4) return `Q${period}`;
  if (period === 5) return "OT";
  return `${period - 4}OT`;
}

function mapEvent(event: any) {
  const competition = event.competitions?.[0] ?? {};
  const statusType = competition.status?.type ?? {};
  const statusName: string = statusType.name ?? "";
  const status = mapStatus(statusName);
  const period: number = competition.status?.period ?? 0;
  const timeRemaining: string = competition.status?.displayClock ?? "";
  const home = (competition.competitors ?? []).find((c: any) => c.homeAway === "home") ?? {};
  const away = (competition.competitors ?? []).find((c: any) => c.homeAway === "away") ?? {};
  const homeAbbrev: string = home.team?.abbreviation ?? getNBATeamAbbrev(home.team?.displayName ?? "");
  const awayAbbrev: string = away.team?.abbreviation ?? getNBATeamAbbrev(away.team?.displayName ?? "");
  const periodLabel = getPeriodLabel(period);
  const venue = competition.venue?.fullName ?? NBA_ARENAS[homeAbbrev] ?? "";
  const detailedStatus =
    status === "final" ? "Final" :
    status === "live" ? `${periodLabel} ${timeRemaining}`.trim() :
    statusType.shortDetail ?? "";

  return {
    id: event.id ?? "",
    homeTeam: home.team?.displayName ?? "",
    awayTeam: away.team?.displayName ?? "",
    homeAbbrev, awayAbbrev,
    homeScore: Number(home.score ?? 0),
    awayScore: Number(away.score ?? 0),
    status, period, periodLabel, timeRemaining,
    inning: period, inningHalf: "top", outs: 0,
    startTime: event.date ?? new Date().toISOString(),
    venue, homePitcher: "", awayPitcher: "",
    weather: null, detailedStatus, isNBA: true,
  };
}

// Drop yesterday's finals + ghost-stuck "live" entries
function isActive(g: ReturnType<typeof mapEvent>, now: number, staleMs: number): boolean {
  const startMs = new Date(g.startTime).getTime();
  if (g.status === "final") {
    if (Number.isFinite(startMs) && now - startMs > staleMs) return false;
  }
  if (g.status === "live") {
    if (Number.isFinite(startMs) && now - startMs > staleMs
        && (g.period ?? 0) <= 1 && (g.homeScore ?? 0) + (g.awayScore ?? 0) === 0) {
      return false;
    }
  }
  return true;
}

async function fetchScoreboardForDate(yyyymmdd?: string): Promise<any[]> {
  const url = yyyymmdd
    ? `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${yyyymmdd}`
    : "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";
  const res = await fetch(url, { next: { revalidate: 30 } });
  if (!res.ok) return [];
  const data = await res.json();
  return data.events ?? [];
}

function yyyymmdd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

// NBA scores from ESPN scoreboard — auto-looks-ahead to tomorrow when
// today has no non-final games left (common late at night between slates).
export async function GET() {
  try {
    const STALE_MS = 5 * 60 * 60 * 1000;
    const now = Date.now();

    // 1) Pull today's scoreboard
    const todayEvents = await fetchScoreboardForDate();
    let games = todayEvents.map(mapEvent).filter(g => isActive(g, now, STALE_MS));

    // 2) If everything today is finished/stripped, look at the next few days
    //    so the sidebar is never "No games" when a slate is coming up.
    const hasUpcoming = games.some(g => g.status !== "final");
    if (!hasUpcoming) {
      for (let i = 1; i <= 3; i++) {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() + i);
        const events = await fetchScoreboardForDate(yyyymmdd(d));
        const nextGames = events.map(mapEvent).filter(g => isActive(g, now, STALE_MS));
        if (nextGames.length > 0) {
          // Merge: keep today's finals that are still recent, plus upcoming
          games = [...games, ...nextGames];
          break;
        }
      }
    }

    return NextResponse.json({ games, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("NBA scores error:", error);
    return NextResponse.json({ games: [], error: "Failed to fetch NBA scores" });
  }
}
