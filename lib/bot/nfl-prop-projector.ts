// ──────────────────────────────────────────────────────────
// NFL Prop Projector
// Combines: season avg, last-5 form, opponent positional defense,
// weather, rest days, home/away, injury risk.
// Outputs projected stat value + probability over/under the line.
// ──────────────────────────────────────────────────────────

import type { NFLPropWeights } from "./nfl-prop-brain";
import type { NFLStarPlayer } from "@/lib/nfl/star-fallback";
import { getNFLDefVsPosition, getPositionForMarket } from "@/lib/nfl/position-defense";
import type { NFLWeather } from "@/lib/nfl/weather";
import type { NFLRestState } from "@/lib/nfl/rest-days";

export interface NFLProjectionContext {
  oppAbbrev: string;
  isHome: boolean;
  weather: NFLWeather | null;
  rest: NFLRestState | null;
  injuryFactor: number; // 1 = healthy, 0.85 = QB or top OL banged up
  pace: number;         // sec/play (lower = faster pace, more plays)
}

export interface NFLProjFactor {
  name: keyof NFLPropWeights;
  signal: number;      // -1 to +1
  contribution: number; // signal * weight
  direction: "over" | "under" | "neutral";
  explanation: string;
}

export interface NFLProjection {
  projectedValue: number;
  side: "over" | "under";
  probability: number;
  confidence: number;
  factors: NFLProjFactor[];
}

function getBaselineForMarket(player: NFLStarPlayer, market: string): number {
  switch (market) {
    case "player_pass_yds": return player.passYds ?? 0;
    case "player_pass_tds": return player.passTds ?? 0;
    case "player_pass_attempts": return player.passAttempts ?? 0;
    case "player_rush_yds": return player.rushYds ?? 0;
    case "player_rush_attempts": return player.rushAttempts ?? 0;
    case "player_receptions": return player.receptions ?? 0;
    case "player_reception_yds": return player.receivingYds ?? 0;
    case "player_anytime_td": return 0.5; // baseline TD prob
  }
  return 0;
}

export function projectNFLProp(
  player: NFLStarPlayer,
  market: string,
  line: number,
  weights: NFLPropWeights,
  context: NFLProjectionContext,
  last5Avg?: number,
): NFLProjection | null {
  const seasonAvg = getBaselineForMarket(player, market);
  if (seasonAvg <= 0) return null;

  const factors: NFLProjFactor[] = [];

  // 1. Season average signal: line vs seasonAvg
  const seasonDelta = (seasonAvg - line) / Math.max(line, 1);
  const seasonSignal = Math.max(-1, Math.min(1, seasonDelta));
  factors.push({
    name: "seasonAverage",
    signal: seasonSignal,
    contribution: seasonSignal * weights.seasonAverage,
    direction: seasonSignal > 0.05 ? "over" : seasonSignal < -0.05 ? "under" : "neutral",
    explanation: `Season avg ${seasonAvg.toFixed(1)} vs line ${line}`,
  });

  // 2. Last 5 form
  if (last5Avg !== undefined && last5Avg > 0) {
    const formDelta = (last5Avg - seasonAvg) / Math.max(seasonAvg, 1);
    const formSignal = Math.max(-1, Math.min(1, formDelta * 2));
    factors.push({
      name: "last5Avg",
      signal: formSignal,
      contribution: formSignal * weights.last5Avg,
      direction: formSignal > 0.05 ? "over" : formSignal < -0.05 ? "under" : "neutral",
      explanation: `Last 5 avg ${last5Avg.toFixed(1)} ${formSignal > 0 ? "hot" : "cold"}`,
    });
  }

  // 3. Opponent positional defense
  let posOverride = getPositionForMarket(market);
  if (player.position === "TE" && market.includes("reception")) posOverride = "TE";
  const oppDef = getNFLDefVsPosition(context.oppAbbrev, posOverride);
  // 50 = neutral. >50 = weak defense → over, <50 = strong defense → under
  const defSignal = (oppDef - 50) / 20;
  factors.push({
    name: "oppDefVsPosition",
    signal: Math.max(-1, Math.min(1, defSignal)),
    contribution: defSignal * weights.oppDefVsPosition,
    direction: defSignal > 0.1 ? "over" : defSignal < -0.1 ? "under" : "neutral",
    explanation: `${context.oppAbbrev} D vs ${posOverride}: ${oppDef}/100 (50 = avg)`,
  });

  // 4. Weather (passing markets only)
  if (context.weather && market.startsWith("player_pass")) {
    const weatherPenalty = context.weather.passingPenalty / 100;
    const weatherSignal = -weatherPenalty * 1.5; // negative for passing yards
    factors.push({
      name: "weather",
      signal: Math.max(-1, weatherSignal),
      contribution: weatherSignal * weights.weather,
      direction: weatherSignal < -0.05 ? "under" : "neutral",
      explanation: context.weather.indoor
        ? "Indoor — no weather impact"
        : `${context.weather.tempF}°F, wind ${context.weather.windMph}mph${context.weather.conditions !== "Clear" ? `, ${context.weather.conditions}` : ""}`,
    });
  } else if (context.weather && market.startsWith("player_rush")) {
    // Bad weather helps run game slightly
    const weatherPenalty = context.weather.passingPenalty / 100;
    const weatherSignal = weatherPenalty * 0.5;
    factors.push({
      name: "weather",
      signal: Math.min(1, weatherSignal),
      contribution: weatherSignal * weights.weather,
      direction: weatherSignal > 0.05 ? "over" : "neutral",
      explanation: context.weather.indoor ? "Indoor" : `Outdoor — run game boost from ${context.weather.conditions}`,
    });
  }

  // 5. Rest days
  if (context.rest) {
    const restSignal = context.rest.edge / 0.06; // normalize ±4-5% to ±1
    factors.push({
      name: "restDays",
      signal: Math.max(-1, Math.min(1, restSignal)),
      contribution: restSignal * weights.restDays,
      direction: context.rest.isPostBye ? "over" : context.rest.isShortWeek ? "under" : "neutral",
      explanation: context.rest.factors[0] ?? "",
    });
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

  // 7. Injury risk
  const injurySignal = (context.injuryFactor - 1) * 2; // -0.3 if 0.85
  if (Math.abs(injurySignal) > 0.05) {
    factors.push({
      name: "injuryRisk",
      signal: Math.max(-1, injurySignal),
      contribution: injurySignal * weights.injuryRisk,
      direction: injurySignal < 0 ? "under" : "neutral",
      explanation: `Team injury impact: ${(context.injuryFactor * 100).toFixed(0)}% healthy`,
    });
  }

  // 8. Pace (faster pace = more plays = more counting stats)
  const paceSignal = (27.5 - context.pace) / 3; // baseline 27.5 sec/play; faster → +
  if (Math.abs(paceSignal) > 0.05) {
    factors.push({
      name: "paceContext",
      signal: Math.max(-1, Math.min(1, paceSignal)),
      contribution: paceSignal * weights.paceContext,
      direction: paceSignal > 0.05 ? "over" : "neutral",
      explanation: `Pace ${context.pace.toFixed(1)}s/play (avg 27.5)`,
    });
  }

  // Sum contributions
  const totalContribution = factors.reduce((s, f) => s + f.contribution, 0);
  // Adjust projection by 25% of the contribution at scale
  const projectedValue = Math.max(0, seasonAvg * (1 + totalContribution * 0.25));

  // Probability of over
  const stdDev = Math.max(seasonAvg * 0.30, 1);
  const z = (projectedValue - line) / stdDev;
  const probOver = 1 / (1 + Math.exp(-z * 2));
  const side: "over" | "under" = probOver >= 0.5 ? "over" : "under";
  const probability = side === "over" ? probOver : 1 - probOver;

  // Confidence: how strong is the signal? (Total contribution magnitude * 100)
  const confidence = Math.min(100, Math.max(10, Math.abs(totalContribution) * 200));

  return {
    projectedValue: Math.round(projectedValue * 10) / 10,
    side,
    probability: Math.round(probability * 1000) / 1000,
    confidence: Math.round(confidence),
    factors,
  };
}
