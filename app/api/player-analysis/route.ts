import { NextResponse } from "next/server";
import { analyzePlayer } from "@/lib/mlb/player-stats";

export const revalidate = 120;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const name = searchParams.get("name");
  const market = searchParams.get("market") || "pitcher_strikeouts";
  const line = parseFloat(searchParams.get("line") || "0");
  const opponent = searchParams.get("opponent") || undefined;

  if (!name) {
    return NextResponse.json({ error: "Player name required" }, { status: 400 });
  }

  try {
    const analysis = await analyzePlayer(name, market, line, opponent);

    if (!analysis) {
      return NextResponse.json({
        error: "Player not found or no stats available",
        name,
      }, { status: 404 });
    }

    return NextResponse.json(analysis);
  } catch (error) {
    console.error("Player analysis error:", error);
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}
