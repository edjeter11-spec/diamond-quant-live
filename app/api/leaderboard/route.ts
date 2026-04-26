import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

export async function GET() {
  try {
    // Get all user profiles (non-deleted)
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("id, display_name, avatar_url")
      .is("deleted_at", null);

    if (!profiles || profiles.length === 0) {
      return NextResponse.json({ entries: [] });
    }

    // Batch-fetch all bet histories in one query (was N+1)
    const userIds = profiles.map(p => p.id);
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
      const bets = betsByUser.get(profile.id) ?? [];
      const settled = bets.filter((b: any) => b.result && b.result !== "pending");
      if (settled.length < 10) continue; // Min 10 bets to qualify

      const wins = settled.filter((b: any) => b.result === "win").length;
      const losses = settled.filter((b: any) => b.result === "loss").length;
      const totalStaked = settled.reduce((s: number, b: any) => s + (b.stake ?? 0), 0);
      const totalReturns = settled.reduce((s: number, b: any) => s + (b.payout ?? 0), 0);
      const profit = totalReturns - totalStaked;

      entries.push({
        id: profile.id,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
        stats: {
          wins,
          losses,
          roi: totalStaked > 0 ? (profit / totalStaked) * 100 : 0,
          profit,
          winRate: (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0,
          totalBets: settled.length,
        },
      });
    }

    // Sort by ROI
    entries.sort((a, b) => b.stats.roi - a.stats.roi);

    return NextResponse.json({ entries: entries.slice(0, 50) });
  } catch (err) {
    return NextResponse.json({ entries: [], error: "Failed to load leaderboard" }, { status: 500 });
  }
}

export const revalidate = 1800; // Cache for 30 min
