import { NextResponse } from "next/server";
import { fetchTodayNFLGames, getNFLGameStatus } from "@/lib/nfl/stats-api";
import { getNFLTeamAbbrev } from "@/lib/nfl/teams";

export const dynamic = "force-dynamic";
export const revalidate = 60;

export async function GET() {
  try {
    const events = await fetchTodayNFLGames();
    const games = events.map((ev: any) => {
      const comp = ev.competitions?.[0];
      const home = comp?.competitors?.find((c: any) => c.homeAway === "home");
      const away = comp?.competitors?.find((c: any) => c.homeAway === "away");
      return {
        id: String(ev.id),
        homeTeam: home?.team?.displayName ?? "",
        awayTeam: away?.team?.displayName ?? "",
        homeAbbrev: home?.team?.abbreviation ?? "",
        awayAbbrev: away?.team?.abbreviation ?? "",
        homeScore: Number(home?.score ?? 0),
        awayScore: Number(away?.score ?? 0),
        status: getNFLGameStatus(ev),
        startTime: ev.date ?? "",
        period: Number(comp?.status?.period ?? 0),
        clock: comp?.status?.displayClock ?? "",
        venue: comp?.venue?.fullName ?? "",
      };
    });
    return NextResponse.json({ games }, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (e: any) {
    return NextResponse.json({ games: [], error: e?.message ?? "fail" }, { status: 200 });
  }
}
