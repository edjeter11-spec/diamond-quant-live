import { NextRequest, NextResponse } from "next/server";
import { cloudGet } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";
export const revalidate = 60;

// Returns recent graded prop picks (cumulative across days)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sport = (searchParams.get("sport") ?? "nba").toLowerCase();
  const limit = Math.min(200, parseInt(searchParams.get("limit") ?? "50"));

  try {
    const histKey = `prop_pick_history_${sport}`;
    const history = (await cloudGet<any[]>(histKey, [])) ?? [];

    // Also try to read today's pending picks if not already in history
    const today = new Date().toISOString().split("T")[0];
    const todayKey = `prop_picks_today_${sport}_${today}`;
    const todayData = await cloudGet<any>(todayKey, null);
    const pending = (todayData?.picks ?? []).filter((p: any) => !p.result).map((p: any) => ({
      ...p, date: today, sport, result: "pending",
    }));

    // Sort: pending first (most recent date), then graded by date desc
    const all = [...pending, ...history].slice(0, limit);

    const graded = history.filter((p: any) => p.result === "win" || p.result === "loss" || p.result === "push");
    const wins = graded.filter((p: any) => p.result === "win").length;
    const losses = graded.filter((p: any) => p.result === "loss").length;
    const pushes = graded.filter((p: any) => p.result === "push").length;
    const winRate = graded.length > 0 ? Math.round((wins / Math.max(wins + losses, 1)) * 1000) / 10 : 0;

    return NextResponse.json({
      ok: true,
      picks: all,
      stats: {
        graded: graded.length,
        wins, losses, pushes,
        pending: pending.length,
        winRate,
      },
    }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message, picks: [], stats: {} });
  }
}
