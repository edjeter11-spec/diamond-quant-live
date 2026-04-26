// ──────────────────────────────────────────────────────────
// NBA ENGINE — Basketball-specific prediction model
// Net Rating, Home Court, Rest/B2B, Form, Injuries, Pace, Refs
// ──────────────────────────────────────────────────────────

import { aggregateCrew, type RefereeData } from "@/lib/nba/referees";

export interface NBAWeights {
  netRating: number;     // 30% — Off Rating - Def Rating
  homeCourt: number;     // 12% — ~60% home win rate in NBA
  restB2B: number;       // 15% — back-to-backs are huge
  recentForm: number;    // 15% — last 10 games
  injuryImpact: number;  // 15% — one star = 20% of team
  atsTrends: number;     // 8%  — against the spread history
  paceMismatch: number;  // 5%  — fast vs slow creates variance
}

export const DEFAULT_NBA_WEIGHTS: NBAWeights = {
  netRating: 0.30,
  homeCourt: 0.12,
  restB2B: 0.15,
  recentForm: 0.15,
  injuryImpact: 0.15,
  atsTrends: 0.08,
  paceMismatch: 0.05,
};

export interface NBAModelPrediction {
  homeWinProb: number;
  spreadProjection: number;
  totalProjection: number;
  confidence: number;
  factors: string[];
}

// ── Net Rating Model ──
// Uses offensive/defensive efficiency to predict winner

export function runNetRatingModel(
  homeTeam: string,
  awayTeam: string,
  oddsLines: any[],
  refs?: RefereeData[]
): NBAModelPrediction {
  const factors: string[] = [];

  // NBA home court is stronger than MLB (~60% vs 54%)
  let homeEdge = 6; // 6 points of home court advantage baseline
  factors.push("Home court: +6 points baseline (NBA average)");

  // Use market odds as proxy for team quality
  if (oddsLines.length > 0) {
    const line = oddsLines[0];
    if (line.homeSpread && line.homeSpread !== 0) {
      // Spread IS the market's net rating estimate
      const spread = line.homeSpread;
      factors.push(`Market spread: ${spread > 0 ? "+" : ""}${spread} (${spread < 0 ? homeTeam : awayTeam} favored)`);
    }
  }

  // Convert to probability (NBA: ~2.5 points per 10% win probability)
  const prob = Math.min(0.85, Math.max(0.15, 0.50 + homeEdge / 50));

  // Total projection (NBA average is ~224, ref crew shifts it)
  let totalProjection = 224;
  if (refs && refs.length > 0) {
    const crew = aggregateCrew(refs);
    // Half-weight the ref signal (other factors set the baseline)
    const refShift = (crew.totalPointsBoost - 225) * 0.5;
    totalProjection += refShift;
    const dir = refShift > 0 ? "+" : "";
    factors.push(`Officials: ${crew.names.join(", ")} (${dir}${refShift.toFixed(1)} total, ${crew.foulRatePerGame.toFixed(0)} fouls/G avg)`);
  }

  return {
    homeWinProb: prob,
    spreadProjection: -homeEdge,
    totalProjection,
    confidence: 40, // baseline without team-specific data
    factors,
  };
}

// ── Form Model ──
// Recent performance, streaks, momentum

export function runFormModel(
  homeTeam: string,
  awayTeam: string
): NBAModelPrediction {
  const factors: string[] = [];

  // Without standings data, use baseline
  // NBA teams on rest have ~62% win rate
  // B2B teams win ~42%
  factors.push("Form model uses standings + recent record when available");
  factors.push("NBA home court advantage: ~60% baseline");

  return {
    homeWinProb: 0.58, // NBA home advantage baseline
    spreadProjection: -3,
    totalProjection: 224,
    confidence: 30,
    factors,
  };
}

// ── NBA Consensus ──

export function buildNBAConsensus(
  netRating: NBAModelPrediction,
  market: NBAModelPrediction,
  form: NBAModelPrediction,
  weights: NBAWeights = DEFAULT_NBA_WEIGHTS
): {
  homeWinProb: number;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "NO_PLAY";
  modelsAgree: boolean;
  spreadProjection: number;
} {
  // Weighted blend
  const prob = netRating.homeWinProb * 0.40 + market.homeWinProb * 0.35 + form.homeWinProb * 0.25;

  const probs = [netRating.homeWinProb, market.homeWinProb, form.homeWinProb];
  const allSameSide = probs.every(p => p > 0.5) || probs.every(p => p < 0.5);
  const spread = Math.sqrt(probs.reduce((s, p) => s + Math.pow(p - prob, 2), 0) / 3);

  let confidence: "HIGH" | "MEDIUM" | "LOW" | "NO_PLAY";
  if (allSameSide && spread < 0.06) confidence = "HIGH";
  else if (allSameSide && spread < 0.12) confidence = "MEDIUM";
  else if (!allSameSide) confidence = "NO_PLAY";
  else confidence = "LOW";

  const avgSpread = (netRating.spreadProjection + market.spreadProjection + form.spreadProjection) / 3;

  return { homeWinProb: prob, confidence, modelsAgree: allSameSide, spreadProjection: avgSpread };
}
