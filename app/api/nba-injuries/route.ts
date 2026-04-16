import { NextRequest, NextResponse } from "next/server";
import { fetchNBAInjuries, isPlayerInjured } from "@/lib/nba/injuries";

export const revalidate = 1800; // 30 min cache

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const player = searchParams.get("player");
  const team = searchParams.get("team");

  try {
    if (player) {
      const injury = await isPlayerInjured(player);
      return NextResponse.json({ player, injury });
    }

    const all = await fetchNBAInjuries();

    if (team) {
      const teamReport = all.find(r => r.teamAbbrev === team.toUpperCase());
      return NextResponse.json({ team, injuries: teamReport?.players ?? [] });
    }

    return NextResponse.json({
      teams: all.length,
      totalInjured: all.reduce((s, t) => s + t.players.length, 0),
      injuries: all,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
