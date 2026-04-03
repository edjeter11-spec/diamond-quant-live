// ──────────────────────────────────────────────────────────
// Self-Learning Feedback Loop
// Adjusts model weights based on actual results
// Tracks accuracy by market, updates thresholds dynamically
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

export interface MarketAccuracy {
  market: string;
  totalBets: number;
  wins: number;
  losses: number;
  brierScore: number; // lower = more accurate
  avgEdge: number;
  dynamicThreshold: number; // auto-adjusted min EV %
}

export interface LearningState {
  version: string;         // "v1.4.2"
  epoch: number;           // how many times the model has been optimized
  gamesLearned: number;
  lastOptimized: string;
  weights: ModelWeights;
  marketAccuracy: Record<string, MarketAccuracy>;
  learningRate: number;
}

const DEFAULT_WEIGHTS: ModelWeights = {
  pitching: 0.28,
  hitting: 0.22,
  bullpen: 0.12,
  defense: 0.08,
  weather: 0.08,
  umpire: 0.07,
  momentum: 0.10,
  homeField: 0.05,
};

const DEFAULT_STATE: LearningState = {
  version: "v1.0.0",
  epoch: 0,
  gamesLearned: 0,
  lastOptimized: new Date().toISOString(),
  weights: { ...DEFAULT_WEIGHTS },
  marketAccuracy: {
    moneyline: { market: "moneyline", totalBets: 0, wins: 0, losses: 0, brierScore: 0.25, avgEdge: 0, dynamicThreshold: 1.5 },
    spread: { market: "spread", totalBets: 0, wins: 0, losses: 0, brierScore: 0.25, avgEdge: 0, dynamicThreshold: 2.0 },
    total: { market: "total", totalBets: 0, wins: 0, losses: 0, brierScore: 0.25, avgEdge: 0, dynamicThreshold: 2.0 },
    player_prop: { market: "player_prop", totalBets: 0, wins: 0, losses: 0, brierScore: 0.25, avgEdge: 0, dynamicThreshold: 1.5 },
  },
  learningRate: 0.03,
};

export function loadLearningState(): LearningState {
  if (typeof window === "undefined") return { ...DEFAULT_STATE };
  try {
    const stored = localStorage.getItem("dq_learning_state");
    if (stored) return JSON.parse(stored);
  } catch {}
  return { ...DEFAULT_STATE };
}

export function saveLearningState(state: LearningState) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem("dq_learning_state", JSON.stringify(state)); } catch {}
}

// ──────────────────────────────────────────────────────────
// CORE: Learn from a settled bet
// ──────────────────────────────────────────────────────────
export function learnFromBet(
  state: LearningState,
  bet: {
    market: string;
    fairProb: number;  // 0-1, what the model predicted
    result: "win" | "loss" | "push";
    evAtPlacement: number;
  }
): LearningState {
  if (bet.result === "push") return state;

  const outcome = bet.result === "win" ? 1 : 0;
  const predicted = Math.max(0.01, Math.min(0.99, bet.fairProb));

  // Brier Score for this bet: (prediction - outcome)^2
  const brierForBet = Math.pow(predicted - outcome, 2);

  // Get or create market accuracy
  const marketKey = bet.market || "moneyline";
  const accuracy = state.marketAccuracy[marketKey] ?? {
    market: marketKey, totalBets: 0, wins: 0, losses: 0,
    brierScore: 0.25, avgEdge: 0, dynamicThreshold: 1.5,
  };

  // Update market stats
  accuracy.totalBets += 1;
  if (outcome === 1) accuracy.wins += 1;
  else accuracy.losses += 1;

  // Rolling Brier score (exponential moving average)
  const alpha = 0.1; // smoothing factor
  accuracy.brierScore = accuracy.brierScore * (1 - alpha) + brierForBet * alpha;

  // Rolling avg edge
  accuracy.avgEdge = accuracy.avgEdge * (1 - alpha) + bet.evAtPlacement * alpha;

  // DYNAMIC THRESHOLD ADJUSTMENT
  // If accuracy is bad (high Brier), raise the threshold (need bigger edge to bet)
  // If accuracy is good (low Brier), lower the threshold (trust the model more)
  const winRate = accuracy.totalBets > 0 ? accuracy.wins / accuracy.totalBets : 0.5;
  if (accuracy.totalBets >= 5) {
    if (winRate > 0.55 && accuracy.brierScore < 0.22) {
      // Model is sharp here — lower threshold
      accuracy.dynamicThreshold = Math.max(0.5, accuracy.dynamicThreshold - state.learningRate);
    } else if (winRate < 0.45 || accuracy.brierScore > 0.30) {
      // Model is struggling — raise threshold
      accuracy.dynamicThreshold = Math.min(8.0, accuracy.dynamicThreshold + state.learningRate * 2);
    }
  }

  // WEIGHT ADJUSTMENT
  const weights = { ...state.weights };
  const lr = state.learningRate;

  if (outcome === 0) {
    // Lost: slightly reduce confidence in primary factors
    // This is a simplified gradient step — real ML would use backprop
    if (bet.fairProb > 0.6) {
      // We were confident but wrong — model was overfit on something
      weights.pitching = Math.max(0.05, weights.pitching - lr * 0.5);
      weights.momentum = Math.max(0.02, weights.momentum - lr * 0.3);
      weights.bullpen = Math.min(0.40, weights.bullpen + lr * 0.3);
    }
  } else {
    // Won: reinforce current weights slightly
    // Bigger reinforcement when we won with lower predicted probability (upset detection)
    const surprise = 1 - predicted;
    weights.hitting = Math.min(0.35, weights.hitting + lr * surprise * 0.2);
  }

  // Normalize weights
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  for (const key of Object.keys(weights) as (keyof ModelWeights)[]) {
    weights[key] = weights[key] / total;
  }

  // Bump version
  const epoch = state.epoch + 1;
  const minor = Math.floor(epoch / 10);
  const patch = epoch % 10;
  const version = `v1.${minor}.${patch}`;

  return {
    ...state,
    version,
    epoch,
    gamesLearned: state.gamesLearned + 1,
    lastOptimized: new Date().toISOString(),
    weights,
    marketAccuracy: { ...state.marketAccuracy, [marketKey]: accuracy },
  };
}

// ──────────────────────────────────────────────────────────
// Get dynamic threshold for a market
// ──────────────────────────────────────────────────────────
export function getMinEdge(state: LearningState, market: string): number {
  return state.marketAccuracy[market]?.dynamicThreshold ?? 1.5;
}

// ──────────────────────────────────────────────────────────
// Calculate CLV (Closing Line Value)
// ──────────────────────────────────────────────────────────
export function calculateCLV(
  openingOdds: number,
  closingOdds: number
): { clvPercent: number; beatClosing: boolean } {
  // Convert to implied probabilities
  const toProb = (odds: number) => odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
  const openProb = toProb(openingOdds);
  const closeProb = toProb(closingOdds);

  // CLV = how much you beat the closing line
  const clvPercent = ((closeProb - openProb) / openProb) * 100;

  return {
    clvPercent: Math.round(clvPercent * 100) / 100,
    beatClosing: clvPercent > 0,
  };
}
