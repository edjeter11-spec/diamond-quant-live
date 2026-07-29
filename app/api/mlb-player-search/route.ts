import { NextResponse } from "next/server";
import { searchPlayersMulti } from "@/lib/mlb/player-stats";

export const revalidate = 3600;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";

  const results = await searchPlayersMulti(q);
  return NextResponse.json({ results });
}
