// ──────────────────────────────────────────────────────────
// NHL Prop Projector
// Factors: season avg, last-10 form, opp pos defense, goalie matchup,
// fatigue (B2B/travel), home/away, injury, power play context.
// ──────────────────────────────────────────────────────────

import type { NHLPropWeights } from "./nhl-prop-brain";
import type { NHLStarPlayer } from "@/lib/nhl/star-fallback";
import { getNHLDefVsPosition, getNHLDefVsShots, getNHLPowerPlayGiven } from "@/lib/nhl/position-defense";
import type { NHLFatigueState } from "@/lib/nhl/rest-fatigue";

export interface NHLProjectionContext {
  oppAbbrev: string;
  isHome: boolean;
  fatigue: NHLFatigueState | null;
  injuryFactor: number;
  oppGoalieSavePct: number; // 0.900-0.925
  oppPK: number;            // opponent penalty kill %
  ownPP: number;            // own team's power play %
}

export interface NHLProjFactor {
  name: keyof NHLPropWeights;
  signal: number;
  contribution: number;
  direction: "over" | "under" | "neutral";
  explanation: string;
}

export interface NHLProjection {
  projectedValue: number;
  side: "over" | "under";
  probability: number;
  confidence: number;
  factors: NHLProjFactor[];
}

function getBaselineForMarket(p: NHLStarPlayer, market: string): number {
  switch (market) {
    case "player_points": return p.pointsPerGame ?? 0;
    case "player_goals": return p.goalsPerGame ?? 0;
    case "player_assists": return p.assistsPerGame ?? 0;
    case "player_shots_on_goal": return p.shotsPerGame ?? 0;
    case "player_total_saves": return p.savesPerGame ?? 0;
  }
  return 0;
}

export function projectNHLProp(
  player: NHLStarPlayer,
  market: string,
  line: number,
  weights: NHLPropWeights,
  context: NHLProjectionContext,
  last10Avg?: number,
): NHLProjection | null {
  const seasonAvg = getBaselineForMarket(player, market);
  if (seasonAvg <= 0) return null;

  const factors: NHLProjFactor[] = [];

  // 1. Season average
  const seasonDelta = (seasonAvg - line) / Math.max(line, 0.5);
  const seasonSignal = Math.max(-1, Math.min(1, seasonDelta));
  factors.push({
    name: "seasonAverage",
    signal: seasonSignal,
    contribution: seasonSignal * weights.seasonAverage,
    direction: seasonSignal > 0.05 ? "over" : seasonSignal < -0.05 ? "under" : "neutral",
    explanation: `Season avg ${seasonAvg.toFixed(2)} vs line ${line}`,
  });

  // 2. Last 10
  if (last10Avg !== undefined && last10Avg > 0) {
    const formDelta = (last10Avg - seasonAvg) / Math.max(seasonAvg, 0.5);
    const formSignal = Math.max(-1, Math.min(1, formDelta * 1.5));
    factors.push({
      name: "last10Avg",
      signal: formSignal,
      contribution: formSignal * weights.last10Avg,
      direction: formSignal > 0.05 ? "over" : formSignal < -0.05 ? "under" : "neutral",
      explanation: `Last 10 avg ${last10Avg.toFixed(2)} ${formSignal > 0 ? "hot" : "cold"}`,
    });
  }

  // 3. Opponent positional defense
  const pos = player.position;
  const oppDef = pos === "G" ? getNHLDefVsShots(context.oppAbbrev) : getNHLDefVsPosition(context.oppAbbrev, pos);
  const defSignal = (oppDef - 50) / 20;
  factors.push({
    name: "oppDefVsPosition",
    signal: Math.max(-1, Math.min(1, defSignal)),
    contribution: defSignal * weights.oppDefVsPosition,
    direction: defSignal > 0.1 ? "over" : defSignal < -0.1 ? "under" : "neutral",
    explanation: `${context.oppAbbrev} D vs ${pos === "G" ? "shots" : pos}: ${oppDef}/100`,
  });

  // 4. Goalie matchup (for non-goalies: facing tough goalie = lower scoring props)
  if (pos !== "G" && (market === "player_points" || market === "player_goals" || market === "player_assists")) {
    // Average goalie SV% is ~0.910. Top-tier 0.920+. Below avg 0.900.
    const goalieEdge = (0.910 - context.oppGoalieSavePct) * 50; // -0.5 to +0.5
    factors.push({
      name: "goalieMatchup",
      signal: Math.max(-1, Math.min(1, goalieEdge)),
      contribution: goalieEdge * weights.goalieMatchup,
      direction: goalieEdge < -0.05 ? "under" : goalieEdge > 0.05 ? "over" : "neutral",
      explanation: `Opp goalie SV% ${(context.oppGoalieSavePct * 100).toFixed(1)}% (avg 91.0)`,
    });
  } else if (pos === "G" && market === "player_total_saves") {
    // Facing high-shot team = more saves
    const shotsAllowSignal = (oppDef - 50) / 20;
    factors.push({
      name: "goalieMatchup",
      signal: shotsAllowSignal,
      contribution: shotsAllowSignal * weights.goalieMatchup,
      direction: shotsAllowSignal > 0.1 ? "over" : "neutral",
      explanation: `Facing ${context.oppAbbrev} (${oppDef}/100 shot generation)`,
    });
  }

  // 5. Fatigue (B2B, travel, 3-in-4)
  if (context.fatigue) {
    const fatigueSignal = context.fatigue.fatigueEdge / 0.08;
    if (Math.abs(fatigueSignal) > 0.05) {
      factors.push({
        name: "fatigue",
        signal: Math.max(-1, Math.min(1, fatigueSignal)),
        contribution: fatigueSignal * weights.fatigue,
        direction: context.fatigue.isBackToBack ? "under" : context.fatigue.daysOfRest >= 3 ? "over" : "neutral",
        explanation: context.fatigue.factors[0] ?? "",
      });
    }
  }

  // 6. Home / away
  const homeSignal = context.isHome ? 0.1 : -0.1;
  factors.push({
    name: "homeAway",
    signal: homeSignal,
    contribution: homeSignal * weights.homeAway,
    direction: context.isHome ? "over" : "under",
    explanation: context.isHome ? "Home game" : "Road game",
  });

  // 7. Injury impact
  const injurySignal = (context.injuryFactor - 1) * 2;
  if (Math.abs(injurySignal) > 0.05) {
    factors.push({
      name: "injuryRisk",
      signal: Math.max(-1, injurySignal),
      contribution: injurySignal * weights.injuryRisk,
      direction: injurySignal < 0 ? "under" : "neutral",
      explanation: `Team injuries: ${(context.injuryFactor * 100).toFixed(0)}% healthy`,
    });
  }

  // 8. Power play context (own PP% * opp PK weakness)
  if (pos !== "G") {
    const ppEdge = ((context.ownPP - 20) / 8) - ((context.oppPK - 80) / 8); // both in pct
    factors.push({
      name: "powerPlayContext",
      signal: Math.max(-1, Math.min(1, ppEdge / 2)),
      contribution: (ppEdge / 2) * weights.powerPlayContext,
      direction: ppEdge > 0.2 ? "over" : ppEdge < -0.2 ? "under" : "neutral",
      explanation: `Own PP ${context.ownPP.toFixed(1)}% vs ${context.oppAbbrev} PK ${context.oppPK.toFixed(1)}%`,
    });
  }

  // Sum and project
  const totalContribution = factors.reduce((s, f) => s + f.contribution, 0);
  const projectedValue = Math.max(0, seasonAvg * (1 + totalContribution * 0.30));

  // Probability via gaussian-ish
  const stdDev = Math.max(seasonAvg * 0.40, 0.3);
  const z = (projectedValue - line) / stdDev;
  const probOver = 1 / (1 + Math.exp(-z * 1.8));
  const side: "over" | "under" = probOver >= 0.5 ? "over" : "under";
  const probability = side === "over" ? probOver : 1 - probOver;
  const confidence = Math.min(100, Math.max(10, Math.abs(totalContribution) * 220));

  return {
    projectedValue: Math.round(projectedValue * 100) / 100,
    side,
    probability: Math.round(probability * 1000) / 1000,
    confidence: Math.round(confidence),
    factors,
  };
}
