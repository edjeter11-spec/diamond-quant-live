import { NextRequest, NextResponse } from "next/server";
import { getTrackRecordStats } from "@/lib/bot/track-record";
import { supabaseAdmin } from "@/lib/supabase/server-auth";

export const dynamic = "force-dynamic";
export const revalidate = 300;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const days = Math.min(
    365,
    Math.max(7, parseInt(searchParams.get("days") ?? "30")),
  );

  try {
    const stats = await getTrackRecordStats(days);
    if (!stats)
      return NextResponse.json({
        ok: true,
        days,
        recent: [],
        message: "No track record yet",
      });

    // Also fetch last 20 settled picks for a details table
    let recent: any[] = [];
    // Additive: recent graded props/NRFI so the history view isn't limited
    // to bot-slate picks — same source getTrackRecordStats rolls up from.
    let recentProps: any[] = [];
    if (supabaseAdmin) {
      const { data } = await supabaseAdmin
        .from("daily_picks_log")
        .select(
          "pick_date,sport,category,pick_text,game,odds,result,profit_units,settled_at",
        )
        .neq("result", "pending")
        .order("settled_at", { ascending: false })
        .limit(20);
      recent = data ?? [];

      const { data: propData } = await supabaseAdmin
        .from("prop_predictions")
        .select(
          "game_date,sport,player_name,prop_type,line,predicted_side,result,hit,actual_value,odds_at_pick,graded_at",
        )
        .eq("status", "graded")
        .order("graded_at", { ascending: false })
        .limit(20);
      recentProps = propData ?? [];
    }

    return NextResponse.json({
      ok: true,
      days,
      ...stats,
      recent,
      recentProps,
    });
  } catch (e: any) {
    console.error("results error:", e);
    return NextResponse.json({
      ok: true,
      days,
      recent: [],
      message: "Results temporarily unavailable",
    });
  }
}
