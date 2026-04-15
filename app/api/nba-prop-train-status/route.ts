import { NextResponse } from "next/server";
import { cloudGet } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const progress = await cloudGet("nba_prop_training_progress", {
      status: "idle",
      gamesProcessed: 0,
      totalGames: 0,
      accuracy: {},
    });
    return NextResponse.json(progress);
  } catch {
    return NextResponse.json({ status: "idle", gamesProcessed: 0, totalGames: 0, accuracy: {} });
  }
}
