import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCached, setCache } from "@/lib/odds/server-cache";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const players = searchParams.get("players"); // comma-separated

  if (!players) {
    return NextResponse.json({ error: "Missing players param" }, { status: 400 });
  }

  // Cache key based on player names
  const cacheKey = `nba_prop_acc_${players.slice(0, 50)}`;
  const cached = getCached(cacheKey, 300); // 5 min cache
  if (cached) return NextResponse.json(cached);

  try {
    const playerNames = players.split(",").map(p => p.trim()).filter(Boolean);

    // Query all graded predictions for these players
    const { data, error } = await supabase
      .from("prop_predictions")
      .select("player_name, prop_type, hit")
      .eq("status", "graded")
      .eq("sport", "nba")
      .in("player_name", playerNames);

    if (error) {
      return NextResponse.json({ accuracy: {}, error: error.message });
    }

    // Aggregate per player + prop type
    const accuracy: Record<string, {
      player: string;
      total: number;
      hits: number;
      winRate: number;
      byType: Record<string, { predictions: number; hits: number; winRate: number }>;
    }> = {};

    for (const row of data ?? []) {
      const key = row.player_name;
      if (!accuracy[key]) {
        accuracy[key] = { player: key, total: 0, hits: 0, winRate: 0, byType: {} };
      }
      accuracy[key].total++;
      if (row.hit) accuracy[key].hits++;

      const pt = accuracy[key].byType[row.prop_type] ?? { predictions: 0, hits: 0, winRate: 0 };
      pt.predictions++;
      if (row.hit) pt.hits++;
      pt.winRate = pt.predictions > 0 ? Math.round((pt.hits / pt.predictions) * 1000) / 10 : 0;
      accuracy[key].byType[row.prop_type] = pt;
    }

    // Calculate overall win rates
    for (const key of Object.keys(accuracy)) {
      const a = accuracy[key];
      a.winRate = a.total > 0 ? Math.round((a.hits / a.total) * 1000) / 10 : 0;
    }

    const result = { accuracy };
    setCache(cacheKey, result);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ accuracy: {}, error: "Failed" }, { status: 500 });
  }
}
