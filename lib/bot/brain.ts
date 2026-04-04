// ──────────────────────────────────────────────────────────
// THE BRAIN — Persistent Model Memory
// Pre-trained on 2024+2025, learns from every game going forward
// Stores everything in localStorage as the model's "memory"
// ──────────────────────────────────────────────────────────

export interface ModelWeights {
  pitching: number;
  hitting: number;
  bullpen: number;
  defense: number;
  weather: number;
  umpire: number;
  momentum: number;
  homeField: number;
}

export interface MarketProfile {
  totalBets: number;
  wins: number;
  losses: number;
  brierScore: number;
  avgEV: number;
  dynamicThreshold: number;
  winRate: number;
}

export interface GameMemory {
  id: string;
  date: string;
  game: string;
  prediction: number;    // predicted home win prob
  actual: "home" | "away" | "tie";
  totalPredicted: number;
  totalActual: number;
  brierScore: number;
  lessonsLearned: string[];
}

export interface ModelLog {
  timestamp: string;
  type: "train" | "learn" | "adjust" | "swap" | "error";
  message: string;
  data?: any;
}

export interface BrainState {
  // Identity
  version: string;
  epoch: number;
  createdAt: string;
  lastTrainedAt: string;

  // Training data
  trainedSeasons: string[];  // ["2024", "2025"]
  totalGamesProcessed: number;
  totalPredictionsMade: number;

  // Weights
  weights: ModelWeights;
  initialWeights: ModelWeights; // for comparison

  // Market accuracy
  markets: Record<string, MarketProfile>;

  // Memory
  recentGames: GameMemory[];  // last 100 games
  logs: ModelLog[];           // last 200 log entries

  // Learning config
  learningRate: number;
  isPreTrained: boolean;
}

// Default untrained state
const DEFAULT_WEIGHTS: ModelWeights = {
  pitching: 0.28, hitting: 0.22, bullpen: 0.12, defense: 0.08,
  weather: 0.08, umpire: 0.07, momentum: 0.10, homeField: 0.05,
};

function createFreshBrain(): BrainState {
  return {
    version: "v0.0.0",
    epoch: 0,
    createdAt: new Date().toISOString(),
    lastTrainedAt: "",
    trainedSeasons: [],
    totalGamesProcessed: 0,
    totalPredictionsMade: 0,
    weights: { ...DEFAULT_WEIGHTS },
    initialWeights: { ...DEFAULT_WEIGHTS },
    markets: {
      moneyline: { totalBets: 0, wins: 0, losses: 0, brierScore: 0.25, avgEV: 0, dynamicThreshold: 1.5, winRate: 50 },
      total: { totalBets: 0, wins: 0, losses: 0, brierScore: 0.25, avgEV: 0, dynamicThreshold: 2.0, winRate: 50 },
      spread: { totalBets: 0, wins: 0, losses: 0, brierScore: 0.25, avgEV: 0, dynamicThreshold: 2.0, winRate: 50 },
      player_prop: { totalBets: 0, wins: 0, losses: 0, brierScore: 0.25, avgEV: 0, dynamicThreshold: 1.5, winRate: 50 },
    },
    recentGames: [],
    logs: [],
    learningRate: 0.02,
    isPreTrained: false,
  };
}

// ── Load / Save ──

export function loadBrain(): BrainState {
  if (typeof window === "undefined") return createFreshBrain();
  try {
    const stored = localStorage.getItem("dq_brain");
    if (stored) return JSON.parse(stored);
  } catch {}
  return createFreshBrain();
}

export function saveBrain(brain: BrainState) {
  if (typeof window === "undefined") return;
  try {
    // Trim logs and games to prevent localStorage bloat
    brain.logs = brain.logs.slice(-200);
    brain.recentGames = brain.recentGames.slice(-100);
    localStorage.setItem("dq_brain", JSON.stringify(brain));
  } catch {}
}

function addLog(brain: BrainState, type: ModelLog["type"], message: string, data?: any) {
  brain.logs.push({ timestamp: new Date().toISOString(), type, message, data });
}

function bumpVersion(brain: BrainState) {
  brain.epoch++;
  const major = 1;
  const minor = Math.floor(brain.epoch / 50);
  const patch = brain.epoch % 50;
  brain.version = `v${major}.${minor}.${patch}`;
}

// ── Pre-Training on Historical Seasons ──

export async function preTrainBrain(brain: BrainState, seasons: number[]): Promise<BrainState> {
  const MLB_API = "https://statsapi.mlb.com/api/v1";
  let updated = { ...brain };

  for (const season of seasons) {
    if (updated.trainedSeasons.includes(String(season))) {
      addLog(updated, "train", `Skipping ${season} — already trained`);
      continue;
    }

    addLog(updated, "train", `Starting training on ${season} MLB season...`);

    // Fetch in monthly chunks
    const months = season === new Date().getFullYear()
      ? Array.from({ length: new Date().getMonth() + 1 }, (_, i) => i + 1).filter(m => m >= 3)
      : [3, 4, 5, 6, 7, 8, 9, 10];

    let seasonGames = 0;
    let seasonHomeWins = 0;
    let seasonTotalOver = 0;

    for (const month of months) {
      const startDate = `${season}-${String(month).padStart(2, "0")}-01`;
      const endDay = month === 12 ? 31 : new Date(season, month, 0).getDate();
      const endDate = `${season}-${String(month).padStart(2, "0")}-${endDay}`;

      try {
        const res = await fetch(
          `${MLB_API}/schedule?sportId=1&startDate=${startDate}&endDate=${endDate}&gameType=R`
        );
        if (!res.ok) continue;
        const data = await res.json();

        for (const dateEntry of data.dates ?? []) {
          for (const game of dateEntry.games ?? []) {
            if (game.status?.statusCode !== "F") continue;

            const homeScore = game.teams?.home?.score ?? 0;
            const awayScore = game.teams?.away?.score ?? 0;
            if (homeScore === 0 && awayScore === 0) continue;

            const homeWon = homeScore > awayScore;
            const totalRuns = homeScore + awayScore;

            seasonGames++;
            if (homeWon) seasonHomeWins++;
            if (totalRuns > 8.5) seasonTotalOver++;

            // Feed moneyline result
            updated = learnFromResult(updated, {
              market: "moneyline",
              predictedProb: 0.54, // baseline home advantage
              won: homeWon,
              ev: 2.0,
            });

            // Feed total result
            updated = learnFromResult(updated, {
              market: "total",
              predictedProb: 0.50,
              won: totalRuns > 8.5,
              ev: 1.5,
            });
          }
        }
      } catch {
        addLog(updated, "error", `Failed to fetch ${season}-${month}`);
      }
    }

    updated.trainedSeasons.push(String(season));
    updated.totalGamesProcessed += seasonGames;

    const homeWinPct = seasonGames > 0 ? ((seasonHomeWins / seasonGames) * 100).toFixed(1) : "0";
    const overPct = seasonGames > 0 ? ((seasonTotalOver / seasonGames) * 100).toFixed(1) : "0";

    addLog(updated, "train",
      `Completed ${season}: ${seasonGames} games, ${homeWinPct}% home wins, ${overPct}% overs (>8.5)`,
      { seasonGames, homeWinPct, overPct }
    );
  }

  updated.isPreTrained = true;
  updated.lastTrainedAt = new Date().toISOString();
  bumpVersion(updated);
  addLog(updated, "train", `Pre-training complete. Model ${updated.version} — ${updated.totalGamesProcessed} total games processed`);

  saveBrain(updated);
  return updated;
}

// ── Core Learning Function ──

export function learnFromResult(
  brain: BrainState,
  result: { market: string; predictedProb: number; won: boolean; ev: number }
): BrainState {
  const updated = { ...brain };
  const lr = updated.learningRate;
  const outcome = result.won ? 1 : 0;
  const predicted = Math.max(0.01, Math.min(0.99, result.predictedProb));
  const brier = Math.pow(predicted - outcome, 2);

  // Update market profile
  const market = updated.markets[result.market];
  if (market) {
    market.totalBets++;
    if (result.won) market.wins++;
    else market.losses++;

    // Exponential moving average for Brier score
    const alpha = Math.min(0.1, 2 / (market.totalBets + 1));
    market.brierScore = market.brierScore * (1 - alpha) + brier * alpha;
    market.avgEV = market.avgEV * (1 - alpha) + result.ev * alpha;
    market.winRate = market.totalBets > 0 ? (market.wins / market.totalBets) * 100 : 50;

    // Dynamic threshold adjustment
    if (market.totalBets >= 20) {
      if (market.winRate > 55 && market.brierScore < 0.22) {
        market.dynamicThreshold = Math.max(0.5, market.dynamicThreshold - lr * 0.5);
      } else if (market.winRate < 45 || market.brierScore > 0.30) {
        market.dynamicThreshold = Math.min(8.0, market.dynamicThreshold + lr);
      }
    }
  }

  // Adjust weights
  const w = { ...updated.weights };
  if (!result.won && predicted > 0.6) {
    // Confident but wrong — reduce primary factors slightly
    w.pitching = Math.max(0.05, w.pitching - lr * 0.3);
    w.momentum = Math.max(0.02, w.momentum - lr * 0.2);
    w.bullpen = Math.min(0.40, w.bullpen + lr * 0.2);
    w.defense = Math.min(0.20, w.defense + lr * 0.1);
  } else if (result.won && predicted < 0.45) {
    // Upset we caught — reinforce hitting and momentum
    w.hitting = Math.min(0.35, w.hitting + lr * 0.2);
    w.momentum = Math.min(0.20, w.momentum + lr * 0.15);
  }

  // Normalize
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  for (const key of Object.keys(w) as (keyof ModelWeights)[]) {
    w[key] = w[key] / total;
  }
  updated.weights = w;

  updated.totalPredictionsMade++;
  bumpVersion(updated);
  return updated;
}

// ── Learn from a real settled game ──

export function learnFromGame(
  brain: BrainState,
  game: {
    id: string;
    date: string;
    gameName: string;
    homeWon: boolean;
    homeScore: number;
    awayScore: number;
    predictedHomeProb: number;
  }
): BrainState {
  let updated = { ...brain };
  const totalRuns = game.homeScore + game.awayScore;

  // ML lesson
  updated = learnFromResult(updated, {
    market: "moneyline",
    predictedProb: game.predictedHomeProb,
    won: game.homeWon ? game.predictedHomeProb > 0.5 : game.predictedHomeProb < 0.5,
    ev: 2.0,
  });

  // Total lesson
  updated = learnFromResult(updated, {
    market: "total",
    predictedProb: 0.50,
    won: totalRuns > 8.5,
    ev: 1.5,
  });

  // Build lessons learned
  const lessons: string[] = [];
  const wasConfident = game.predictedHomeProb > 0.6 || game.predictedHomeProb < 0.4;
  const wasRight = game.homeWon ? game.predictedHomeProb > 0.5 : game.predictedHomeProb < 0.5;

  if (wasConfident && !wasRight) {
    lessons.push(`Overconfident on ${game.gameName} — predicted ${(game.predictedHomeProb * 100).toFixed(0)}% but lost. Reducing certainty weights.`);
  } else if (!wasConfident && wasRight) {
    lessons.push(`Caught upset in ${game.gameName} — model was uncertain but correct. Reinforcing.`);
  } else if (wasConfident && wasRight) {
    lessons.push(`Strong read on ${game.gameName} — confirmed model's edge.`);
  }

  if (totalRuns > 12) lessons.push(`High-scoring game (${totalRuns} runs) — weather or bullpen factor?`);
  if (totalRuns < 4) lessons.push(`Pitchers duel (${totalRuns} runs) — may need to weight pitching higher for this matchup type.`);

  // Store in memory
  updated.recentGames.push({
    id: game.id,
    date: game.date,
    game: game.gameName,
    prediction: game.predictedHomeProb,
    actual: game.homeWon ? "home" : "away",
    totalPredicted: 8.5,
    totalActual: totalRuns,
    brierScore: Math.pow(game.predictedHomeProb - (game.homeWon ? 1 : 0), 2),
    lessonsLearned: lessons,
  });

  addLog(updated, "learn",
    `${game.gameName}: ${game.homeWon ? "Home" : "Away"} won ${game.homeScore}-${game.awayScore}. ` +
    `Model predicted ${(game.predictedHomeProb * 100).toFixed(0)}% home. ${wasRight ? "CORRECT" : "WRONG"}.`,
    { lessons }
  );

  saveBrain(updated);
  return updated;
}

// ── Get current model info ──

export function getBrainSummary(brain: BrainState) {
  const totalBets = Object.values(brain.markets).reduce((s, m) => s + m.totalBets, 0);
  const totalWins = Object.values(brain.markets).reduce((s, m) => s + m.wins, 0);
  const overallWinRate = totalBets > 0 ? (totalWins / totalBets) * 100 : 50;
  const avgBrier = Object.values(brain.markets).reduce((s, m) => s + m.brierScore, 0) / Math.max(Object.keys(brain.markets).length, 1);

  // Weight changes from initial
  const weightChanges: Record<string, number> = {};
  for (const key of Object.keys(brain.weights) as (keyof ModelWeights)[]) {
    weightChanges[key] = Math.round((brain.weights[key] - brain.initialWeights[key]) * 1000) / 10;
  }

  return {
    version: brain.version,
    epoch: brain.epoch,
    isPreTrained: brain.isPreTrained,
    trainedSeasons: brain.trainedSeasons,
    totalGamesProcessed: brain.totalGamesProcessed,
    totalPredictions: brain.totalPredictionsMade,
    overallWinRate: Math.round(overallWinRate * 10) / 10,
    avgBrier: Math.round(avgBrier * 1000) / 1000,
    markets: brain.markets,
    weights: brain.weights,
    weightChanges,
    recentLogs: brain.logs.slice(-20),
    recentGames: brain.recentGames.slice(-10),
    lastTrainedAt: brain.lastTrainedAt,
  };
}
