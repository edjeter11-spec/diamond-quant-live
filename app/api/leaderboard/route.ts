/*
 * Leaderboard API
 *
 * Reads bet history from the `user_state` table (key = "betHistory").
 * BetRecord shape (from lib/model/types.ts):
 *   id, timestamp, game, market, pick, bookmaker, odds,
 *   stake, result ("pending"|"win"|"loss"|"push"|"void"), payout,
 *   isParlay, evAtPlacement
 *
 * Query params:
 *   period  — "all" | "month" | "week"  (default: "all")
 *   userId  — if provided, returns only that user's stats (for My Stats panel)
 *
 * Minimum 5 settled bets to appear on leaderboard.
 * Sorted by win_rate DESC (with userId filter, always returns the user's row).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const key = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  if (!url || !key) return null;
  return createClient(url, key);
}

function periodStart(period: string): Date | null {
  const now = new Date();
  if (period === "week") {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return d;
  }
  if (period === "month") {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 1);
    return d;
  }
  return null; // all time
}

function calcBestStreak(bets: any[]): number {
  let best = 0;
  let cur = 0;
  for (const b of bets) {
    if (b.result === "win") { cur++; if (cur > best) best = cur; }
    else if (b.result === "loss") cur = 0;
  }
  return best;
}

function calcStats(bets: any[]) {
  const settled = bets.filter((b: any) => b.result === "win" || b.result === "loss");
  const wins = settled.filter((b: any) => b.result === "win").length;
  const losses = settled.filter((b: any) => b.result === "loss").length;
  const totalStaked = settled.reduce((s: number, b: any) => s + (b.stake ?? 0), 0);
  const totalReturns = settled.reduce((s: number, b: any) => s + (b.payout ?? 0), 0);
  const profit = totalReturns - totalStaked;
  const winRate = (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0;
  const roi = totalStaked > 0 ? (profit / totalStaked) * 100 : 0;
  const bestStreak = calcBestStreak(settled);

  // Favorite market (most frequent market string)
  const marketCounts: Record<string, number> = {};
  for (const b of bets) {
    if (b.market) marketCounts[b.market] = (marketCounts[b.market] ?? 0) + 1;
  }
  const favoriteMarket = Object.entries(marketCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // Sport breakdown
  const mlbBets = bets.filter((b: any) => b.game && /\bMLB\b|\bmlb\b/.test(b.game)).length;
  const nbaBets = bets.filter((b: any) => b.game && /\bNBA\b|\bnba\b/.test(b.game)).length;
  const totalTagged = mlbBets + nbaBets || 1;

  return {
    wins,
    losses,
    roi,
    profit,
    winRate,
    totalBets: settled.length,
    bestStreak,
    favoriteMarket,
    mlbPct: Math.round((mlbBets / totalTagged) * 100),
    nbaPct: Math.round((nbaBets / totalTagged) * 100),
  };
}

export async function GET(req: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ entries: [], error: "Supabase not configured" }, { status: 503 });

  try {
    const { searchParams } = req.nextUrl;
    const period = searchParams.get("period") ?? "all";
    const userId = searchParams.get("userId") ?? null;
    const cutoff = periodStart(period);

    if (userId) {
      // ── Single-user stats (My Stats panel) ──
      const { data: stateRow } = await supabase
        .from("user_state")
        .select("value")
        .eq("user_id", userId)
        .eq("key", "betHistory")
        .single();

      let bets: any[] = (stateRow?.value as any[]) ?? [];
      if (cutoff) bets = bets.filter((b: any) => new Date(b.timestamp) >= cutoff);

      const stats = calcStats(bets);
      return NextResponse.json({ userStats: stats });
    }

    // ── Full leaderboard ──
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("id, display_name, avatar_url")
      .is("deleted_at", null);

    if (!profiles || profiles.length === 0) {
      return NextResponse.json({ entries: [] });
    }

    const userIds = profiles.map((p: any) => p.id);
    const { data: states } = await supabase
      .from("user_state")
      .select("user_id, value")
      .in("user_id", userIds)
      .eq("key", "betHistory");

    const betsByUser = new Map<string, any[]>();
    for (const row of states ?? []) {
      betsByUser.set(row.user_id, (row.value as any[]) ?? []);
    }

    const entries = [];
    for (const profile of profiles) {
      let bets = betsByUser.get(profile.id) ?? [];
      if (cutoff) bets = bets.filter((b: any) => new Date(b.timestamp) >= cutoff);

      const stats = calcStats(bets);
      if (stats.totalBets < 5) continue; // Min 5 settled bets

      entries.push({
        id: profile.id,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
        stats,
      });
    }

    // Sort by win rate DESC
    entries.sort((a, b) => b.stats.winRate - a.stats.winRate);

    return NextResponse.json({ entries: entries.slice(0, 50) });
  } catch (err) {
    console.error("leaderboard error:", err);
    return NextResponse.json({ entries: [], message: "Leaderboard temporarily unavailable" });
  }
}

export const dynamic = "force-dynamic";
export const maxDuration = 30;
