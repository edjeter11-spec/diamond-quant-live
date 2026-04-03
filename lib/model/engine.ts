// ──────────────────────────────────────────────────────────
// Diamond-Quant Live — Core Quantitative Engine
// Live win probability modeling with dynamic weight shifts
// ──────────────────────────────────────────────────────────

import type { TeamStats, GameState, WeatherData, UmpireData, PitcherStats } from "./types";

interface ModelWeights {
  pitching: number;
  hitting: number;
  bullpen: number;
  defense: number;
  baserunning: number;
  weather: number;
  umpire: number;
  momentum: number;
}

const BASE_WEIGHTS: ModelWeights = {
  pitching: 0.28,
  hitting: 0.22,
  bullpen: 0.12,
  defense: 0.08,
  baserunning: 0.05,
  weather: 0.08,
  umpire: 0.07,
  momentum: 0.10,
};

// Dynamic weight adjustment based on game state
function getDynamicWeights(gameState: GameState): ModelWeights {
  const w = { ...BASE_WEIGHTS };
  const { inning, outs, runners, homeScore, visitorScore } = gameState;
  const scoreDiff = Math.abs(homeScore - visitorScore);

  // Late innings: bullpen becomes king
  if (inning >= 7) {
    w.pitching = 0.05;
    w.bullpen = 0.40;
    w.momentum = 0.15;
  } else if (inning >= 5) {
    w.pitching = 0.15;
    w.bullpen = 0.25;
    w.momentum = 0.12;
  }

  // Close game: defense and baserunning matter more
  if (scoreDiff <= 2) {
    w.defense += 0.05;
    w.baserunning += 0.05;
    w.hitting -= 0.05;
    w.weather -= 0.05;
  }

  // Blowout: regression toward mean, less variance
  if (scoreDiff >= 6) {
    w.momentum = 0.02;
    w.weather = 0.02;
    w.umpire = 0.02;
  }

  // Runners on base: hitting and baserunning spike
  const runnersOn = [runners.first, runners.second, runners.third].filter(Boolean).length;
  if (runnersOn >= 2) {
    w.hitting += 0.05;
    w.baserunning += 0.03;
    w.pitching -= 0.04;
    w.defense -= 0.04;
  }

  // Normalize weights to sum to 1.0
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  for (const key of Object.keys(w) as (keyof ModelWeights)[]) {
    w[key] /= total;
  }

  return w;
}

// Pitcher fatigue model
function calculateFatigue(pitcher: PitcherStats): number {
  const baseFatigue = Math.min(pitcher.pitchCount / 110, 1.0);
  // Velocity drop correlates with fatigue
  const velocityDrop = Math.max(0, (94 - pitcher.velocity) / 10);
  return Math.min(1.0, baseFatigue * 0.7 + velocityDrop * 0.3);
}

// Weather impact on scoring
function weatherImpact(weather?: WeatherData): { hitting: number; pitching: number } {
  if (!weather || weather.roofClosed) return { hitting: 0, pitching: 0 };

  let hittingBoost = 0;
  let pitchingBoost = 0;

  // Temperature: hot = more runs
  if (weather.temperature > 85) hittingBoost += 0.08;
  else if (weather.temperature < 55) pitchingBoost += 0.08;

  // Wind blowing out = more HRs
  if (weather.windDirection === "out" && weather.windSpeed > 10) {
    hittingBoost += 0.06 * (weather.windSpeed / 20);
  } else if (weather.windDirection === "in" && weather.windSpeed > 10) {
    pitchingBoost += 0.06 * (weather.windSpeed / 20);
  }

  // Humidity: higher = ball carries more
  if (weather.humidity > 70) hittingBoost += 0.03;

  return { hitting: hittingBoost, pitching: pitchingBoost };
}

// Umpire tendency adjustment
function umpireImpact(umpire?: UmpireData): { strikezone: number } {
  if (!umpire) return { strikezone: 0 };
  // Tight zone = more walks = more runs
  const zoneDeviation = (umpire.runScoringIndex - 8.5) / 8.5; // 8.5 runs avg
  return { strikezone: zoneDeviation * 0.1 };
}

// Calculate momentum score based on score and inning
function calculateMomentum(gameState: GameState): { home: number; away: number } {
  const { homeScore, visitorScore, inning, halfInning } = gameState;
  const scoreDiff = homeScore - visitorScore;

  // Home team has inherent late-inning advantage (last at-bats)
  let homeBonus = inning >= 7 ? 0.03 : 0;
  if (halfInning === "bottom") homeBonus += 0.02;

  // Leading team momentum scales with inning
  const leadFactor = (scoreDiff / 10) * (inning / 9);

  return {
    home: 0.5 + leadFactor + homeBonus,
    away: 0.5 - leadFactor - homeBonus,
  };
}

// Win probability based on score differential and innings remaining
function scoreBasedWinProb(gameState: GameState): number {
  const { homeScore, visitorScore, inning, halfInning, outs } = gameState;
  const scoreDiff = homeScore - visitorScore;

  // Total half-innings remaining (18 total in regulation)
  const totalHalfInnings = 18;
  const completedHalfInnings = (inning - 1) * 2 + (halfInning === "bottom" ? 1 : 0);
  const outsCompleted = completedHalfInnings * 3 + outs;
  const totalOuts = totalHalfInnings * 3;
  const gameProgress = outsCompleted / totalOuts; // 0 to 1

  // Base probability from logistic function
  // As game progresses, same run lead = higher win prob
  const k = 0.4 + gameProgress * 1.2; // steepness increases
  const baseProb = 1 / (1 + Math.exp(-k * scoreDiff));

  return baseProb;
}

// ──────────────────────────────────────────────────────────
// MAIN ENGINE: Calculate live edge
// ──────────────────────────────────────────────────────────
export function calculateLiveEdge(
  home: TeamStats,
  away: TeamStats,
  gameState: GameState,
  weather?: WeatherData,
  umpire?: UmpireData
): number {
  const weights = getDynamicWeights(gameState);
  const wxImpact = weatherImpact(weather);
  const umpImpact = umpireImpact(umpire);
  const momentum = calculateMomentum(gameState);

  // Pitcher fatigue adjustments
  const homeFatigue = calculateFatigue(gameState.homePitcher);
  const awayFatigue = calculateFatigue(gameState.visitorPitcher);

  // Composite scores
  const homeComposite =
    (home.pitching * (1 - homeFatigue) * weights.pitching) +
    ((home.hitting + wxImpact.hitting * 100) * weights.hitting) +
    (home.bullpen * weights.bullpen) +
    (home.defense * weights.defense) +
    (home.baserunning * weights.baserunning) +
    (umpImpact.strikezone * 50 * weights.umpire) +
    (momentum.home * 100 * weights.momentum) +
    (wxImpact.pitching * 100 * weights.weather);

  const awayComposite =
    (away.pitching * (1 - awayFatigue) * weights.pitching) +
    ((away.hitting + wxImpact.hitting * 100) * weights.hitting) +
    (away.bullpen * weights.bullpen) +
    (away.defense * weights.defense) +
    (away.baserunning * weights.baserunning) +
    (-umpImpact.strikezone * 50 * weights.umpire) +
    (momentum.away * 100 * weights.momentum) +
    (wxImpact.pitching * 100 * weights.weather);

  // Raw model probability
  const modelProb = 1 / (1 + Math.exp(-(homeComposite - awayComposite) / 15));

  // If game is live, blend with score-based probability
  if (gameState.isLive && gameState.inning > 0) {
    const scoreProb = scoreBasedWinProb(gameState);
    const gameProgress = Math.min(gameState.inning / 9, 1);

    // As game progresses, actual score matters more than model
    const blendFactor = gameProgress * 0.7;
    return scoreProb * blendFactor + modelProb * (1 - blendFactor);
  }

  // Home field advantage for pre-game: ~54%
  return modelProb * 0.96 + 0.04;
}

// Explain why the model likes a bet
export function generateReasoning(
  home: TeamStats,
  away: TeamStats,
  gameState: GameState,
  weather?: WeatherData,
  umpire?: UmpireData
): string[] {
  const reasons: string[] = [];
  const homeFatigue = calculateFatigue(gameState.homePitcher);
  const awayFatigue = calculateFatigue(gameState.visitorPitcher);

  if (homeFatigue > 0.6) {
    reasons.push(`${gameState.homePitcher.name} showing fatigue (${gameState.homePitcher.pitchCount} pitches, velocity down)`);
  }
  if (awayFatigue > 0.6) {
    reasons.push(`${gameState.visitorPitcher.name} showing fatigue (${gameState.visitorPitcher.pitchCount} pitches, velocity down)`);
  }

  if (home.bullpen > away.bullpen + 15) {
    reasons.push(`${home.name} bullpen significantly stronger (${home.bullpen} vs ${away.bullpen})`);
  } else if (away.bullpen > home.bullpen + 15) {
    reasons.push(`${away.name} bullpen significantly stronger (${away.bullpen} vs ${home.bullpen})`);
  }

  if (home.hitting > away.hitting + 10) {
    reasons.push(`${home.name} offense is hot (hitting rating ${home.hitting} vs ${away.hitting})`);
  } else if (away.hitting > home.hitting + 10) {
    reasons.push(`${away.name} offense is hot (hitting rating ${away.hitting} vs ${home.hitting})`);
  }

  if (weather && !weather.roofClosed) {
    if (weather.windDirection === "out" && weather.windSpeed > 10) {
      reasons.push(`Wind blowing out at ${weather.windSpeed}mph — expect more runs`);
    }
    if (weather.temperature > 85) {
      reasons.push(`Hot day (${weather.temperature}°F) — ball carries further`);
    }
  }

  if (umpire && Math.abs(umpire.runScoringIndex - 8.5) > 1) {
    const tendency = umpire.runScoringIndex > 8.5 ? "hitter-friendly" : "pitcher-friendly";
    reasons.push(`Ump ${umpire.name} is ${tendency} (${umpire.runScoringIndex} runs/game avg)`);
  }

  if (gameState.inning >= 7 && Math.abs(gameState.homeScore - gameState.visitorScore) <= 1) {
    reasons.push("Late & close — bullpen matchup is decisive");
  }

  const runnersOn = [gameState.runners.first, gameState.runners.second, gameState.runners.third].filter(Boolean).length;
  if (runnersOn >= 2 && gameState.outs < 2) {
    reasons.push(`High-leverage spot: ${runnersOn} runners on, ${gameState.outs} outs`);
  }

  if (home.recentForm > 0.7) reasons.push(`${home.name} on a heater (${(home.recentForm * 100).toFixed(0)}% last 10)`);
  if (away.recentForm > 0.7) reasons.push(`${away.name} on a heater (${(away.recentForm * 100).toFixed(0)}% last 10)`);

  return reasons.length > 0 ? reasons : ["Model sees fair value — no strong edge factors"];
}

export { getDynamicWeights, calculateFatigue, weatherImpact, umpireImpact, calculateMomentum, scoreBasedWinProb };
