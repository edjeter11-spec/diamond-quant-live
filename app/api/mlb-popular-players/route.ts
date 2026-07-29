import { NextResponse } from "next/server";
import { getPopularPlayers } from "@/lib/mlb/player-stats";

export const revalidate = 3600;

export async function GET() {
  const players = await getPopularPlayers();
  return NextResponse.json({ players });
}
