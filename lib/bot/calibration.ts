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

export interface ConfidenceTierStat {
  tier: string; // "HIGH" | "MEDIUM" | "LOW"
  count: number;
  wins: number;
  losses: number;
  actualHitRate: number; // 0-1
  /** haircut applied to displayed confidence, e.g. -0.12 means we show 12pts lower */
  haircut: number;
}

export interface CalibrationCurve {
  bins: CalibrationBin[];
  sample: number;
  computedAt: string;
  /** delta: average actualRate - average predicted midpoint. Positive = we're underconfident. Negative = overconfident. */
  calibrationDelta: number;
  /** NEW: hit rate by stated confidence label — lets us haircut HIGH/MEDIUM/LOW labels that don't match reality */
  confidenceTiers?: Record<string, ConfidenceTierStat>;
  /** NEW: hit rate by market type (moneyline/spread/total/player_prop) */
  marketRates?: Record<
    string,
    { count: number; wins: number; losses: number; hitRate: number }
  >;
}

/** Minimum settled samples before we trust a bucket enough to act on it. */
const MIN_SAMPLE_FOR_ACTION = 20;
const MIN_SAMPLE_FOR_TIER = 15;

const DEFAULT_BINS: Array<[number, number]> = [
  [0.5, 0.55],
  [0.55, 0.6],
  [0.6, 0.65],
  [0.65, 0.7],
  [0.7, 0.8],
  [0.8, 1.01],
];

/**
 * Read the most recent 200 settled (non-pending) daily_picks_log rows
 * and compute the calibration curve. Skips if sample < 20 (too noisy).
 */
export async function computeCalibration(): Promise<CalibrationCurve | null> {
  if (!supabaseAdmin) return null;

  const { data } = await supabaseAdmin
    .from("daily_picks_log")
    .select("fair_prob,result,confidence,market")
    .neq("result", "pending")
    .not("fair_prob", "is", null)
    .order("settled_at", { ascending: false })
    .limit(500);

  const rows = data ?? [];
  if (rows.length < MIN_SAMPLE_FOR_ACTION) return null; // not enough sample to calibrate

  const bins: CalibrationBin[] = DEFAULT_BINS.map(([lower, upper]) => {
    const inBin = rows.filter((r) => {
      // fair_prob stored as percentage (0-100) in some paths, 0-1 in others — normalize
      const raw = Number(r.fair_prob ?? 0);
      const p = Number.isFinite(raw) ? (raw > 1 ? raw / 100 : raw) : 0.5;
      return p >= lower && p < upper;
    });
    const wins = inBin.filter((r) => r.result === "win").length;
    const decided = inBin.filter(
      (r) => r.result === "win" || r.result === "loss",
    ).length;
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

  // ── Confidence-tier hit rates: does a "HIGH" label actually hit more than MEDIUM/LOW? ──
  const tiers = ["HIGH", "MEDIUM", "LOW"];
  const confidenceTiers: Record<string, ConfidenceTierStat> = {};
  for (const tier of tiers) {
    const inTier = rows.filter(
      (r) => (r.confidence ?? "").toUpperCase() === tier,
    );
    const wins = inTier.filter((r) => r.result === "win").length;
    const losses = inTier.filter((r) => r.result === "loss").length;
    const decided = wins + losses;
    const actualHitRate = decided > 0 ? wins / decided : 0;

    // Expected hit rate per label (what "HIGH"/"MEDIUM"/"LOW" implies)
    const expected = tier === "HIGH" ? 0.65 : tier === "MEDIUM" ? 0.55 : 0.5;
    // Haircut: if actual < expected and sample is trustworthy, shrink displayed confidence.
    // Guard against div/0 and clamp to a sane range so one bad bucket can't nuke display.
    const haircut =
      decided >= MIN_SAMPLE_FOR_TIER
        ? Math.max(-0.25, Math.min(0.1, actualHitRate - expected))
        : 0;

    confidenceTiers[tier] = {
      tier,
      count: decided,
      wins,
      losses,
      actualHitRate: Math.round(actualHitRate * 1000) / 1000,
      haircut: Math.round(haircut * 1000) / 1000,
    };
  }

  // ── Per-market hit rates (moneyline / spread / total / player_prop) ──
  const marketSet = new Set(
    rows.map((r) => (r.market ?? "moneyline").toLowerCase()),
  );
  const marketRates: Record<
    string,
    { count: number; wins: number; losses: number; hitRate: number }
  > = {};
  for (const market of marketSet) {
    const inMarket = rows.filter(
      (r) => (r.market ?? "moneyline").toLowerCase() === market,
    );
    const wins = inMarket.filter((r) => r.result === "win").length;
    const losses = inMarket.filter((r) => r.result === "loss").length;
    const decided = wins + losses;
    marketRates[market] = {
      count: decided,
      wins,
      losses,
      hitRate: decided > 0 ? Math.round((wins / decided) * 1000) / 1000 : 0,
    };
  }

  return {
    bins,
    sample: rows.length,
    computedAt: new Date().toISOString(),
    calibrationDelta: Math.round(calibrationDelta * 1000) / 1000,
    confidenceTiers,
    marketRates,
  };
}

/**
 * Compute the calibration curve AND persist it in one call.
 * Cron / training jobs should call this so the curve is never stale.
 * Returns null (no-op) if sample is too small or DB unavailable — never throws.
 */
export async function computeAndSaveCalibration(): Promise<CalibrationCurve | null> {
  try {
    const curve = await computeCalibration();
    if (!curve) return null;
    await saveCalibration(curve);
    return curve;
  } catch {
    return null;
  }
}

/**
 * Given a predicted probability, return the calibrated display probability.
 * If we've seen picks in that bin with a different actual hit rate, return the
 * actual rate. If the bin has <5 samples, return the original.
 */
export function calibrate(
  predicted: number,
  curve: CalibrationCurve | null,
): number {
  if (!curve || !Number.isFinite(predicted)) return predicted;
  const p = predicted > 1 ? predicted / 100 : predicted;
  const bin = curve.bins.find((b) => p >= b.lower && p < b.upper);
  if (!bin || bin.count < 5) return predicted;
  // Clamp: a 5-for-5 bin would otherwise display 100% — never show certainty
  const midpoint = Math.min(0.99, Math.max(0.01, bin.displayMidpoint));
  // Preserve input scale (percentage vs fraction)
  const scale = predicted > 1 ? 100 : 1;
  return Math.round(midpoint * scale * 100) / 100;
}

/**
 * Given a stated confidence label and its underlying fair probability,
 * return a calibrated label + adjusted probability that reflect the bot's
 * REAL historical hit rate for that label — not just the cosmetic tier.
 *
 * If the bot has been overconfident on "HIGH" picks (measured haircut < 0),
 * this can downgrade HIGH -> MEDIUM, or MEDIUM -> LOW, and it shaves the
 * displayed probability down accordingly. Requires MIN_SAMPLE_FOR_TIER
 * settled picks in that bucket before it will touch anything (sample-size
 * guard — never recalibrate off a handful of picks).
 */
export function calibrateConfidenceLabel(
  label: "HIGH" | "MEDIUM" | "LOW",
  fairProb: number,
  curve: CalibrationCurve | null,
): {
  calibratedLabel: "HIGH" | "MEDIUM" | "LOW";
  calibratedProb: number;
  haircutApplied: number;
  sampleSize: number;
} {
  const safeProb = Math.min(
    0.99,
    Math.max(0.01, Number.isFinite(fairProb) ? fairProb : 0.5),
  );
  const tierStat = curve?.confidenceTiers?.[label];
  const sampleSize = tierStat?.count ?? 0;

  if (!tierStat || sampleSize < MIN_SAMPLE_FOR_TIER) {
    return {
      calibratedLabel: label,
      calibratedProb: safeProb,
      haircutApplied: 0,
      sampleSize,
    };
  }

  const haircut = tierStat.haircut; // negative = overconfident, shrink it
  const calibratedProb = Math.min(0.99, Math.max(0.01, safeProb + haircut));

  // Downgrade the label if the haircut is severe enough that the tier's
  // real hit rate looks more like the tier below it.
  let calibratedLabel: "HIGH" | "MEDIUM" | "LOW" = label;
  if (label === "HIGH" && tierStat.actualHitRate < 0.55)
    calibratedLabel = "MEDIUM";
  if ((label === "HIGH" || label === "MEDIUM") && tierStat.actualHitRate < 0.5)
    calibratedLabel = "LOW";

  return {
    calibratedLabel,
    calibratedProb,
    haircutApplied: haircut,
    sampleSize,
  };
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
