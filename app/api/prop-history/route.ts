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

    // Merge pending + history, but dedup by player::propType::date so a pick
    // already in history (graded) takes precedence over the same pick in today's
    // pending cache (which can stay "pending" if the today key wasn't updated).
    const seenKey = (p: any) =>
      `${(p.playerName ?? "").toLowerCase()}::${p.propType ?? p.market ?? ""}::${p.date ?? ""}`;
    const merged: any[] = [];
    const seen = new Set<string>();
    // History first so graded results win over pending
    for (const p of history) {
      const k = seenKey(p);
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(p);
    }
    for (const p of pending) {
      const k = seenKey(p);
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(p);
    }
    // Sort: pending (no result) first, then graded by date desc
    merged.sort((a, b) => {
      const aP = !a.result || a.result === "pending" ? 1 : 0;
      const bP = !b.result || b.result === "pending" ? 1 : 0;
      if (aP !== bP) return bP - aP;
      return (b.date ?? "").localeCompare(a.date ?? "");
    });
    const all = merged.slice(0, limit);

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
