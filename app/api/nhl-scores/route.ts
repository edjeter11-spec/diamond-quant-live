import { NextResponse } from "next/server";
import { fetchTodayNHLGames, getNHLGameStatus } from "@/lib/nhl/stats-api";

export const dynamic = "force-dynamic";
export const revalidate = 60;

export async function GET() {
  try {
    const events = await fetchTodayNHLGames();
    const games = events.map((g: any) => ({
      id: String(g.id),
      homeTeam: g.homeTeam?.name?.default ?? "",
      awayTeam: g.awayTeam?.name?.default ?? "",
      homeAbbrev: g.homeTeam?.abbrev ?? "",
      awayAbbrev: g.awayTeam?.abbrev ?? "",
      homeScore: Number(g.homeTeam?.score ?? 0),
      awayScore: Number(g.awayTeam?.score ?? 0),
      status: getNHLGameStatus(g),
      startTime: g.startTimeUTC ?? "",
      period: Number(g.periodDescriptor?.number ?? 0),
      clock: g.clock?.timeRemaining ?? "",
      venue: g.venue?.default ?? "",
    }));
    return NextResponse.json({ games }, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (e: any) {
    return NextResponse.json({ games: [], error: e?.message ?? "fail" }, { status: 200 });
  }
}
