import { NextRequest, NextResponse } from "next/server";
import { cloudGet, cloudSet } from "@/lib/supabase/client";
import { generateSmartPicks } from "@/lib/bot/smart-picks";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sport = (searchParams.get("sport") ?? "mlb").toLowerCase();
  const isNBA = sport === "nba";
  const today = new Date().toISOString().split("T")[0];
  const cacheKey = isNBA ? `smart_bot_today_nba_${today}` : `smart_bot_today_mlb_${today}`;

  const cached = await cloudGet<{ picks: any[]; generatedAt: string } | null>(cacheKey, null);
  if (cached?.picks?.length) {
    return NextResponse.json({ ok: true, picks: cached.picks, cached: true, generatedAt: cached.generatedAt });
  }

  try {
    const baseUrl = `https://${process.env.VERCEL_URL || "diamond-quant-live.vercel.app"}`;
    const analysisUrl = isNBA ? `${baseUrl}/api/nba-analysis` : `${baseUrl}/api/analysis`;
    const res = await fetch(analysisUrl, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return NextResponse.json({ ok: false, picks: [], error: "analysis fetch failed" });

    const data = await res.json();
    const picks = generateSmartPicks(data.analyses ?? [], 5000);
    if (picks.length === 0) return NextResponse.json({ ok: true, picks: [] });

    const result = { picks, generatedAt: new Date().toISOString() };
    await cloudSet(cacheKey, result);
    return NextResponse.json({ ok: true, picks, cached: false, generatedAt: result.generatedAt });
  } catch (error: any) {
    return NextResponse.json({ ok: false, picks: [], error: error.message }, { status: 500 });
  }
}
