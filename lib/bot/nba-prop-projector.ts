// ──────────────────────────────────────────────────────────
// NBA PROP PROJECTOR — Factor-Based Prediction Engine
// Produces probability + factor trace for every prop
// ──────────────────────────────────────────────────────────

import type { NbaPropWeights } from "./nba-prop-brain";
import type { RefereeData } from "@/lib/nba/referees";
import { aggregateCrew } from "@/lib/nba/referees";

export interface ProjectionContext {
  isHome: boolean;
  isB2B: boolean;
  restDays?: number;            // 0 = B2B, 1 = normal, 2+ = well-rested
  opponentDefRank?: number;     // 1-30 (1 = best defense)
  projectedGameTotal?: number;  // from NBA engine consensus
  leagueAvgTotal?: number;      // ~224
  eloGap?: number;              // home Elo - away Elo (blowout risk)
  lineOpenVsCurrent?: number;   // positive = line moved up (sharp over)
  refCrew?: RefereeData[];      // game officials — boosts FT-related props
}

export interface ProjectionFactor {
  name: keyof NbaPropWeights;
  signal: number;         // -1 (strong under) to +1 (strong over)
  contribution: number;   // signal * weight (the actual impact)
}

export interface PropProjection {
  side: "over" | "under";
  probability: number;    // 0-1
  confidence: number;     // 0-100
  factors: ProjectionFactor[];
  projectedValue: number; // brain's estimated actual stat
  reasoning?: string[];   // human-readable notes (e.g. ref crew impact)
}

// ── Normal CDF approximation (same approach as player-stats.ts) ──
function normalCDF(z: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1.0 + sign * y);
}

// Prop type to stat key mapping
const PROP_TO_STAT: Record<string, string> = {
  player_points: "ppg",
  player_rebounds: "rpg",
  player_assists: "apg",
  player_threes: "tpm",
  player_points_rebounds_assists: "pra",
};

// ── Main Projection Function ──
export interface RecentFormData {
  last5Avg: number;    // average of last 5 games for this stat
  last10Avg: number;   // average of last 10 games
  seasonAvg: number;   // full season average
  gamesPlayed: number; // total games so far
  variance: number;    // standard deviation of last 10 games (consistency)
}

export function projectProp(
  playerStats: { ppg?: number; rpg?: number; apg?: number; tpm?: number },
  propType: string,
  line: number,
  weights: NbaPropWeights,
  context: ProjectionContext,
  recentForm?: RecentFormData
): PropProjection {
  const statKey = PROP_TO_STAT[propType] ?? "ppg";
  let avg: number;

  if (statKey === "pra") {
    avg = (playerStats.ppg ?? 0) + (playerStats.rpg ?? 0) + (playerStats.apg ?? 0);
  } else {
    avg = (playerStats as any)[statKey] ?? 0;
  }

  if (avg <= 0) avg = line; // fallback to line if no data

  // Standard deviation: use real variance if available, else ~30% of average
  const stdDev = recentForm?.variance && recentForm.variance > 0
    ? recentForm.variance
    : Math.max(avg * 0.30, 1.0);
  const factors: ProjectionFactor[] = [];

  // ── Factor 1: Season Average ──
  const avgSignal = Math.max(-1, Math.min(1, (avg - line) / stdDev));
  factors.push({ name: "seasonAverage", signal: avgSignal, contribution: avgSignal * weights.seasonAverage });

  // ── Factor 2: Recent Form ──
  let formSignal: number;
  if (recentForm && recentForm.gamesPlayed >= 5) {
    // Real data: compare last 5 games to season average
    formSignal = Math.max(-1, Math.min(1, (recentForm.last5Avg - recentForm.seasonAvg) / stdDev));
    // Bonus: if last 5 is trending way above season avg, strong over signal
    if (recentForm.last5Avg > recentForm.seasonAvg * 1.15) formSignal = Math.min(1, formSignal + 0.2);
    if (recentForm.last5Avg < recentForm.seasonAvg * 0.85) formSignal = Math.max(-1, formSignal - 0.2);
  } else {
    // No game log: approximate from season average vs line
    formSignal = avgSignal * 0.7;
  }
  factors.push({ name: "recentForm", signal: formSignal, contribution: formSignal * weights.recentForm });

  // ── Factor 3: Matchup Defense ──
  let defSignal = 0;
  if (context.opponentDefRank !== undefined) {
    // Rank 1-10 = tough defense (under signal), 21-30 = weak defense (over signal)
    defSignal = (context.opponentDefRank - 15.5) / 15; // normalize to roughly -1 to +1
  }
  factors.push({ name: "matchupDefense", signal: defSignal, contribution: defSignal * weights.matchupDefense });

  // ── Factor 4: Home/Away ──
  // Home players average ~1.5 more PPG, ~0.3 more RPG, ~0.2 more APG
  const homeBoost: Record<string, number> = { ppg: 1.5, rpg: 0.3, apg: 0.2, tpm: 0.2, pra: 2.0 };
  const boost = homeBoost[statKey] ?? 1.0;
  const homeSignal = context.isHome ? (boost / stdDev) : -(boost / stdDev);
  factors.push({ name: "homeAway", signal: Math.max(-1, Math.min(1, homeSignal)), contribution: Math.max(-1, Math.min(1, homeSignal)) * weights.homeAway });

  // ── Factor 5: Rest/Schedule ──
  let restSignal = 0;
  if (context.isB2B) {
    // B2B: ~8% reduction in scoring
    restSignal = -(avg * 0.08) / stdDev;
  } else if (context.restDays !== undefined && context.restDays >= 3) {
    // Well-rested: slight boost
    restSignal = (avg * 0.03) / stdDev;
  }
  factors.push({ name: "restSchedule", signal: Math.max(-1, Math.min(1, restSignal)), contribution: Math.max(-1, Math.min(1, restSignal)) * weights.restSchedule });

  // ── Factor 6: Pace Context ──
  let paceSignal = 0;
  if (context.projectedGameTotal && context.leagueAvgTotal) {
    // Higher game total = more possessions = more stats
    const paceBoost = (context.projectedGameTotal - context.leagueAvgTotal) / context.leagueAvgTotal;
    paceSignal = paceBoost * 3; // scale up: 5% pace increase ≈ 0.15 signal
  }
  // Blowout risk: big Elo gap = starters sit early = under signal
  if (context.eloGap !== undefined && Math.abs(context.eloGap) > 150) {
    paceSignal -= 0.3; // starters get reduced minutes in blowouts
  }
  factors.push({ name: "paceContext", signal: Math.max(-1, Math.min(1, paceSignal)), contribution: Math.max(-1, Math.min(1, paceSignal)) * weights.paceContext });

  // ── Factor 7: Line Movement ──
  let lineSignal = 0;
  if (context.lineOpenVsCurrent !== undefined && context.lineOpenVsCurrent !== 0) {
    // Positive = line moved up (sharp money on over)
    lineSignal = Math.max(-1, Math.min(1, context.lineOpenVsCurrent / 3));
  }
  factors.push({ name: "lineMovement", signal: lineSignal, contribution: lineSignal * weights.lineMovement });

  // ── Weighted Sum → Probability ──
  const weightedSum = factors.reduce((s, f) => s + f.contribution, 0);

  // Convert weighted signal to adjusted z-score
  let adjustedAvg = avg + weightedSum * stdDev;

  // ── Referee Crew Boost (FT-affected props) ──
  // High-foul crews boost points/PRA via free throws (~75% of FTA convert).
  // No effect on rebounds/assists/threes (FT outcomes don't change those).
  const reasoning: string[] = [];
  if (context.refCrew && context.refCrew.length > 0 && (statKey === "ppg" || statKey === "pra")) {
    const crew = aggregateCrew(context.refCrew);
    const ftaDelta = crew.ftAttemptsBoost - 46; // league avg combined FTA/G
    if (Math.abs(ftaDelta) >= 1) {
      // Roughly 8% of a team's FTA goes to one star * 0.75 conversion
      // ftaDelta is for both teams, so per-player share ≈ ftaDelta * 0.04 pts
      const ptsImpact = ftaDelta * 0.04;
      adjustedAvg += ptsImpact;
      const dir = ptsImpact > 0 ? "+" : "";
      reasoning.push(
        `Refs ${crew.names.slice(0, 3).join(", ")} (${crew.foulRatePerGame.toFixed(0)} fouls/G): ${dir}${ptsImpact.toFixed(2)} pts FT impact`
      );
    } else {
      reasoning.push(`Refs ${crew.names.slice(0, 3).join(", ")}: neutral FT impact`);
    }
  }

  const zScore = (adjustedAvg - line) / stdDev;
  const overProb = normalCDF(zScore);

  // Clamp probability to [0.05, 0.95]
  const clampedOverProb = Math.max(0.05, Math.min(0.95, overProb));

  const side: "over" | "under" = clampedOverProb >= 0.5 ? "over" : "under";
  const probability = side === "over" ? clampedOverProb : 1 - clampedOverProb;

  // Confidence: how far from 50/50
  const confidence = Math.min(95, Math.round(Math.abs(probability - 0.5) * 200));

  return {
    side,
    probability: Math.round(probability * 1000) / 1000,
    confidence,
    factors,
    projectedValue: Math.round(adjustedAvg * 10) / 10,
    reasoning: reasoning.length > 0 ? reasoning : undefined,
  };
}
