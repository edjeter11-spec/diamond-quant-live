// ──────────────────────────────────────────────────────────
// NBA BRAIN EVOLUTION — Breed, Train, Test, Promote
// Generates mutant brain variants, trains them all on same data,
// tests on held-out set, promotes the winner. Repeats per generation.
// ──────────────────────────────────────────────────────────

import { deepTrainNbaProps } from "./nba-prop-deep-trainer";
import { projectProp, type ProjectionContext, type RecentFormData } from "./nba-prop-projector";
import {
  type NbaPropBrainState, type NbaPropWeights,
  repairWeights, learnFromPropResult,
} from "./nba-prop-brain";
import { fetchAllTrainingData, type NbaPlayerGameLog } from "./nba-stats-fetcher";

// ── Types ──

export interface BrainVariant {
  id: string;
  name: string;
  generation: number;
  parentId: string;
  weights: NbaPropWeights;
  learningRate: number;
  strategy: string;
  trainAccuracy: Record<string, { total: number; hits: number; winRate: number }>;
  testAccuracy: Record<string, { total: number; hits: number; winRate: number }>;
  overallTestWinRate: number;
}

export interface EvolutionState {
  currentGeneration: number;
  liveBrainId: string;
  liveWeights: NbaPropWeights;
  variants: BrainVariant[];
  history: Array<{ generation: number; winnerId: string; winnerName: string; winRate: number; timestamp: string }>;
  totalGenerationsRun: number;
  bestEverWinRate: number;
  bestEverVariantId: string;
  status: "idle" | "running" | "complete";
}

export function createDefaultEvolutionState(): EvolutionState {
  return {
    currentGeneration: 0,
    liveBrainId: "original",
    liveWeights: { seasonAverage: 0.25, recentForm: 0.20, matchupDefense: 0.18, homeAway: 0.10, restSchedule: 0.10, paceContext: 0.10, lineMovement: 0.07 },
    variants: [],
    history: [],
    totalGenerationsRun: 0,
    bestEverWinRate: 0,
    bestEverVariantId: "",
    status: "idle",
  };
}

// ── Named Strategies (Generation 1) ──

const NAMED_STRATEGIES: Array<{ name: string; slug: string; weights: NbaPropWeights; lr: number; desc: string }> = [
  {
    name: "Form Hunter",
    slug: "form-hunter",
    desc: "Heavy recentForm — bets hot/cold streaks are predictive",
    lr: 0.015,
    weights: { seasonAverage: 0.15, recentForm: 0.35, matchupDefense: 0.15, homeAway: 0.10, restSchedule: 0.10, paceContext: 0.08, lineMovement: 0.07 },
  },
  {
    name: "Matchup Specialist",
    slug: "matchup-specialist",
    desc: "Heavy matchupDefense — who you play against matters most",
    lr: 0.015,
    weights: { seasonAverage: 0.18, recentForm: 0.15, matchupDefense: 0.30, homeAway: 0.10, restSchedule: 0.12, paceContext: 0.08, lineMovement: 0.07 },
  },
  {
    name: "Context King",
    slug: "context-king",
    desc: "Boosts rest + home + pace — situational factors beat raw stats",
    lr: 0.015,
    weights: { seasonAverage: 0.15, recentForm: 0.12, matchupDefense: 0.13, homeAway: 0.15, restSchedule: 0.20, paceContext: 0.15, lineMovement: 0.10 },
  },
  {
    name: "Aggressive Learner",
    slug: "aggressive-learner",
    desc: "2x learning rate — adapts faster, risks overfitting",
    lr: 0.030,
    weights: { seasonAverage: 0.25, recentForm: 0.20, matchupDefense: 0.18, homeAway: 0.10, restSchedule: 0.10, paceContext: 0.10, lineMovement: 0.07 },
  },
];

// ── Seeded RNG for reproducible mutations ──
function seededRng(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) & 0x7fffffff; return s / 0x7fffffff; };
}

// ── Generate Variants ──
export function generateVariants(
  parentWeights: NbaPropWeights,
  parentId: string,
  generation: number,
  seed: number = Date.now()
): BrainVariant[] {
  const variants: BrainVariant[] = [];
  const rng = seededRng(seed);

  if (generation === 1) {
    // First generation: use named strategies
    for (const strat of NAMED_STRATEGIES) {
      variants.push({
        id: `gen${generation}-${strat.slug}`,
        name: strat.name,
        generation,
        parentId,
        weights: repairWeights(strat.weights),
        learningRate: strat.lr,
        strategy: strat.desc,
        trainAccuracy: {}, testAccuracy: {},
        overallTestWinRate: 0,
      });
    }
    // Add one random mutation
    variants.push(createRandomMutant(parentWeights, parentId, generation, rng, 0.30));
  } else {
    // Subsequent generations: mutate from winner
    // 2 small mutations (±10%)
    variants.push(createMutation(parentWeights, parentId, generation, rng, 0.10, "Small Mutation A"));
    variants.push(createMutation(parentWeights, parentId, generation, rng, 0.10, "Small Mutation B"));
    // 1 medium mutation (±20%)
    variants.push(createMutation(parentWeights, parentId, generation, rng, 0.20, "Medium Mutation"));
    // 1 large mutation (±40%)
    variants.push(createMutation(parentWeights, parentId, generation, rng, 0.40, "Explorer"));
    // 1 random wildcard
    variants.push(createRandomMutant(parentWeights, parentId, generation, rng, 0.35));
  }

  return variants;
}

function createMutation(
  parent: NbaPropWeights, parentId: string, gen: number,
  rng: () => number, magnitude: number, name: string
): BrainVariant {
  const keys = Object.keys(parent) as (keyof NbaPropWeights)[];
  const mutated = { ...parent };
  for (const k of keys) {
    mutated[k] = parent[k] * (1 + (rng() * 2 - 1) * magnitude);
  }
  return {
    id: `gen${gen}-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name: `${name} (Gen ${gen})`,
    generation: gen,
    parentId,
    weights: repairWeights(mutated),
    learningRate: 0.012 + rng() * 0.008, // 0.012-0.020
    strategy: `±${(magnitude * 100).toFixed(0)}% mutation from winner`,
    trainAccuracy: {}, testAccuracy: {},
    overallTestWinRate: 0,
  };
}

function createRandomMutant(
  parent: NbaPropWeights, parentId: string, gen: number,
  rng: () => number, magnitude: number
): BrainVariant {
  const keys = Object.keys(parent) as (keyof NbaPropWeights)[];
  const mutated = { ...parent };
  for (const k of keys) {
    mutated[k] = 0.05 + rng() * 0.25; // completely random 0.05-0.30
  }
  return {
    id: `gen${gen}-wildcard`,
    name: `Wildcard (Gen ${gen})`,
    generation: gen,
    parentId,
    weights: repairWeights(mutated),
    learningRate: 0.010 + rng() * 0.015,
    strategy: "Random exploration — entirely new weight config",
    trainAccuracy: {}, testAccuracy: {},
    overallTestWinRate: 0,
  };
}

// ── Train + Evaluate a Single Variant ──
// Trains on trainData, then tests on testData WITHOUT learning

export async function trainAndEvaluate(
  variant: BrainVariant,
  trainData: NbaPlayerGameLog[],
  testData: NbaPlayerGameLog[],
  onProgress?: (msg: string) => void
): Promise<BrainVariant> {
  onProgress?.(`Training ${variant.name}...`);

  // Create a fresh brain with this variant's weights
  const brain: NbaPropBrainState = {
    version: variant.id,
    epoch: 0,
    createdAt: new Date().toISOString(),
    lastAuditAt: "",
    weights: { ...variant.weights },
    initialWeights: { ...variant.weights },
    learningRate: variant.learningRate,
    markets: {
      player_points: { totalPredictions: 0, hits: 0, misses: 0, brierScore: 0.25, avgEV: 0, winRate: 50, dynamicThreshold: 2.0 },
      player_rebounds: { totalPredictions: 0, hits: 0, misses: 0, brierScore: 0.25, avgEV: 0, winRate: 50, dynamicThreshold: 2.0 },
      player_assists: { totalPredictions: 0, hits: 0, misses: 0, brierScore: 0.25, avgEV: 0, winRate: 50, dynamicThreshold: 2.0 },
    },
    playerMemory: {},
    logs: [],
    recentAudits: [],
    totalPredictions: 0,
    totalHits: 0,
    isPreTrained: false,
    trainedSeasons: [],
    totalGamesProcessed: 0,
    lastTrainedAt: "",
  };

  // Phase 1: Train on training data (brain LEARNS)
  const trainResult = await deepTrainNbaProps(brain, [], onProgress, undefined, undefined);
  // We can't use deepTrainNbaProps directly since it fetches its own data.
  // Instead, inline the quiz logic for the provided data.

  // Actually, let's use a simpler direct approach: quiz the brain on the data manually
  const trained = await runQuizOnData(brain, trainData, true, onProgress);
  variant.trainAccuracy = trained.accuracy;

  onProgress?.(`Testing ${variant.name} on held-out data...`);

  // Phase 2: Test on test data (brain does NOT learn — pure evaluation)
  const tested = await runQuizOnData(trained.brain, testData, false);
  variant.testAccuracy = tested.accuracy;

  // Overall test win rate (average across prop types)
  const types = Object.values(tested.accuracy);
  const totalHits = types.reduce((s, t) => s + t.hits, 0);
  const totalTests = types.reduce((s, t) => s + t.total, 0);
  variant.overallTestWinRate = totalTests > 0 ? Math.round((totalHits / totalTests) * 1000) / 10 : 0;

  onProgress?.(`${variant.name}: ${variant.overallTestWinRate}% on test set`);
  return variant;
}

// ── Quiz brain on data (with or without learning) ──
async function runQuizOnData(
  brain: NbaPropBrainState,
  data: NbaPlayerGameLog[],
  learn: boolean,
  onProgress?: (msg: string) => void
): Promise<{ brain: NbaPropBrainState; accuracy: Record<string, { total: number; hits: number; winRate: number }> }> {
  let updated = { ...brain };
  const accuracy: Record<string, { total: number; hits: number }> = {
    player_points: { total: 0, hits: 0 },
    player_rebounds: { total: 0, hits: 0 },
    player_assists: { total: 0, hits: 0 },
  };

  // Build rolling player states
  const playerStates = new Map<number, { gamesPlayed: number; ptsSum: number; rebSum: number; astSum: number; last5: Array<{ pts: number; reb: number; ast: number; date: string }> ; lastDate: string }>();

  // Group by date
  const byDate = new Map<string, NbaPlayerGameLog[]>();
  for (const log of data) {
    const existing = byDate.get(log.gameDate) ?? [];
    existing.push(log);
    byDate.set(log.gameDate, existing);
  }

  const dates = [...byDate.keys()].sort();

  for (const date of dates) {
    const dayLogs = byDate.get(date)!;

    // Quiz phase
    for (const log of dayLogs) {
      if (log.minutes < 5) continue;
      const state = playerStates.get(log.playerId);
      if (!state || state.gamesPlayed < 3) continue;

      const ppg = state.ptsSum / state.gamesPlayed;
      const rpg = state.rebSum / state.gamesPlayed;
      const apg = state.astSum / state.gamesPlayed;
      const isB2B = state.lastDate ? daysBetween(state.lastDate, date) <= 1 : false;

      const ctx: ProjectionContext = { isHome: log.isHome, isB2B, leagueAvgTotal: 224 };

      const propTypes = [
        { type: "player_points", stat: log.pts, avg: ppg },
        { type: "player_rebounds", stat: log.reb, avg: rpg },
        { type: "player_assists", stat: log.ast, avg: apg },
      ];

      for (const { type, stat, avg } of propTypes) {
        if (avg <= 0) continue;
        const line = Math.round(avg * 2) / 2;
        const last5 = state.last5.slice(-5);
        const last5Avg = last5.length > 0
          ? last5.reduce((s, g) => s + (type === "player_points" ? g.pts : type === "player_rebounds" ? g.reb : g.ast), 0) / last5.length
          : avg;

        const recentForm: RecentFormData = { last5Avg, last10Avg: last5Avg, seasonAvg: avg, gamesPlayed: state.gamesPlayed, variance: avg * 0.30 };
        const proj = projectProp({ ppg, rpg, apg }, type, line, updated.weights, ctx, recentForm);
        const hit = proj.side === "over" ? stat > line : stat < line;

        accuracy[type].total++;
        if (hit) accuracy[type].hits++;

        if (learn) {
          updated = learnFromPropResult(updated, {
            playerName: log.playerName, playerId: log.playerId, team: log.team,
            propType: type, predictedProb: proj.probability, predictedSide: proj.side,
            actualValue: stat, line, hit, factors: proj.factors,
          });
        }
      }
    }

    // Reveal phase: update rolling states
    for (const log of dayLogs) {
      if (log.minutes < 5) continue;
      let state = playerStates.get(log.playerId);
      if (!state) state = { gamesPlayed: 0, ptsSum: 0, rebSum: 0, astSum: 0, last5: [], lastDate: "" };
      state.gamesPlayed++;
      state.ptsSum += log.pts;
      state.rebSum += log.reb;
      state.astSum += log.ast;
      state.last5.push({ pts: log.pts, reb: log.reb, ast: log.ast, date });
      if (state.last5.length > 10) state.last5.shift();
      state.lastDate = date;
      playerStates.set(log.playerId, state);
    }
  }

  const result: Record<string, { total: number; hits: number; winRate: number }> = {};
  for (const [key, val] of Object.entries(accuracy)) {
    result[key] = { ...val, winRate: val.total > 0 ? Math.round((val.hits / val.total) * 1000) / 10 : 0 };
  }

  return { brain: updated, accuracy: result };
}

function daysBetween(d1: string, d2: string): number {
  return Math.round(Math.abs(new Date(d2).getTime() - new Date(d1).getTime()) / (1000 * 60 * 60 * 24));
}

// ── Run Full Tournament ──
export async function runTournament(
  parentWeights: NbaPropWeights,
  parentId: string,
  generation: number,
  allData: NbaPlayerGameLog[],
  onProgress?: (msg: string) => void
): Promise<{ variants: BrainVariant[]; winner: BrainVariant }> {
  // Use all data — extra sampling made individual players not qualify (< 5 games seen)
  const sampled = allData;

  // 80/20 train/test split
  const splitIdx = Math.floor(sampled.length * 0.8);
  const trainData = sampled.slice(0, splitIdx);
  const testData = sampled.slice(splitIdx);

  onProgress?.(`Gen ${generation}: ${trainData.length} train / ${testData.length} test games (sampled from ${allData.length})`);

  // Use top 3 variants for speed (not 5)
  const allVariants = generateVariants(parentWeights, parentId, generation);
  const variants = allVariants.slice(0, 3);
  const evaluated: BrainVariant[] = [];

  for (let i = 0; i < variants.length; i++) {
    onProgress?.(`Gen ${generation}: Training variant ${i + 1}/${variants.length} — ${variants[i].name}`);
    const result = await trainAndEvaluate(variants[i], trainData, testData, onProgress);
    evaluated.push(result);
  }

  // Sort by test accuracy (highest first)
  evaluated.sort((a, b) => b.overallTestWinRate - a.overallTestWinRate);

  onProgress?.(`Gen ${generation} winner: ${evaluated[0].name} at ${evaluated[0].overallTestWinRate}%`);

  return { variants: evaluated, winner: evaluated[0] };
}

// ── Run Multiple Generations ──
export async function evolve(
  startingWeights: NbaPropWeights,
  generations: number,
  allData: NbaPlayerGameLog[],
  onProgress?: (msg: string) => void
): Promise<EvolutionState> {
  const state: EvolutionState = createDefaultEvolutionState();
  state.liveWeights = { ...startingWeights };
  state.status = "running";

  let currentWeights = { ...startingWeights };
  let currentId = "original";

  for (let gen = 1; gen <= generations; gen++) {
    onProgress?.(`═══ GENERATION ${gen}/${generations} ═══`);

    const { variants, winner } = await runTournament(currentWeights, currentId, gen, allData, onProgress);

    state.variants.push(...variants);
    state.currentGeneration = gen;
    state.totalGenerationsRun = gen;

    // Check if winner beats current live
    const improvement = winner.overallTestWinRate - (state.bestEverWinRate || 45);
    if (winner.overallTestWinRate > state.bestEverWinRate) {
      state.bestEverWinRate = winner.overallTestWinRate;
      state.bestEverVariantId = winner.id;
    }

    state.history.push({
      generation: gen,
      winnerId: winner.id,
      winnerName: winner.name,
      winRate: winner.overallTestWinRate,
      timestamp: new Date().toISOString(),
    });

    // Evolve from winner
    currentWeights = { ...winner.weights };
    currentId = winner.id;
    state.liveBrainId = winner.id;
    state.liveWeights = { ...winner.weights };

    onProgress?.(`Gen ${gen} complete — Best: ${winner.name} at ${winner.overallTestWinRate}%`);
  }

  state.status = "complete";
  return state;
}
