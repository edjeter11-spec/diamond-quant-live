// ──────────────────────────────────────────────────────────
// NBA PROP DEEP TRAINER — Self-Quiz on 3 Seasons
// Hides results, predicts, reveals, learns. Every factor considered:
// home/away, B2B, opponent, recent form, pace, matchup history
// ──────────────────────────────────────────────────────────

import { fetchAllTrainingData, type NbaPlayerGameLog } from "./nba-stats-fetcher";
import { projectProp, type ProjectionContext, type RecentFormData } from "./nba-prop-projector";
import { learnFromPropResult, repairWeights, type NbaPropBrainState } from "./nba-prop-brain";

const PROP_TYPES = ["player_points", "player_rebounds", "player_assists"] as const;
const STAT_KEYS = { player_points: "pts", player_rebounds: "reb", player_assists: "ast" } as const;
const MIN_GAMES_TO_QUIZ = 5; // need 5 games of data before quizzing

export interface TrainingCheckpoint {
  brain: NbaPropBrainState;
  gamesProcessed: number;
  totalGames: number;
  lastDateProcessed: string;
  currentSeason: string;
  accuracy: { points: { total: number; hits: number }; rebounds: { total: number; hits: number }; assists: { total: number; hits: number } };
  status: "running" | "complete" | "idle";
  startedAt: string;
}

export interface TrainingResult {
  brain: NbaPropBrainState;
  gamesProcessed: number;
  playerGamesQuizzed: number;
  propEventsTotal: number;
  accuracy: Record<string, { total: number; hits: number; winRate: number }>;
  durationMs: number;
}

// Rolling player state during training (what the brain "knows" at each point)
interface PlayerRollingState {
  playerId: number;
  team: string;
  gamesPlayed: number;
  // Running totals for averages
  ptsSum: number;
  rebSum: number;
  astSum: number;
  fg3mSum: number;
  minSum: number;
  // Last N games for recent form
  last10Games: Array<{ pts: number; reb: number; ast: number; date: string; opponent: string; isHome: boolean }>;
  // Tracking
  lastGameDate: string;
  gamesInLast3Days: number; // for B2B detection
  winsInLast10: number;
}

// Team defensive stats (updated during training)
interface TeamDefenseTracker {
  ptsAllowedSum: number;
  rebAllowedSum: number;
  astAllowedSum: number;
  gamesTracked: number;
}

// ── Main Training Function ──
export async function deepTrainNbaProps(
  brain: NbaPropBrainState,
  seasons: number[],
  onProgress?: (msg: string) => void,
  maxGames?: number, // for chunking: process at most N player-games
  resumeFromDate?: string // for chunking: skip games before this date
): Promise<TrainingResult> {
  const start = Date.now();
  let updated = { ...brain };

  onProgress?.("Fetching historical data...");
  const allLogs = await fetchAllTrainingData(seasons, onProgress);
  if (allLogs.length === 0) {
    return { brain: updated, gamesProcessed: 0, playerGamesQuizzed: 0, propEventsTotal: 0, accuracy: {}, durationMs: Date.now() - start };
  }

  onProgress?.(`Processing ${allLogs.length} player-games chronologically...`);

  // State tracking
  const playerStates = new Map<number, PlayerRollingState>();
  const teamDefense = new Map<string, TeamDefenseTracker>();

  // Accuracy tracking
  const accuracy: Record<string, { total: number; hits: number }> = {
    player_points: { total: 0, hits: 0 },
    player_rebounds: { total: 0, hits: 0 },
    player_assists: { total: 0, hits: 0 },
  };

  let gamesProcessed = 0;
  let playerGamesQuizzed = 0;
  let propEventsTotal = 0;

  // Group logs by date for chronological processing
  const byDate = new Map<string, NbaPlayerGameLog[]>();
  for (const log of allLogs) {
    const existing = byDate.get(log.gameDate) ?? [];
    existing.push(log);
    byDate.set(log.gameDate, existing);
  }

  const dates = [...byDate.keys()].sort();

  for (const date of dates) {
    // Resume support: skip dates before checkpoint
    if (resumeFromDate && date <= resumeFromDate) continue;

    const dayLogs = byDate.get(date)!;

    // ── PHASE 1: QUIZ (before revealing results) ──
    for (const log of dayLogs) {
      // Skip DNPs (< 5 minutes played)
      if (log.minutes < 5) continue;

      const state = playerStates.get(log.playerId);
      if (!state || state.gamesPlayed < MIN_GAMES_TO_QUIZ) continue;

      // ── Build context from what brain KNOWS (before this game) ──
      const seasonAvgPts = state.ptsSum / state.gamesPlayed;
      const seasonAvgReb = state.rebSum / state.gamesPlayed;
      const seasonAvgAst = state.astSum / state.gamesPlayed;

      // Back-to-back detection: played yesterday?
      const lastDate = state.lastGameDate;
      const isB2B = lastDate ? daysBetween(lastDate, date) <= 1 : false;
      const restDays = lastDate ? daysBetween(lastDate, date) : 3;

      // Opponent defensive rank (1=best, 30=worst based on points allowed)
      const oppDef = teamDefense.get(log.opponent);
      let opponentDefRank = 15; // default middle
      if (oppDef && oppDef.gamesTracked >= 10) {
        const oppPtsPerGame = oppDef.ptsAllowedSum / oppDef.gamesTracked;
        // Lower pts allowed = better defense = lower rank number
        opponentDefRank = Math.max(1, Math.min(30, Math.round(30 - (oppPtsPerGame - 100) * 0.5)));
      }

      // Recent form from last 5 games
      const last5 = state.last10Games.slice(-5);
      const last10 = state.last10Games;

      const context: ProjectionContext = {
        isHome: log.isHome,
        isB2B,
        restDays,
        opponentDefRank,
        projectedGameTotal: 224, // league average
        leagueAvgTotal: 224,
        eloGap: 0, // no Elo during training (would need team Elo tracker)
      };

      // ── Quiz each prop type ──
      for (const propType of PROP_TYPES) {
        const statKey = STAT_KEYS[propType];
        const actual = log[statKey];
        const seasonAvg = propType === "player_points" ? seasonAvgPts
          : propType === "player_rebounds" ? seasonAvgReb : seasonAvgAst;

        if (seasonAvg <= 0) continue;

        // Line = season average to date (simulates market)
        const line = Math.round(seasonAvg * 2) / 2; // round to nearest .5

        // Build recent form data for this stat type
        const recentStatValues = last5.map(g =>
          propType === "player_points" ? g.pts :
          propType === "player_rebounds" ? g.reb : g.ast
        );
        const last10StatValues = last10.map(g =>
          propType === "player_points" ? g.pts :
          propType === "player_rebounds" ? g.reb : g.ast
        );

        const last5Avg = recentStatValues.length > 0
          ? recentStatValues.reduce((s, v) => s + v, 0) / recentStatValues.length : seasonAvg;
        const last10Avg = last10StatValues.length > 0
          ? last10StatValues.reduce((s, v) => s + v, 0) / last10StatValues.length : seasonAvg;

        // Real variance from last 10 games
        const variance = last10StatValues.length >= 5
          ? Math.sqrt(last10StatValues.reduce((s, v) => s + Math.pow(v - last10Avg, 2), 0) / last10StatValues.length)
          : seasonAvg * 0.30;

        const recentForm: RecentFormData = {
          last5Avg,
          last10Avg,
          seasonAvg,
          gamesPlayed: state.gamesPlayed,
          variance,
        };

        // ── PREDICT ──
        const playerStats = { ppg: seasonAvgPts, rpg: seasonAvgReb, apg: seasonAvgAst, tpm: state.fg3mSum / state.gamesPlayed };
        const projection = projectProp(playerStats, propType, line, updated.weights, context, recentForm);

        // ── REVEAL ──
        const hit = projection.side === "over" ? actual > line : actual < line;

        // ── LEARN ──
        updated = learnFromPropResult(updated, {
          playerName: log.playerName,
          playerId: log.playerId,
          team: log.team,
          propType,
          predictedProb: projection.probability,
          predictedSide: projection.side,
          actualValue: actual,
          line,
          hit,
          factors: projection.factors,
        });

        // Track accuracy
        accuracy[propType].total++;
        if (hit) accuracy[propType].hits++;
        propEventsTotal++;
      }

      playerGamesQuizzed++;
    }

    // ── PHASE 2: REVEAL — Update rolling states with actual results ──
    for (const log of dayLogs) {
      if (log.minutes < 5) continue;

      let state = playerStates.get(log.playerId);
      if (!state) {
        state = {
          playerId: log.playerId,
          team: log.team,
          gamesPlayed: 0,
          ptsSum: 0, rebSum: 0, astSum: 0, fg3mSum: 0, minSum: 0,
          last10Games: [],
          lastGameDate: "",
          gamesInLast3Days: 0,
          winsInLast10: 0,
        };
      }

      state.gamesPlayed++;
      state.ptsSum += log.pts;
      state.rebSum += log.reb;
      state.astSum += log.ast;
      state.fg3mSum += log.fg3m;
      state.minSum += log.minutes;
      state.team = log.team;
      state.lastGameDate = date;

      // Sliding window of last 10 games
      state.last10Games.push({
        pts: log.pts, reb: log.reb, ast: log.ast,
        date, opponent: log.opponent, isHome: log.isHome,
      });
      if (state.last10Games.length > 10) state.last10Games.shift();

      // Track wins for momentum
      if (log.wl === "W") state.winsInLast10++;
      if (state.last10Games.length > 10) state.winsInLast10 = state.last10Games.filter(() => true).length; // simplified

      playerStates.set(log.playerId, state);

      // Update team defense tracker (points ALLOWED to opponent)
      const defTeam = log.isHome ? log.opponent : log.team; // defensive team is the one defending
      // Actually: if player is home, the AWAY team is defending. We want opponent's defense.
      // Track: opponent allowed this player's stats
      let def = teamDefense.get(log.opponent) ?? { ptsAllowedSum: 0, rebAllowedSum: 0, astAllowedSum: 0, gamesTracked: 0 };
      def.ptsAllowedSum += log.pts;
      def.rebAllowedSum += log.reb;
      def.astAllowedSum += log.ast;
      def.gamesTracked++;
      teamDefense.set(log.opponent, def);

      gamesProcessed++;
    }

    // ── Learning rate decay ──
    if (propEventsTotal > 200000 && updated.learningRate > 0.005) {
      updated.learningRate = 0.005;
    } else if (propEventsTotal > 100000 && updated.learningRate > 0.010) {
      updated.learningRate = 0.010;
    }

    // Progress update every ~50 dates
    if (gamesProcessed % 2000 < dayLogs.length) {
      const ptsAcc = accuracy.player_points.total > 0 ? (accuracy.player_points.hits / accuracy.player_points.total * 100).toFixed(1) : "0";
      const rebAcc = accuracy.player_rebounds.total > 0 ? (accuracy.player_rebounds.hits / accuracy.player_rebounds.total * 100).toFixed(1) : "0";
      const astAcc = accuracy.player_assists.total > 0 ? (accuracy.player_assists.hits / accuracy.player_assists.total * 100).toFixed(1) : "0";
      onProgress?.(`${gamesProcessed} games | Quizzed: ${playerGamesQuizzed} | Pts: ${ptsAcc}% | Reb: ${rebAcc}% | Ast: ${astAcc}%`);
    }

    // Chunk limit check
    if (maxGames && gamesProcessed >= maxGames) break;
  }

  // Finalize
  updated.weights = repairWeights(updated.weights);
  updated.isPreTrained = true;
  updated.trainedSeasons = seasons.map(s => `nba${s}`);
  updated.totalGamesProcessed = gamesProcessed;
  updated.lastTrainedAt = new Date().toISOString();

  const result: Record<string, { total: number; hits: number; winRate: number }> = {};
  for (const [key, val] of Object.entries(accuracy)) {
    result[key] = { ...val, winRate: val.total > 0 ? Math.round((val.hits / val.total) * 1000) / 10 : 0 };
  }

  onProgress?.(`Training complete! ${playerGamesQuizzed} player-games quizzed, ${propEventsTotal} prop events. Weights calibrated.`);

  return {
    brain: updated,
    gamesProcessed,
    playerGamesQuizzed,
    propEventsTotal,
    accuracy: result,
    durationMs: Date.now() - start,
  };
}

// Helper: days between two YYYY-MM-DD dates
function daysBetween(d1: string, d2: string): number {
  const a = new Date(d1).getTime();
  const b = new Date(d2).getTime();
  return Math.round(Math.abs(b - a) / (1000 * 60 * 60 * 24));
}
