// ──────────────────────────────────────────────────────────
// Kelly Criterion & Staking Engine
// ──────────────────────────────────────────────────────────

// Convert American odds to decimal
export function americanToDecimal(odds: number): number {
  if (odds > 0) return (odds / 100) + 1;
  return (100 / Math.abs(odds)) + 1;
}

// Convert decimal odds to American
export function decimalToAmerican(decimal: number): number {
  if (decimal >= 2.0) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

// Convert American odds to implied probability
export function americanToImpliedProb(odds: number): number {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

// Convert probability to fair American odds (no-vig)
export function probToFairAmerican(prob: number): number {
  if (prob >= 0.5) return Math.round(-100 * prob / (1 - prob));
  return Math.round(100 * (1 - prob) / prob);
}

// Kelly Criterion: optimal bet sizing
export function kellyStake(
  fairProb: number,
  decimalOdds: number,
  bankroll: number,
  fraction: number = 0.25 // quarter-kelly default (safer)
): number {
  const b = decimalOdds - 1; // net odds
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

// Calculate Expected Value
export function calculateEV(fairProb: number, decimalOdds: number, stake: number): number {
  const winAmount = stake * (decimalOdds - 1);
  const ev = (fairProb * winAmount) - ((1 - fairProb) * stake);
  return Math.round(ev * 100) / 100;
}

// EV as percentage
export function evPercentage(fairProb: number, decimalOdds: number): number {
  const impliedProb = 1 / decimalOdds;
  return ((fairProb - impliedProb) / impliedProb) * 100;
}

// Confidence level based on EV edge size
export function getConfidence(evPct: number): "HIGH" | "MEDIUM" | "LOW" | "NO_EDGE" {
  if (evPct >= 8) return "HIGH";
  if (evPct >= 4) return "MEDIUM";
  if (evPct >= 1) return "LOW";
  return "NO_EDGE";
}

// Remove vig from a two-way market to find true odds
export function devig(odds1: number, odds2: number): { prob1: number; prob2: number; vig: number } {
  const imp1 = americanToImpliedProb(odds1);
  const imp2 = americanToImpliedProb(odds2);
  const totalImp = imp1 + imp2;
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
  totalStake: number
): { stake1: number; stake2: number; guaranteedProfit: number } {
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
