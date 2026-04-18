import { NextResponse } from "next/server";
import { loadCalibration } from "@/lib/bot/calibration";

export const dynamic = "force-dynamic";
export const revalidate = 300;

export async function GET() {
  const curve = await loadCalibration();
  return NextResponse.json({ ok: true, curve });
}
