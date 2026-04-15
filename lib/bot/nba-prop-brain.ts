// ──────────────────────────────────────────────────────────
// NBA PROP BRAIN — Closed-Loop Learning for Player Props
// Completely separate from MLB brain. Own weights, memory, learning.
// Supabase key: "nba_prop_brain"
// ──────────────────────────────────────────────────────────

// ── Weight System ──
export interface NbaPropWeights {
  seasonAverage: number;    // baseline PPG/RPG/APG
  recentForm: number;       // last 5 games trend
  matchupDefense: number;   // opponent defensive rating vs position
  homeAway: number;         // home/away splits
  restSchedule: number;     // B2B, rest days
  paceContext: number;      // game pace/tempo
  lineMovement: number;     // sharp money signal
}

const DEFAULT_WEIGHTS: NbaPropWeights = {
  seasonAverage: 0.25,
  recentForm: 0.20,
  matchupDefense: 0.18,
  homeAway: 0.10,
  restSchedule: 0.10,
  paceContext: 0.10,
  lineMovement: 0.07,
};

const WEIGHT_FLOOR = 0.03;
const WEIGHT_CEILING = 0.30;
const PLAYER_MEMORY_CAP = 300;

// ── Per-Player Memory ──
export interface PlayerPropMemory {
  name: string;
  playerId: number;
  team: string;
  totalPredictions: number;
  hits: number;
  misses: number;
  winRate: number;
  brierScore: number;
  avgOvershoot: number;      // tendency: positive = brain predicts too high
  consistencyScore: number;  // 0-1: 1 = very consistent player
  byPropType: Record<string, { predictions: number; hits: number; winRate: number }>;
  lastUpdated: string;
}

// ── Market Profile (per prop type) ──
export interface PropMarketProfile {
  totalPredictions: number;
  hits: number;
  misses: number;
  brierScore: number;
  avgEV: number;
  winRate: number;
  dynamicThreshold: number; // min EV% to bet
}

function defaultMarketProfile(): PropMarketProfile {
  return { totalPredictions: 0, hits: 0, misses: 0, brierScore: 0.25, avgEV: 0, winRate: 50, dynamicThreshold: 2.0 };
}

// ── Audit Result ──
export interface AuditResult {
  gameId: string;
  gameDate: string;
  graded: number;
  hits: number;
  misses: number;
  avgBrier: number;
  timestamp: string;
}

// ── Full Brain State ──
export interface NbaPropBrainState {
  version: string;
  epoch: number;
  createdAt: string;
  lastAuditAt: string;
  weights: NbaPropWeights;
  initialWeights: NbaPropWeights;
  learningRate: number;
  markets: Record<string, PropMarketProfile>;
  playerMemory: Record<string, PlayerPropMemory>;
  logs: Array<{ timestamp: string; type: string; message: string }>;
  recentAudits: AuditResult[];
  totalPredictions: number;
  totalHits: number;
}

// ── Load / Save ──

export function loadNbaPropBrain(): NbaPropBrainState {
  if (typeof window === "undefined") return createDefaultBrain();
  try {
    const stored = localStorage.getItem("dq_nba_prop_brain");
    if (stored) return JSON.parse(stored);
  } catch {}
  return createDefaultBrain();
}

export function saveNbaPropBrain(brain: NbaPropBrainState) {
  if (typeof window !== "undefined") {
    try { localStorage.setItem("dq_nba_prop_brain", JSON.stringify(brain)); } catch {}
  }
  syncBrainToCloud(brain);
}

let lastBrainSync = 0;
async function syncBrainToCloud(brain: NbaPropBrainState) {
  const now = Date.now();
  if (now - lastBrainSync < 60000) return; // throttle 1/min
  lastBrainSync = now;
  try {
    const { cloudSet } = await import("@/lib/supabase/client");
    // Trim for cloud: cap logs, recent audits, player memory
    const trimmed = {
      ...brain,
      logs: brain.logs.slice(-30),
      recentAudits: brain.recentAudits.slice(-20),
      playerMemory: trimPlayerMemory(brain.playerMemory),
    };
    await cloudSet("nba_prop_brain", trimmed);
  } catch {}
}

function trimPlayerMemory(mem: Record<string, PlayerPropMemory>): Record<string, PlayerPropMemory> {
  const entries = Object.entries(mem);
  if (entries.length <= PLAYER_MEMORY_CAP) return mem;
  // Evict by oldest lastUpdated
  entries.sort((a, b) => new Date(b[1].lastUpdated).getTime() - new Date(a[1].lastUpdated).getTime());
  const kept: Record<string, PlayerPropMemory> = {};
  for (const [key, val] of entries.slice(0, PLAYER_MEMORY_CAP)) kept[key] = val;
  return kept;
}

// ── Load from cloud (server-side) ──
export async function loadNbaPropBrainFromCloud(): Promise<NbaPropBrainState> {
  try {
    const { cloudGet } = await import("@/lib/supabase/client");
    const data = await cloudGet<NbaPropBrainState | null>("nba_prop_brain", null);
    if (data && data.version) return data;
  } catch {}
  return createDefaultBrain();
}

export async function saveNbaPropBrainToCloud(brain: NbaPropBrainState): Promise<void> {
  try {
    const { cloudSet } = await import("@/lib/supabase/client");
    await cloudSet("nba_prop_brain", {
      ...brain,
      logs: brain.logs.slice(-30),
      recentAudits: brain.recentAudits.slice(-20),
      playerMemory: trimPlayerMemory(brain.playerMemory),
    });
  } catch {}
}

function createDefaultBrain(): NbaPropBrainState {
  return {
    version: "1.0.0",
    epoch: 0,
    createdAt: new Date().toISOString(),
    lastAuditAt: "",
    weights: { ...DEFAULT_WEIGHTS },
    initialWeights: { ...DEFAULT_WEIGHTS },
    learningRate: 0.015,
    markets: {
      player_points: defaultMarketProfile(),
      player_rebounds: defaultMarketProfile(),
      player_assists: defaultMarketProfile(),
    },
    playerMemory: {},
    logs: [],
    recentAudits: [],
    totalPredictions: 0,
    totalHits: 0,
  };
}

// ── Weight Repair ──
export function repairWeights(weights: NbaPropWeights): NbaPropWeights {
  const keys = Object.keys(weights) as (keyof NbaPropWeights)[];
  const repaired = { ...weights };
  let needsRepair = false;

  for (const k of keys) {
    if (repaired[k] < WEIGHT_FLOOR || repaired[k] > WEIGHT_CEILING) needsRepair = true;
    repaired[k] = Math.max(WEIGHT_FLOOR, Math.min(WEIGHT_CEILING, repaired[k]));
  }

  // Normalize to 1.0
  const sum = keys.reduce((s, k) => s + repaired[k], 0);
  if (Math.abs(sum - 1.0) > 0.001) {
    for (const k of keys) repaired[k] = repaired[k] / sum;
  }

  return repaired;
}

// ── Core Learning Function ──
export function learnFromPropResult(
  brain: NbaPropBrainState,
  result: {
    playerName: string;
    playerId?: number;
    team?: string;
    propType: string;
    predictedProb: number;
    predictedSide: "over" | "under";
    actualValue: number;
    line: number;
    hit: boolean;
    factors: Array<{ name: string; contribution: number; signal: number }>;
  }
): NbaPropBrainState {
  const updated = { ...brain };
  updated.epoch++;

  const outcome = result.hit ? 1 : 0;
  const brierScore = Math.pow(result.predictedProb - outcome, 2);

  // ── Update market profile ──
  const market = updated.markets[result.propType] ?? defaultMarketProfile();
  market.totalPredictions++;
  if (result.hit) market.hits++;
  else market.misses++;
  // EMA on Brier score (α = 0.1)
  market.brierScore = market.brierScore * 0.9 + brierScore * 0.1;
  market.winRate = market.totalPredictions > 0 ? Math.round((market.hits / market.totalPredictions) * 1000) / 10 : 50;
  // Dynamic threshold adjustment
  if (market.winRate > 55 && market.brierScore < 0.22) {
    market.dynamicThreshold = Math.max(1.0, market.dynamicThreshold - 0.1);
  } else if (market.winRate < 45 || market.brierScore > 0.30) {
    market.dynamicThreshold = Math.min(5.0, market.dynamicThreshold + 0.2);
  }
  updated.markets[result.propType] = market;

  // ── Update player memory ──
  const playerKey = result.playerName.toLowerCase().replace(/\s+/g, "_");
  const player = updated.playerMemory[playerKey] ?? {
    name: result.playerName,
    playerId: result.playerId ?? 0,
    team: result.team ?? "",
    totalPredictions: 0, hits: 0, misses: 0, winRate: 0,
    brierScore: 0.25, avgOvershoot: 0, consistencyScore: 0.5,
    byPropType: {},
    lastUpdated: new Date().toISOString(),
  };

  player.totalPredictions++;
  if (result.hit) player.hits++;
  else player.misses++;
  player.winRate = Math.round((player.hits / player.totalPredictions) * 1000) / 10;
  player.brierScore = player.brierScore * 0.85 + brierScore * 0.15;

  // Overshoot: how much brain's implied value differs from actual
  const impliedValue = result.predictedSide === "over"
    ? result.line + (result.predictedProb - 0.5) * result.line * 0.3
    : result.line - (result.predictedProb - 0.5) * result.line * 0.3;
  const overshoot = impliedValue - result.actualValue;
  player.avgOvershoot = player.avgOvershoot * 0.8 + overshoot * 0.2;

  // Per-prop-type
  const pt = player.byPropType[result.propType] ?? { predictions: 0, hits: 0, winRate: 0 };
  pt.predictions++;
  if (result.hit) pt.hits++;
  pt.winRate = Math.round((pt.hits / pt.predictions) * 1000) / 10;
  player.byPropType[result.propType] = pt;
  player.lastUpdated = new Date().toISOString();
  updated.playerMemory[playerKey] = player;

  // ── Adjust weights based on factor performance ──
  const lr = updated.learningRate;
  const weightKeys = Object.keys(updated.weights) as (keyof NbaPropWeights)[];

  for (const factor of result.factors) {
    const wKey = factor.name as keyof NbaPropWeights;
    if (!weightKeys.includes(wKey)) continue;

    const absContribution = Math.abs(factor.contribution);
    if (absContribution < 0.05) continue; // skip negligible factors

    if (result.hit) {
      // Reinforce factors that contributed to correct prediction
      updated.weights[wKey] += lr * absContribution * 0.1;
    } else {
      // Weaken factors that drove an incorrect prediction
      updated.weights[wKey] -= lr * absContribution * 0.08;
    }
  }

  // Repair and normalize
  updated.weights = repairWeights(updated.weights);

  // Global stats
  updated.totalPredictions++;
  if (result.hit) updated.totalHits++;

  // Log
  updated.logs.push({
    timestamp: new Date().toISOString(),
    type: result.hit ? "HIT" : "MISS",
    message: `${result.playerName} ${result.propType} ${result.predictedSide} ${result.line}: actual ${result.actualValue} (${result.hit ? "✓" : "✗"})`,
  });
  if (updated.logs.length > 50) updated.logs = updated.logs.slice(-50);

  return updated;
}

// ── Get Player Accuracy (for UI badges) ──
export function getPlayerAccuracy(
  brain: NbaPropBrainState,
  playerName: string,
  propType?: string
): { total: number; hits: number; winRate: number; byType: Record<string, { predictions: number; hits: number; winRate: number }> } | null {
  const playerKey = playerName.toLowerCase().replace(/\s+/g, "_");
  const player = brain.playerMemory[playerKey];
  if (!player || player.totalPredictions < 1) return null;

  if (propType) {
    const pt = player.byPropType[propType];
    if (!pt || pt.predictions < 1) return null;
    return { total: pt.predictions, hits: pt.hits, winRate: pt.winRate, byType: player.byPropType };
  }

  return {
    total: player.totalPredictions,
    hits: player.hits,
    winRate: player.winRate,
    byType: player.byPropType,
  };
}

// ── Brain Summary ──
export function getBrainSummary(brain: NbaPropBrainState) {
  const overallWinRate = brain.totalPredictions > 0
    ? Math.round((brain.totalHits / brain.totalPredictions) * 1000) / 10
    : 0;
  return {
    version: brain.version,
    epoch: brain.epoch,
    totalPredictions: brain.totalPredictions,
    totalHits: brain.totalHits,
    overallWinRate,
    playersTracked: Object.keys(brain.playerMemory).length,
    markets: brain.markets,
    lastAudit: brain.lastAuditAt,
    weights: brain.weights,
  };
}
