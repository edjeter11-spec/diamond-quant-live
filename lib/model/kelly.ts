// ──────────────────────────────────────────────────────────
// Kelly Criterion & Staking Engine
// ──────────────────────────────────────────────────────────

// Convert American odds to decimal
// -110 → 1.9091, +150 → 2.50. Invalid (0/NaN) → 1 (no payout).
export function americanToDecimal(odds: number): number {
  if (!Number.isFinite(odds) || odds === 0) return 1;
  if (odds > 0) return odds / 100 + 1;
  return 100 / Math.abs(odds) + 1;
}

// Convert decimal odds to American
export function decimalToAmerican(decimal: number): number {
  if (!Number.isFinite(decimal) || decimal <= 1.0001) return 0; // no payout → no line
  if (decimal >= 2.0) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

// Convert American odds to implied probability
// -110 → 110/210 = 0.5238 (52.38%). Invalid input → 0.5 (uninformative).
export function americanToImpliedProb(odds: number): number {
  if (!Number.isFinite(odds) || odds === 0) return 0.5;
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

// Convert probability to fair American odds (no-vig)
// Clamped to (0.01, 0.99) so extreme probs can't divide by zero.
export function probToFairAmerican(prob: number): number {
  const p = Math.min(0.99, Math.max(0.01, Number.isFinite(prob) ? prob : 0.5));
  if (p >= 0.5) return Math.round((-100 * p) / (1 - p));
  return Math.round((100 * (1 - p)) / p);
}

// Kelly Criterion: optimal bet sizing
// f* = (bp − q) / b where b = decimal − 1, q = 1 − p.
export function kellyStake(
  fairProb: number,
  decimalOdds: number,
  bankroll: number,
  fraction: number = 0.25, // quarter-kelly default (safer)
): number {
  const b = decimalOdds - 1; // net odds
  // Guard: no payout, bad prob, or bad bankroll → no bet (avoids ÷0 / NaN stakes)
  if (
    !Number.isFinite(b) ||
    b <= 0 ||
    !Number.isFinite(fairProb) ||
    fairProb <= 0 ||
    fairProb >= 1 ||
    !Number.isFinite(bankroll) ||
    bankroll <= 0
  ) {
    return 0;
  }
  const q = 1 - fairProb;

  // Kelly formula: f* = (bp - q) / b
  const kelly = (b * fairProb - q) / b;

  // Never bet negative kelly (no edge)
  if (kelly <= 0) return 0;

  // Apply fraction for safety
  const fractionalKelly = kelly * fraction;

  // Cap at 5% of bankroll max
  const maxBet = bankroll * 0.05;
  const betAmount = Math.min(fractionalKelly * bankroll, maxBet);

  return Math.round(betAmount * 100) / 100;
}

// Calculate Expected Value (dollars) for a stake
export function calculateEV(
  fairProb: number,
  decimalOdds: number,
  stake: number,
): number {
  const winAmount = stake * (decimalOdds - 1);
  const ev = fairProb * winAmount - (1 - fairProb) * stake;
  return Math.round(ev * 100) / 100;
}

// EV as percentage of stake.
// ((p − implied) / implied) × 100 ≡ (p × decimal − 1) × 100 — same formula,
// stake counted exactly once.
export function evPercentage(fairProb: number, decimalOdds: number): number {
  if (!Number.isFinite(decimalOdds) || decimalOdds <= 1) return 0;
  if (!Number.isFinite(fairProb)) return 0;
  return (fairProb * decimalOdds - 1) * 100;
}

// Confidence level based on EV edge size
export function getConfidence(
  evPct: number,
): "HIGH" | "MEDIUM" | "LOW" | "NO_EDGE" {
  if (evPct >= 8) return "HIGH";
  if (evPct >= 4) return "MEDIUM";
  if (evPct >= 1) return "LOW";
  return "NO_EDGE";
}

// Remove vig from a two-way market to find true odds.
// Normalizes both sides' implied probabilities so they sum to 1.
export function devig(
  odds1: number,
  odds2: number,
): { prob1: number; prob2: number; vig: number } {
  const imp1 = americanToImpliedProb(odds1);
  const imp2 = americanToImpliedProb(odds2);
  const totalImp = imp1 + imp2;
  if (!Number.isFinite(totalImp) || totalImp <= 0) {
    return { prob1: 0.5, prob2: 0.5, vig: 0 };
  }
  const vig = totalImp - 1;

  return {
    prob1: imp1 / totalImp,
    prob2: imp2 / totalImp,
    vig: Math.round(vig * 10000) / 100, // as percentage
  };
}

// Optimal stake allocation for arbitrage
export function arbStakes(
  odds1Decimal: number,
  odds2Decimal: number,
  totalStake: number,
): { stake1: number; stake2: number; guaranteedProfit: number } {
  if (odds1Decimal <= 1 || odds2Decimal <= 1) {
    return { stake1: 0, stake2: 0, guaranteedProfit: 0 };
  }
  const imp1 = 1 / odds1Decimal;
  const imp2 = 1 / odds2Decimal;
  const totalImp = imp1 + imp2;

  if (totalImp >= 1) {
    return { stake1: 0, stake2: 0, guaranteedProfit: 0 };
  }

  const stake1 = totalStake * (imp1 / totalImp);
  const stake2 = totalStake * (imp2 / totalImp);

  const payout1 = stake1 * odds1Decimal;
  const guaranteedProfit = payout1 - totalStake;

  return {
    stake1: Math.round(stake1 * 100) / 100,
    stake2: Math.round(stake2 * 100) / 100,
    guaranteedProfit: Math.round(guaranteedProfit * 100) / 100,
  };
}
