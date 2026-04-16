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

  // Pitcher-specific memory
  pitcherMemory: Record<string, PitcherMemory>;

  // Park-specific memory
  parkMemory: Record<string, { games: number; homeWins: number; avgRuns: number; nrfiRate: number }>;

  // Matchup memory (team vs team)
  matchupMemory: Record<string, { games: number; homeWins: number }>;

  // Learning config
  learningRate: number;
  isPreTrained: boolean;
}

export interface PitcherMemory {
  name: string;
  gamesTracked: number;
  wins: number;
  losses: number;
  winRate: number;
  avgERAWhenWin: number;
  avgERAWhenLoss: number;
  nrfiCount: number;
  nrfiRate: number;
  vsTeams: Record<string, { games: number; wins: number }>; // opponent -> record
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
    pitcherMemory: {},
    parkMemory: {},
    matchupMemory: {},
    learningRate: 0.02,
    isPreTrained: false,
  };
}

// ── Load / Save ──

// Load: try cloud first, then localStorage, then fresh
export function loadBrain(): BrainState {
  if (typeof window === "undefined") return createFreshBrain();
  try {
    const stored = localStorage.getItem("dq_brain");
    if (stored) return repairWeights(JSON.parse(stored));
  } catch {}
  return createFreshBrain();
}

// Repair drifted weights — if any weight is below 4% or above 35%, reset to healthy defaults
function repairWeights(brain: BrainState): BrainState {
  const w = brain.weights;
  const needsRepair = Object.values(w).some(v => v < 0.03 || v > 0.36);
  if (!needsRepair) return brain;

  // Reset to healthy baseline but keep some of the learned adjustments
  const healthy: ModelWeights = {
    pitching: 0.25, hitting: 0.20, bullpen: 0.14, defense: 0.08,
    weather: 0.06, umpire: 0.06, momentum: 0.12, homeField: 0.09,
  };

  // Blend: 70% healthy + 30% current (clamped)
  for (const key of Object.keys(healthy) as (keyof ModelWeights)[]) {
    const clamped = Math.max(0.04, Math.min(0.35, w[key]));
    healthy[key] = healthy[key] * 0.7 + clamped * 0.3;
  }

  // Normalize
  const total = Object.values(healthy).reduce((a, b) => a + b, 0);
  for (const key of Object.keys(healthy) as (keyof ModelWeights)[]) {
    healthy[key] = healthy[key] / total;
  }

  brain.weights = healthy;
  brain.logs.push({ timestamp: new Date().toISOString(), type: "adjust", message: "Weights repaired — detected extreme drift, blended back to healthy baseline" });
  return brain;
}

// Async load from cloud (call this on mount for latest data)
export async function loadBrainFromCloud(): Promise<BrainState> {
  try {
    const { cloudGet } = await import("@/lib/supabase/client");
    let cloud = await cloudGet<BrainState>("brain", createFreshBrain());
    if (cloud && cloud.epoch > 0) {
      // Repair any drifted weights
      const repaired = repairWeights(cloud);
      // If weights were repaired, save back to cloud immediately
      if (repaired.weights !== cloud.weights) {
        saveBrainToCloud(repaired);
      }
      // Save to localStorage as cache
      if (typeof window !== "undefined") {
        try { localStorage.setItem("dq_brain", JSON.stringify(repaired)); } catch {}
      }
      return repaired;
    }
  } catch {}
  return loadBrain();
}

// Save: write to localStorage + cloud (throttled)
let lastCloudSave = 0;
const CLOUD_SAVE_INTERVAL = 60000; // max 1 cloud save per minute

export function saveBrain(brain: BrainState) {
  // Trim aggressively to reduce data size
  brain.logs = brain.logs.slice(-50);
  brain.recentGames = brain.recentGames.slice(-20);

  // localStorage (sync, instant)
  if (typeof window !== "undefined") {
    try { localStorage.setItem("dq_brain", JSON.stringify(brain)); } catch {}
  }

  // Cloud (throttled — max 1 write per minute to save Supabase IO)
  const now = Date.now();
  if (now - lastCloudSave > CLOUD_SAVE_INTERVAL) {
    lastCloudSave = now;
    saveBrainToCloud(brain);
  }
}

async function saveBrainToCloud(brain: BrainState) {
  try {
    // Save full brain to cloud — trim only logs and recent games (not pitcher/park/matchup memory)
    const cloudVersion = {
      ...brain,
      logs: brain.logs.slice(-20),
      recentGames: brain.recentGames.slice(-15),
      // Keep ALL pitcher memory, park memory, matchup memory — this is the valuable trained data
    };
    const { cloudSet } = await import("@/lib/supabase/client");
    await cloudSet("brain", cloudVersion);
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
            const homeTeam = game.teams?.home?.team?.name ?? "";
            const awayTeam = game.teams?.away?.team?.name ?? "";
            const venueName: string = game.venue?.name ?? "";

            seasonGames++;
            if (homeWon) seasonHomeWins++;
            if (totalRuns > 8.5) seasonTotalOver++;

            // ── Compute real prediction using accumulated memory ──
            // Early games use baseline 0.54; later games use real H2H + park data
            let predictedHomeProb = 0.54;

            const mKey = `${awayTeam.toLowerCase()}::${homeTeam.toLowerCase()}`;
            const matchupMem = updated.matchupMemory[mKey];
            if (matchupMem && matchupMem.games >= 3) {
              const h2hRate = matchupMem.homeWins / matchupMem.games;
              predictedHomeProb = predictedHomeProb * 0.65 + h2hRate * 0.35;
            }

            const parkMem = venueName ? updated.parkMemory[venueName] : null;
            if (parkMem && parkMem.games >= 5) {
              const parkRate = parkMem.homeWins / parkMem.games;
              predictedHomeProb = predictedHomeProb * 0.80 + parkRate * 0.20;
            }

            predictedHomeProb = Math.max(0.38, Math.min(0.65, predictedHomeProb));

            // ── Update matchup memory for future games ──
            if (awayTeam && homeTeam) {
              if (!updated.matchupMemory[mKey]) updated.matchupMemory[mKey] = { games: 0, homeWins: 0 };
              updated.matchupMemory[mKey].games++;
              if (homeWon) updated.matchupMemory[mKey].homeWins++;
            }

            // ── Update park memory for future games ──
            if (venueName) {
              if (!updated.parkMemory[venueName]) {
                updated.parkMemory[venueName] = { games: 0, homeWins: 0, avgRuns: 8.5, nrfiRate: 70 };
              }
              const pk = updated.parkMemory[venueName];
              const alpha = Math.min(0.05, 1 / (pk.games + 1));
              pk.games++;
              if (homeWon) pk.homeWins++;
              pk.avgRuns = pk.avgRuns * (1 - alpha) + totalRuns * alpha;
            }

            // ── Feed real prediction to learning ──
            updated = learnFromResult(updated, {
              market: "moneyline",
              predictedProb: predictedHomeProb,
              won: homeWon,
              ev: 2.0,
            });

            // Total: use park avg if known, else 8.5
            const totalLine = (parkMem && parkMem.games >= 5) ? parkMem.avgRuns : 8.5;
            updated = learnFromResult(updated, {
              market: "total",
              predictedProb: 0.50,
              won: totalRuns > totalLine,
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

  // Adjust weights — with GUARDRAILS to prevent drift to extremes
  const w = { ...updated.weights };
  const FLOOR = 0.04;  // no weight below 4%
  const CEIL = 0.35;   // no weight above 35%

  if (!result.won && predicted > 0.6) {
    w.pitching = Math.max(FLOOR, w.pitching - lr * 0.1);
    w.momentum = Math.max(FLOOR, w.momentum - lr * 0.05);
    w.bullpen = Math.min(CEIL, w.bullpen + lr * 0.05);
  } else if (result.won && predicted < 0.45) {
    w.hitting = Math.min(CEIL, w.hitting + lr * 0.1);
    w.momentum = Math.min(CEIL, w.momentum + lr * 0.05);
  }

  // Enforce floor on ALL weights — nothing goes to 0
  for (const key of Object.keys(w) as (keyof ModelWeights)[]) {
    w[key] = Math.max(FLOOR, Math.min(CEIL, w[key]));
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
    homePitcher?: string;
    awayPitcher?: string;
    venue?: string;
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

  // ── Pitcher-specific memory ──
  if (!updated.pitcherMemory) updated.pitcherMemory = {};
  const totalRuns2 = totalRuns; // alias for NRFI calc
  const firstInningClean = totalRuns2 < 2; // rough NRFI proxy (low-scoring = likely clean 1st)

  for (const pitcherName of [game.homePitcher, game.awayPitcher]) {
    if (!pitcherName || pitcherName === "TBD") continue;
    const key = pitcherName.toLowerCase();
    if (!updated.pitcherMemory[key]) {
      updated.pitcherMemory[key] = {
        name: pitcherName, gamesTracked: 0, wins: 0, losses: 0, winRate: 0,
        avgERAWhenWin: 0, avgERAWhenLoss: 0, nrfiCount: 0, nrfiRate: 0, vsTeams: {},
      };
    }
    const pm = updated.pitcherMemory[key];
    pm.gamesTracked++;
    const pitcherWon = (pitcherName === game.homePitcher && game.homeWon) || (pitcherName === game.awayPitcher && !game.homeWon);
    if (pitcherWon) pm.wins++;
    else pm.losses++;
    pm.winRate = pm.gamesTracked > 0 ? Math.round((pm.wins / pm.gamesTracked) * 1000) / 10 : 50;
    if (firstInningClean) pm.nrfiCount++;
    pm.nrfiRate = pm.gamesTracked > 0 ? Math.round((pm.nrfiCount / pm.gamesTracked) * 1000) / 10 : 65;

    // vs-team tracking
    const opponent = pitcherName === game.homePitcher
      ? game.gameName.split(" @ ")[0] ?? ""
      : game.gameName.split(" @ ")[1] ?? "";
    if (opponent) {
      const oppKey = opponent.toLowerCase().trim();
      if (!pm.vsTeams[oppKey]) pm.vsTeams[oppKey] = { games: 0, wins: 0 };
      pm.vsTeams[oppKey].games++;
      if (pitcherWon) pm.vsTeams[oppKey].wins++;
    }
  }

  // Keep pitcher memory from bloating (max 200 pitchers)
  const pitcherKeys = Object.keys(updated.pitcherMemory);
  if (pitcherKeys.length > 200) {
    const sorted = pitcherKeys.sort((a, b) => (updated.pitcherMemory[b]?.gamesTracked ?? 0) - (updated.pitcherMemory[a]?.gamesTracked ?? 0));
    const keep = new Set(sorted.slice(0, 150));
    for (const k of pitcherKeys) { if (!keep.has(k)) delete updated.pitcherMemory[k]; }
  }

  // ── Park memory ──
  if (!updated.parkMemory) updated.parkMemory = {};
  if (game.venue) {
    if (!updated.parkMemory[game.venue]) {
      updated.parkMemory[game.venue] = { games: 0, homeWins: 0, avgRuns: 8.5, nrfiRate: 70 };
    }
    const pk = updated.parkMemory[game.venue];
    const alpha = Math.min(0.05, 1 / (pk.games + 1));
    pk.games++;
    if (game.homeWon) pk.homeWins++;
    pk.avgRuns = pk.avgRuns * (1 - alpha) + totalRuns * alpha;
    if (firstInningClean) pk.nrfiRate = pk.nrfiRate * (1 - alpha) + 100 * alpha;
    else pk.nrfiRate = pk.nrfiRate * (1 - alpha);
  }

  // ── Matchup memory (team vs team) ──
  if (!updated.matchupMemory) updated.matchupMemory = {};
  const teams = game.gameName.split(" @ ");
  if (teams.length === 2) {
    const matchupKey = `${teams[0].trim().toLowerCase()}::${teams[1].trim().toLowerCase()}`;
    if (!updated.matchupMemory[matchupKey]) {
      updated.matchupMemory[matchupKey] = { games: 0, homeWins: 0 };
    }
    updated.matchupMemory[matchupKey].games++;
    if (game.homeWon) updated.matchupMemory[matchupKey].homeWins++;
  }

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
    pitchersKnown: Object.keys(brain.pitcherMemory ?? {}).length,
    parksKnown: Object.keys(brain.parkMemory ?? {}).length,
    matchupsKnown: Object.keys(brain.matchupMemory ?? {}).length,
    topPitchers: Object.values(brain.pitcherMemory ?? {})
      .filter((p: any) => p.gamesTracked >= 10)
      .sort((a: any, b: any) => b.winRate - a.winRate)
      .slice(0, 5)
      .map((p: any) => ({ name: p.name, winRate: p.winRate, games: p.gamesTracked, nrfiRate: p.nrfiRate })),
  };
}
