import { NextRequest, NextResponse } from "next/server";
import { getTrackRecordStats } from "@/lib/bot/track-record";
import { supabaseAdmin } from "@/lib/supabase/server-auth";

export const dynamic = "force-dynamic";
export const revalidate = 300;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const days = Math.min(365, Math.max(7, parseInt(searchParams.get("days") ?? "30")));

  try {
    const stats = await getTrackRecordStats(days);
    if (!stats) return NextResponse.json({ ok: false, error: "No track record yet" });

    // Also fetch last 20 settled picks for a details table
    let recent: any[] = [];
    if (supabaseAdmin) {
      const { data } = await supabaseAdmin
        .from("daily_picks_log")
        .select("pick_date,sport,category,pick_text,game,odds,result,profit_units,settled_at")
        .neq("result", "pending")
        .order("settled_at", { ascending: false })
        .limit(20);
      recent = data ?? [];
    }

    return NextResponse.json({ ok: true, days, ...stats, recent });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message });
  }
}
