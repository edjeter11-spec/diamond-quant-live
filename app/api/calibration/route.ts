import { NextResponse } from "next/server";
import { loadCalibration } from "@/lib/bot/calibration";

// force-dynamic — this route was being statically prerendered at BUILD time
// (a bare `revalidate` export without `dynamic` triggers static generation),
// which invoked a live Supabase call with no request context and no
// deployed env available yet, hanging the Vercel build past its 60s cap.
export const dynamic = "force-dynamic";
// Cache curve at the edge for 5 min — recomputed weekly, no need for fresh
export const revalidate = 300;

export async function GET() {
  try {
    const curve = await loadCalibration();
    return NextResponse.json({ ok: true, curve });
  } catch (e: any) {
    return NextResponse.json({
      ok: true,
      curve: null,
      message: "Calibration unavailable",
    });
  }
}
