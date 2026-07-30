import { NextRequest, NextResponse } from "next/server";
import { fetchMLBInjuries } from "@/lib/mlb/injuries";

export const revalidate = 1800; // 30 min — matches the in-process cache

// Mirrors /api/nba-injuries so the client can swap the URL by sport and get
// the same response shape back.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const team = searchParams.get("team");

  try {
    const all = await fetchMLBInjuries();

    if (team) {
      const teamReport = all.find((r) => r.teamAbbrev === team.toUpperCase());
      return NextResponse.json({ team, injuries: teamReport?.players ?? [] });
    }

    return NextResponse.json({
      teams: all.length,
      totalInjured: all.reduce((s, t) => s + t.players.length, 0),
      injuries: all,
    });
  } catch (error: any) {
    console.error("mlb-injuries error:", error);
    return NextResponse.json({ teams: 0, totalInjured: 0, injuries: [] });
  }
}
