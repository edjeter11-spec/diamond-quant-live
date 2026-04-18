// ──────────────────────────────────────────────────────────
// Calibration — does stated confidence match reality?
//
// We store every pick's fair_prob (pre-game probability) in the
// daily_picks_log. After games settle, we can bin those picks by
// their predicted probability and compare to the actual hit rate.
// If 65%-labeled picks hit 58% in reality, we're overconfident.
//
// Output is a mapping that the UI reads to rewrite stated confidence
// so users never see a label that doesn't match our track record.
// ──────────────────────────────────────────────────────────

import { supabaseAdmin } from "@/lib/supabase/server-auth";

export interface CalibrationBin {
  /** predicted prob lower bound, 0-1 (e.g. 0.50 = 50%) */
  lower: number;
  /** predicted prob upper bound, exclusive */
  upper: number;
  /** sample count */
  count: number;
  /** wins / (wins + losses), 0-1 */
  actualRate: number;
  /** midpoint of the bin, used as display probability when we remap */
  displayMidpoint: number;
}

export interface CalibrationCurve {
  bins: CalibrationBin[];
  sample: number;
  computedAt: string;
  /** delta: average actualRate - average predicted midpoint. Positive = we're underconfident. Negative = overconfident. */
  calibrationDelta: number;
}

const DEFAULT_BINS: Array<[number, number]> = [
  [0.50, 0.55],
  [0.55, 0.60],
  [0.60, 0.65],
  [0.65, 0.70],
  [0.70, 0.80],
  [0.80, 1.01],
];

/**
 * Read the most recent 200 settled (non-pending) daily_picks_log rows
 * and compute the calibration curve. Skips if sample < 20 (too noisy).
 */
export async function computeCalibration(): Promise<CalibrationCurve | null> {
  if (!supabaseAdmin) return null;

  const { data } = await supabaseAdmin
    .from("daily_picks_log")
    .select("fair_prob,result")
    .neq("result", "pending")
    .not("fair_prob", "is", null)
    .order("settled_at", { ascending: false })
    .limit(200);

  const rows = data ?? [];
  if (rows.length < 20) return null; // not enough sample to calibrate

  const bins: CalibrationBin[] = DEFAULT_BINS.map(([lower, upper]) => {
    const inBin = rows.filter(r => {
      // fair_prob stored as percentage (0-100) in some paths, 0-1 in others — normalize
      const raw = Number(r.fair_prob ?? 0);
      const p = raw > 1 ? raw / 100 : raw;
      return p >= lower && p < upper;
    });
    const wins = inBin.filter(r => r.result === "win").length;
    const decided = inBin.filter(r => r.result === "win" || r.result === "loss").length;
    const actualRate = decided > 0 ? wins / decided : 0;
    return {
      lower,
      upper,
      count: decided,
      actualRate,
      displayMidpoint: decided >= 5 ? actualRate : (lower + upper) / 2,
    };
  });

  // Weighted calibration delta: how off is our prediction on average?
  let weightedDelta = 0;
  let weightSum = 0;
  for (const b of bins) {
    if (b.count === 0) continue;
    const predictedMidpoint = (b.lower + b.upper) / 2;
    weightedDelta += (b.actualRate - predictedMidpoint) * b.count;
    weightSum += b.count;
  }
  const calibrationDelta = weightSum > 0 ? weightedDelta / weightSum : 0;

  return {
    bins,
    sample: rows.length,
    computedAt: new Date().toISOString(),
    calibrationDelta: Math.round(calibrationDelta * 1000) / 1000,
  };
}

/**
 * Given a predicted probability, return the calibrated display probability.
 * If we've seen picks in that bin with a different actual hit rate, return the
 * actual rate. If the bin has <5 samples, return the original.
 */
export function calibrate(predicted: number, curve: CalibrationCurve | null): number {
  if (!curve) return predicted;
  const p = predicted > 1 ? predicted / 100 : predicted;
  const bin = curve.bins.find(b => p >= b.lower && p < b.upper);
  if (!bin || bin.count < 5) return predicted;
  // Preserve input scale (percentage vs fraction)
  const scale = predicted > 1 ? 100 : 1;
  return Math.round(bin.displayMidpoint * scale * 100) / 100;
}

/**
 * Save the computed curve to app_state so UI and server can both read it.
 */
export async function saveCalibration(curve: CalibrationCurve): Promise<void> {
  if (!supabaseAdmin) return;
  await supabaseAdmin
    .from("app_state")
    .upsert({ key: "brain_calibration", value: curve as any });
}

export async function loadCalibration(): Promise<CalibrationCurve | null> {
  if (!supabaseAdmin) return null;
  const { data } = await supabaseAdmin
    .from("app_state")
    .select("value")
    .eq("key", "brain_calibration")
    .single();
  return (data?.value as any) ?? null;
}
