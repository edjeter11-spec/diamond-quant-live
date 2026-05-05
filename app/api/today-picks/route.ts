import { NextRequest, NextResponse } from "next/server";
import { cloudGet, cloudSet } from "@/lib/supabase/client";
import { generateSmartPicks } from "@/lib/bot/smart-picks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
    // Always hit the public alias — VERCEL_URL points at the per-deploy URL
    // which can sit behind Vercel's auth wall on preview branches.
    const baseUrl = "https://diamond-quant-live.vercel.app";
    // bot-analysis (MLB three-models) returns the {consensus, pitcherModel, marketModel}
    // shape that smart-picks expects. The plain /api/analysis is a simpler
    // flat-shape route used elsewhere — would crash generateSmartPicks.
    const analysisUrl = isNBA ? `${baseUrl}/api/nba-analysis` : `${baseUrl}/api/bot-analysis`;
    const res = await fetch(analysisUrl, { signal: AbortSignal.timeout(45000) });
    if (!res.ok) {
      // Serve last-known cache instead of failing to a blank state
      const stale = await cloudGet<{ picks: any[]; generatedAt: string } | null>(cacheKey, null);
      if (stale?.picks?.length) return NextResponse.json({ ok: true, picks: stale.picks, cached: true, stale: true, generatedAt: stale.generatedAt });
      // 200 with empty picks so the UI shows the "no picks yet" empty state cleanly
      return NextResponse.json({ ok: true, picks: [], message: "Picks temporarily unavailable" });
    }

    const data = await res.json();
    const picks = generateSmartPicks(data.analyses ?? [], 5000);
    if (picks.length === 0) return NextResponse.json({ ok: true, picks: [] });

    const result = { picks, generatedAt: new Date().toISOString() };
    await cloudSet(cacheKey, result);
    return NextResponse.json({ ok: true, picks, cached: false, generatedAt: result.generatedAt });
  } catch (error: any) {
    // Final safety net: serve stale cache if present
    const stale = await cloudGet<{ picks: any[]; generatedAt: string } | null>(cacheKey, null);
    if (stale?.picks?.length) return NextResponse.json({ ok: true, picks: stale.picks, cached: true, stale: true, generatedAt: stale.generatedAt });
    return NextResponse.json({ ok: true, picks: [], message: "Picks temporarily unavailable" });
  }
}
