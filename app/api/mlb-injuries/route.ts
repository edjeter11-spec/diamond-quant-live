import { NextRequest, NextResponse } from "next/server";
import { fetchMLBInjuries } from "@/lib/mlb/injuries";

// `revalidate` alone doesn't fire when a route reads `searchParams` — Next
// treats that as dynamic. Explicit edge headers work regardless. Injuries
// change on a scale of hours, so 30min at the edge with 1h SWR is safe.
const EDGE_HEADERS = {
  "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600",
};

// Mirrors /api/nba-injuries so the client can swap the URL by sport and get
// the same response shape back.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const team = searchParams.get("team");

  try {
    const all = await fetchMLBInjuries();

    if (team) {
      const teamReport = all.find((r) => r.teamAbbrev === team.toUpperCase());
      return NextResponse.json(
        { team, injuries: teamReport?.players ?? [] },
        { headers: EDGE_HEADERS },
      );
    }

    return NextResponse.json(
      {
        teams: all.length,
        totalInjured: all.reduce((s, t) => s + t.players.length, 0),
        injuries: all,
      },
      { headers: EDGE_HEADERS },
    );
  } catch (error: any) {
    console.error("mlb-injuries error:", error);
    return NextResponse.json({ teams: 0, totalInjured: 0, injuries: [] });
  }
}
