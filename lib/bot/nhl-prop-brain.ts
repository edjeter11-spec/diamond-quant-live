// ──────────────────────────────────────────────────────────
// NHL PROP BRAIN — closed-loop learner for NHL player props.
// Mirrors NFL/NBA/MLB. Heavy on recent form + matchup defense + fatigue.
// ──────────────────────────────────────────────────────────

export interface NHLPropWeights {
  seasonAverage: number;
  last10Avg: number;
  oppDefVsPosition: number;
  goalieMatchup: number;     // for non-goalie props: starter's save pct
  fatigue: number;            // B2B / 3-in-4 / travel
  homeAway: number;
  injuryRisk: number;
  powerPlayContext: number;   // team PP%, opponent PK%
}

const DEFAULT_WEIGHTS: NHLPropWeights = {
  seasonAverage: 0.20,
  last10Avg: 0.22,           // last 10 games — NHL has lots of games
  oppDefVsPosition: 0.18,
  goalieMatchup: 0.12,
  fatigue: 0.10,
  homeAway: 0.06,
  injuryRisk: 0.06,
  powerPlayContext: 0.06,
};

const WEIGHT_FLOOR = 0.03;
const WEIGHT_CEILING = 0.35;

export interface NHLMarketProfile {
  totalPredictions: number;
  hits: number;
  misses: number;
  brierScore: number;
  winRate: number;
}

function defaultMarket(): NHLMarketProfile {
  return { totalPredictions: 0, hits: 0, misses: 0, brierScore: 0.25, winRate: 50 };
}

export interface NHLPlayerMemory {
  name: string;
  team: string;
  position: string;
  totalPredictions: number;
  hits: number;
  winRate: number;
  byPropType: Record<string, { predictions: number; hits: number; winRate: number }>;
  lastUpdated: string;
}

export interface NHLPropBrainState {
  version: string;
  epoch: number;
  createdAt: string;
  lastTrainedAt: string;
  weights: NHLPropWeights;
  initialWeights: NHLPropWeights;
  learningRate: number;
  markets: Record<string, NHLMarketProfile>;
  playerMemory: Record<string, NHLPlayerMemory>;
  totalPredictions: number;
  totalHits: number;
  isPreTrained: boolean;
  totalGamesProcessed: number;
}

const PLAYER_CAP = 300;

export function repairNHLWeights(w: NHLPropWeights): NHLPropWeights {
  const keys = Object.keys(w) as (keyof NHLPropWeights)[];
  const clamped = { ...w };
  for (const k of keys) clamped[k] = Math.max(WEIGHT_FLOOR, Math.min(WEIGHT_CEILING, clamped[k]));
  const sum = keys.reduce((s, k) => s + clamped[k], 0);
  if (sum > 0) for (const k of keys) clamped[k] = Math.round((clamped[k] / sum) * 10000) / 10000;
  return clamped;
}

export function createDefaultNHLBrain(): NHLPropBrainState {
  return {
    version: "1.0.0",
    epoch: 0,
    createdAt: new Date().toISOString(),
    lastTrainedAt: "",
    weights: { ...DEFAULT_WEIGHTS },
    initialWeights: { ...DEFAULT_WEIGHTS },
    learningRate: 0.015,
    markets: {
      player_points: defaultMarket(),
      player_goals: defaultMarket(),
      player_assists: defaultMarket(),
      player_shots_on_goal: defaultMarket(),
      player_total_saves: defaultMarket(),
    },
    playerMemory: {},
    totalPredictions: 0,
    totalHits: 0,
    isPreTrained: false,
    totalGamesProcessed: 0,
  };
}

export async function loadNHLPropBrainFromCloud(): Promise<NHLPropBrainState> {
  try {
    const { cloudGet } = await import("@/lib/supabase/client");
    const data = await cloudGet<NHLPropBrainState | null>("nhl_prop_brain", null);
    if (data && data.version) return data;
  } catch {}
  return createDefaultNHLBrain();
}

export async function saveNHLPropBrainToCloud(brain: NHLPropBrainState): Promise<void> {
  try {
    const { cloudSet } = await import("@/lib/supabase/client");
    await cloudSet("nhl_prop_brain", { ...brain, playerMemory: trimPlayerMemory(brain.playerMemory) });
  } catch {}
}

function trimPlayerMemory(mem: Record<string, NHLPlayerMemory>): Record<string, NHLPlayerMemory> {
  const entries = Object.entries(mem);
  if (entries.length <= PLAYER_CAP) return mem;
  entries.sort((a, b) => new Date(b[1].lastUpdated).getTime() - new Date(a[1].lastUpdated).getTime());
  const kept: Record<string, NHLPlayerMemory> = {};
  for (const [k, v] of entries.slice(0, PLAYER_CAP)) kept[k] = v;
  return kept;
}

export function learnFromNHLResult(
  brain: NHLPropBrainState,
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
): NHLPropBrainState {
  const updated: NHLPropBrainState = JSON.parse(JSON.stringify(brain));
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

  const error = result.predictedProb - (result.hit ? 1 : 0);
  for (const f of result.factors) {
    if (!(f.name in updated.weights)) continue;
    const k = f.name as keyof NHLPropWeights;
    updated.weights[k] = Math.max(WEIGHT_FLOOR, Math.min(WEIGHT_CEILING, updated.weights[k] - updated.learningRate * error * f.signal));
  }
  updated.weights = repairNHLWeights(updated.weights);

  updated.totalPredictions++;
  if (result.hit) updated.totalHits++;
  updated.epoch++;
  return updated;
}
