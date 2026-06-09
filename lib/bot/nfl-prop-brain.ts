// ──────────────────────────────────────────────────────────
// NFL PROP BRAIN — closed-loop learner for NFL player props.
// Mirrors NBA/MLB brain structure.
// Weights tuned for NFL volatility (recent form heavy).
// ──────────────────────────────────────────────────────────

export interface NFLPropWeights {
  seasonAverage: number;
  last5Avg: number;
  oppDefVsPosition: number;
  weather: number;       // outdoor + wind/cold = under
  restDays: number;      // short week / post-bye
  homeAway: number;
  injuryRisk: number;    // own team's injuries
  paceContext: number;   // team pace (sec/play)
}

const DEFAULT_WEIGHTS: NFLPropWeights = {
  seasonAverage: 0.18,
  last5Avg: 0.24,           // NFL streaky — recent form weighted highest
  oppDefVsPosition: 0.20,   // matchup matters huge in NFL
  weather: 0.10,
  restDays: 0.06,
  homeAway: 0.08,
  injuryRisk: 0.08,
  paceContext: 0.06,
};

const WEIGHT_FLOOR = 0.03;
const WEIGHT_CEILING = 0.35;

export interface NFLMarketProfile {
  totalPredictions: number;
  hits: number;
  misses: number;
  brierScore: number;
  winRate: number;
}

function defaultMarket(): NFLMarketProfile {
  return { totalPredictions: 0, hits: 0, misses: 0, brierScore: 0.25, winRate: 50 };
}

export interface NFLPlayerMemory {
  name: string;
  team: string;
  position: string;
  totalPredictions: number;
  hits: number;
  winRate: number;
  byPropType: Record<string, { predictions: number; hits: number; winRate: number }>;
  lastUpdated: string;
}

export interface NFLPropBrainState {
  version: string;
  epoch: number;
  createdAt: string;
  lastTrainedAt: string;
  weights: NFLPropWeights;
  initialWeights: NFLPropWeights;
  learningRate: number;
  markets: Record<string, NFLMarketProfile>;
  playerMemory: Record<string, NFLPlayerMemory>;
  totalPredictions: number;
  totalHits: number;
  isPreTrained: boolean;
  totalGamesProcessed: number;
}

const PLAYER_CAP = 300;

export function repairNFLWeights(w: NFLPropWeights): NFLPropWeights {
  const keys = Object.keys(w) as (keyof NFLPropWeights)[];
  const clamped = { ...w };
  for (const k of keys) clamped[k] = Math.max(WEIGHT_FLOOR, Math.min(WEIGHT_CEILING, clamped[k]));
  const sum = keys.reduce((s, k) => s + clamped[k], 0);
  if (sum > 0) for (const k of keys) clamped[k] = Math.round((clamped[k] / sum) * 10000) / 10000;
  return clamped;
}

export function createDefaultNFLBrain(): NFLPropBrainState {
  return {
    version: "1.0.0",
    epoch: 0,
    createdAt: new Date().toISOString(),
    lastTrainedAt: "",
    weights: { ...DEFAULT_WEIGHTS },
    initialWeights: { ...DEFAULT_WEIGHTS },
    learningRate: 0.015,
    markets: {
      player_pass_yds: defaultMarket(),
      player_pass_tds: defaultMarket(),
      player_pass_attempts: defaultMarket(),
      player_rush_yds: defaultMarket(),
      player_rush_attempts: defaultMarket(),
      player_receptions: defaultMarket(),
      player_reception_yds: defaultMarket(),
      player_anytime_td: defaultMarket(),
    },
    playerMemory: {},
    totalPredictions: 0,
    totalHits: 0,
    isPreTrained: false,
    totalGamesProcessed: 0,
  };
}

export async function loadNFLPropBrainFromCloud(): Promise<NFLPropBrainState> {
  try {
    const { cloudGet } = await import("@/lib/supabase/client");
    const data = await cloudGet<NFLPropBrainState | null>("nfl_prop_brain", null);
    if (data && data.version) return data;
  } catch {}
  return createDefaultNFLBrain();
}

export async function saveNFLPropBrainToCloud(brain: NFLPropBrainState): Promise<void> {
  try {
    const { cloudSet } = await import("@/lib/supabase/client");
    await cloudSet("nfl_prop_brain", { ...brain, playerMemory: trimPlayerMemory(brain.playerMemory) });
  } catch {}
}

function trimPlayerMemory(mem: Record<string, NFLPlayerMemory>): Record<string, NFLPlayerMemory> {
  const entries = Object.entries(mem);
  if (entries.length <= PLAYER_CAP) return mem;
  entries.sort((a, b) => new Date(b[1].lastUpdated).getTime() - new Date(a[1].lastUpdated).getTime());
  const kept: Record<string, NFLPlayerMemory> = {};
  for (const [k, v] of entries.slice(0, PLAYER_CAP)) kept[k] = v;
  return kept;
}

export function learnFromNFLResult(
  brain: NFLPropBrainState,
  result: {
    playerName: string;
    team: string;
    position: string;
    propType: string;
    predictedProb: number;
    predictedSide: "over" | "under";
    line: number;
    actualValue: number;
    hit: boolean;
    factors: Array<{ name: string; signal: number; contribution: number }>;
  },
): NFLPropBrainState {
  const updated: NFLPropBrainState = JSON.parse(JSON.stringify(brain));
  const m = updated.markets[result.propType] ?? defaultMarket();
  m.totalPredictions++;
  if (result.hit) m.hits++; else m.misses++;
  m.brierScore = ((m.brierScore * (m.totalPredictions - 1)) + Math.pow(result.predictedProb - (result.hit ? 1 : 0), 2)) / m.totalPredictions;
  m.winRate = Math.round((m.hits / Math.max(m.totalPredictions, 1)) * 1000) / 10;
  updated.markets[result.propType] = m;

  const pid = result.playerName.toLowerCase().replace(/\s+/g, "_");
  const mem = updated.playerMemory[pid] ?? {
    name: result.playerName, team: result.team, position: result.position,
    totalPredictions: 0, hits: 0, winRate: 50, byPropType: {}, lastUpdated: new Date().toISOString(),
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

  // Gradient descent on weights
  const error = result.predictedProb - (result.hit ? 1 : 0);
  for (const f of result.factors) {
    if (!(f.name in updated.weights)) continue;
    const k = f.name as keyof NFLPropWeights;
    updated.weights[k] = Math.max(WEIGHT_FLOOR, Math.min(WEIGHT_CEILING, updated.weights[k] - updated.learningRate * error * f.signal));
  }
  updated.weights = repairNFLWeights(updated.weights);

  updated.totalPredictions++;
  if (result.hit) updated.totalHits++;
  updated.epoch++;
  return updated;
}
