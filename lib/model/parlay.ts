// ──────────────────────────────────────────────────────────
// Parlay Builder & Correlation Engine
// ──────────────────────────────────────────────────────────

import type { ParlayLeg, ParlaySlip } from "./types";
import { americanToDecimal, americanToImpliedProb, decimalToAmerican, kellyStake } from "./kelly";

// Known correlations between MLB bet types
// Positive = outcomes tend to happen together
// Negative = outcomes tend to be mutually exclusive
const CORRELATION_MATRIX: Record<string, Record<string, number>> = {
  "team_ml": {
    "team_rl": 0.85,        // ML and run line are highly correlated
    "team_total_over": 0.30, // winning team tends to score more
    "opp_total_under": 0.25, // winner's pitcher tends to shut down
    "pitcher_ks": 0.15,      // winning pitcher tends to go deeper
    "hitter_hits": 0.20,     // winning team hitters do better
    "hitter_hrs": 0.15,      // correlated with scoring
  },
  "game_over": {
    "team_total_over": 0.60, // game over = teams scoring
    "hitter_hits": 0.35,     // more runs = more hits
    "hitter_hrs": 0.25,      // more runs = more HRs
    "pitcher_ks": -0.20,     // high scoring = less K dominance
  },
  "game_under": {
    "pitcher_ks": 0.30,      // low scoring = pitcher dominant
    "hitter_hits": -0.30,    // fewer runs = fewer hits
  },
};

// Estimate correlation between two parlay legs
function estimateCorrelation(leg1: ParlayLeg, leg2: ParlayLeg): number {
  // Same game correlation is higher
  const sameGame = leg1.game === leg2.game;
  if (!sameGame) return 0; // cross-game legs are roughly independent

  // Look up base correlation
  const key1 = getCorrelationKey(leg1);
  const key2 = getCorrelationKey(leg2);

  const baseCorr = CORRELATION_MATRIX[key1]?.[key2] ??
                   CORRELATION_MATRIX[key2]?.[key1] ?? 0;

  return baseCorr;
}

function getCorrelationKey(leg: ParlayLeg): string {
  if (leg.market === "moneyline") return "team_ml";
  if (leg.market === "spread") return "team_rl";
  if (leg.market === "total") {
    return leg.pick.toLowerCase().includes("over") ? "game_over" : "game_under";
  }
  if (leg.market === "player_prop") {
    if (leg.pick.toLowerCase().includes("k")) return "pitcher_ks";
    if (leg.pick.toLowerCase().includes("hit")) return "hitter_hits";
    if (leg.pick.toLowerCase().includes("hr")) return "hitter_hrs";
  }
  return "unknown";
}

// Calculate combined odds for a parlay
function calculateCombinedOdds(legs: ParlayLeg[]): number {
  return legs.reduce((acc, leg) => acc * americanToDecimal(leg.odds), 1);
}

// Adjust combined probability for correlations
function correlationAdjustedProb(legs: ParlayLeg[]): number {
  // Start with independent probability (product of individual probs)
  let independentProb = legs.reduce((acc, leg) => acc * leg.fairProb, 1);

  // Adjust for pairwise correlations
  let correlationAdjustment = 0;
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const corr = estimateCorrelation(legs[i], legs[j]);
      // Positive correlation = more likely to hit together
      correlationAdjustment += corr * legs[i].fairProb * legs[j].fairProb * 0.1;
    }
  }

  return Math.min(Math.max(independentProb + correlationAdjustment, 0.001), 0.99);
}

// Build a full parlay slip with analysis
export function buildParlay(legs: ParlayLeg[], bankroll: number = 1000): ParlaySlip {
  // Defensive: normalize fairProb to 0-1 range and clamp; some legacy callers
  // passed it as a percentage which silently inverted the parlay math.
  const safeLegs: ParlayLeg[] = legs.map(leg => {
    let fp = leg.fairProb;
    if (fp > 1) fp = fp / 100;
    fp = Math.min(0.99, Math.max(0.01, fp));
    return fp === leg.fairProb ? leg : { ...leg, fairProb: fp };
  });
  const combinedDecimalOdds = calculateCombinedOdds(safeLegs);
  const impliedProb = 1 / combinedDecimalOdds;
  const fairProb = safeLegs.reduce((acc, leg) => acc * leg.fairProb, 1);
  const corrAdjProb = correlationAdjustedProb(safeLegs);

  // Correct EV: jointFairProb * decimalOdds - 1 (algebraically same as the
  // (fair - implied) / implied form, but more readable).
  const evPct = (corrAdjProb * combinedDecimalOdds - 1) * 100;
  const suggestedStake = evPct > 0
    ? kellyStake(corrAdjProb, combinedDecimalOdds, bankroll, 0.1) // 10% kelly for parlays
    : 0;

  return {
    legs: safeLegs,
    combinedOdds: decimalToAmerican(combinedDecimalOdds),
    impliedProb: Math.round(impliedProb * 10000) / 100,
    fairProb: Math.round(fairProb * 10000) / 100,
    evPercentage: Math.round(evPct * 100) / 100,
    correlationAdjustedProb: Math.round(corrAdjProb * 10000) / 100,
    suggestedStake,
    potentialPayout: Math.round(suggestedStake * combinedDecimalOdds * 100) / 100,
  };
}

// Auto-generate smart parlays from available bets
export function generateSmartParlays(
  evBets: Array<{ game: string; market: string; pick: string; odds: number; fairProb: number; bookmaker: string }>,
  maxLegs: number = 3
): ParlaySlip[] {
  const parlays: ParlaySlip[] = [];

  // Strategy 1: Cross-game ML parlay (uncorrelated)
  const mlBets = evBets.filter(b => b.market === "moneyline" && b.fairProb > 0.55);
  if (mlBets.length >= 2) {
    const uniqueGames = Array.from(new Map(mlBets.map(b => [b.game, b])).values());
    const topPicks = uniqueGames
      .sort((a, b) => b.fairProb - a.fairProb)
      .slice(0, maxLegs);

    if (topPicks.length >= 2) {
      const legs: ParlayLeg[] = topPicks.map((b, i) => ({
        id: `auto-ml-${i}`,
        game: b.game,
        market: "moneyline" as const,
        pick: b.pick,
        odds: b.odds,
        impliedProb: americanToImpliedProb(b.odds),
        fairProb: b.fairProb,
        bookmaker: b.bookmaker,
      }));
      parlays.push(buildParlay(legs));
    }
  }

  // Strategy 2: Correlated same-game parlay (SGP)
  const gameGroups = new Map<string, typeof evBets>();
  for (const bet of evBets) {
    const existing = gameGroups.get(bet.game) || [];
    existing.push(bet);
    gameGroups.set(bet.game, existing);
  }

  for (const [game, bets] of Array.from(gameGroups.entries())) {
    if (bets.length >= 2) {
      const legs: ParlayLeg[] = bets.slice(0, 3).map((b, i) => ({
        id: `auto-sgp-${game}-${i}`,
        game: b.game,
        market: b.market as ParlayLeg["market"],
        pick: b.pick,
        odds: b.odds,
        impliedProb: americanToImpliedProb(b.odds),
        fairProb: b.fairProb,
        bookmaker: b.bookmaker,
      }));
      parlays.push(buildParlay(legs));
    }
  }

  // Sort by EV
  return parlays.sort((a, b) => b.evPercentage - a.evPercentage);
}

export { estimateCorrelation, calculateCombinedOdds, correlationAdjustedProb };
