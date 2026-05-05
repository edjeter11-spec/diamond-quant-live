import { NextResponse } from "next/server";
import { loadCalibration } from "@/lib/bot/calibration";

// Cache curve at the edge for 5 min — recomputed weekly, no need for fresh
export const revalidate = 300;

export async function GET() {
  try {
    const curve = await loadCalibration();
    return NextResponse.json({ ok: true, curve });
  } catch (e: any) {
    return NextResponse.json({ ok: true, curve: null, message: "Calibration unavailable" });
  }
}
