// ──────────────────────────────────────────────────────────
// MLB PROP BRAIN — closed-loop learner for MLB player props.
// Tournament-evolved weights stored in Supabase under "mlb_prop_brain".
// Mirrors NBA brain structure but with MLB-specific factors.
// ──────────────────────────────────────────────────────────

export interface MLBPropWeights {
  seasonAverage: number;    // baseline per-game rate
  last10Avg: number;        // recent form (heavy in MLB — bats run hot/cold)
  homeAway: number;         // home vs away splits
  oppositionStrength: number; // opposing pitcher ERA / lineup strength
  parkFactor: number;       // ballpark hitter-friendly / pitcher-friendly
  restDays: number;         // pitcher rest, hitter back-to-back fatigue
  lineMovement: number;     // sharp money signal
}

const DEFAULT_WEIGHTS: MLBPropWeights = {
  seasonAverage: 0.22,
  last10Avg: 0.28,        // recent form heaviest — MLB is streaky
  homeAway: 0.12,
  oppositionStrength: 0.18,
  parkFactor: 0.08,
  restDays: 0.06,
  lineMovement: 0.06,
};

const WEIGHT_FLOOR = 0.03;
const WEIGHT_CEILING = 0.35;

export interface MLBMarketProfile {
  totalPredictions: number;
  hits: number;
  misses: number;
  brierScore: number;
  winRate: number;
}

function defaultMarketProfile(): MLBMarketProfile {
  return { totalPredictions: 0, hits: 0, misses: 0, brierScore: 0.25, winRate: 50 };
}

export interface MLBPlayerMemory {
  name: string;
  team: string;
  totalPredictions: number;
  hits: number;
  winRate: number;
  byPropType: Record<string, { predictions: number; hits: number; winRate: number }>;
  lastUpdated: string;
}

export interface MLBPropBrainState {
  version: string;
  epoch: number;
  createdAt: string;
  lastTrainedAt: string;
  weights: MLBPropWeights;
  initialWeights: MLBPropWeights;
  learningRate: number;
  markets: Record<string, MLBMarketProfile>;
  playerMemory: Record<string, MLBPlayerMemory>;
  totalPredictions: number;
  totalHits: number;
  isPreTrained: boolean;
  trainedSeasons: string[];
  totalGamesProcessed: number;
}

const PLAYER_CAP = 300;

export function repairWeights(w: MLBPropWeights): MLBPropWeights {
  const keys = Object.keys(w) as (keyof MLBPropWeights)[];
  // Clamp
  const clamped = { ...w };
  for (const k of keys) {
    clamped[k] = Math.max(WEIGHT_FLOOR, Math.min(WEIGHT_CEILING, clamped[k]));
  }
  // Normalize to sum to 1.0
  const sum = keys.reduce((s, k) => s + clamped[k], 0);
  if (sum > 0) {
    for (const k of keys) clamped[k] = Math.round((clamped[k] / sum) * 10000) / 10000;
  }
  return clamped;
}

export function createDefaultMLBBrain(): MLBPropBrainState {
  return {
    version: "1.0.0",
    epoch: 0,
    createdAt: new Date().toISOString(),
    lastTrainedAt: "",
    weights: { ...DEFAULT_WEIGHTS },
    initialWeights: { ...DEFAULT_WEIGHTS },
    learningRate: 0.015,
    markets: {
      pitcher_strikeouts: defaultMarketProfile(),
      pitcher_outs: defaultMarketProfile(),
      batter_hits: defaultMarketProfile(),
      batter_home_runs: defaultMarketProfile(),
      batter_total_bases: defaultMarketProfile(),
      batter_rbis: defaultMarketProfile(),
      batter_runs_scored: defaultMarketProfile(),
    },
    playerMemory: {},
    totalPredictions: 0,
    totalHits: 0,
    isPreTrained: false,
    trainedSeasons: [],
    totalGamesProcessed: 0,
  };
}

export async function loadMLBPropBrainFromCloud(): Promise<MLBPropBrainState> {
  try {
    const { cloudGet } = await import("@/lib/supabase/client");
    const data = await cloudGet<MLBPropBrainState | null>("mlb_prop_brain", null);
    if (data && data.version) return data;
  } catch {}
  return createDefaultMLBBrain();
}

export async function saveMLBPropBrainToCloud(brain: MLBPropBrainState): Promise<void> {
  try {
    const { cloudSet } = await import("@/lib/supabase/client");
    const trimmed = {
      ...brain,
      playerMemory: trimPlayerMemory(brain.playerMemory),
    };
    await cloudSet("mlb_prop_brain", trimmed);
  } catch {}
}

function trimPlayerMemory(mem: Record<string, MLBPlayerMemory>): Record<string, MLBPlayerMemory> {
  const entries = Object.entries(mem);
  if (entries.length <= PLAYER_CAP) return mem;
  entries.sort((a, b) => new Date(b[1].lastUpdated).getTime() - new Date(a[1].lastUpdated).getTime());
  const kept: Record<string, MLBPlayerMemory> = {};
  for (const [k, v] of entries.slice(0, PLAYER_CAP)) kept[k] = v;
  return kept;
}

// Learn from a graded prop result. Adjusts weights via gradient on Brier loss
// and updates player memory.
export function learnFromMLBResult(
  brain: MLBPropBrainState,
  result: {
    playerName: string;
    team: string;
    propType: string;
    predictedProb: number;
    predictedSide: "over" | "under";
    line: number;
    actualValue: number;
    hit: boolean;
    factors: Array<{ name: string; signal: number; contribution: number }>;
  },
): MLBPropBrainState {
  const updated: MLBPropBrainState = JSON.parse(JSON.stringify(brain));

  // Update market profile
  const m = updated.markets[result.propType] ?? defaultMarketProfile();
  m.totalPredictions++;
  if (result.hit) m.hits++; else m.misses++;
  m.brierScore = ((m.brierScore * (m.totalPredictions - 1)) + Math.pow(result.predictedProb - (result.hit ? 1 : 0), 2)) / m.totalPredictions;
  m.winRate = Math.round((m.hits / Math.max(m.totalPredictions, 1)) * 1000) / 10;
  updated.markets[result.propType] = m;

  // Update player memory
  const pid = result.playerName.toLowerCase().replace(/\s+/g, "_");
  const mem = updated.playerMemory[pid] ?? {
    name: result.playerName, team: result.team,
    totalPredictions: 0, hits: 0, winRate: 50,
    byPropType: {}, lastUpdated: new Date().toISOString(),
  };
  mem.totalPredictions++;
  if (result.hit) mem.hits++;
  mem.winRate = Math.round((mem.hits / mem.totalPredictions) * 1000) / 10;
  const bt = mem.byPropType[result.propType] ?? { predictions: 0, hits: 0, winRate: 50 };
  bt.predictions++;
  if (result.hit) bt.hits++;
  bt.winRate = Math.round((bt.hits / bt.predictions) * 1000) / 10;
  mem.byPropType[result.propType] = bt;
  mem.lastUpdated = new Date().toISOString();
  updated.playerMemory[pid] = mem;

  // Gradient descent on weights — reward factors that pointed in the right direction
  const target = result.hit ? 1 : 0;
  const error = result.predictedProb - target;
  for (const f of result.factors) {
    if (!(f.name in updated.weights)) continue;
    const k = f.name as keyof MLBPropWeights;
    // factor contribution * error → adjust weight in opposite direction
    const grad = -updated.learningRate * error * f.signal;
    updated.weights[k] = Math.max(WEIGHT_FLOOR, Math.min(WEIGHT_CEILING, updated.weights[k] + grad));
  }
  updated.weights = repairWeights(updated.weights);

  updated.totalPredictions++;
  if (result.hit) updated.totalHits++;
  updated.epoch++;
  return updated;
}
