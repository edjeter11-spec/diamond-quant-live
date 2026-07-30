// ──────────────────────────────────────────────────────────
// SMART PICKS — Bot picks powered by 3-Model Analysis
// Also handles auto-learning and per-model accuracy tracking
// ──────────────────────────────────────────────────────────

import {
  americanToDecimal,
  americanToImpliedProb,
  kellyStake,
} from "@/lib/model/kelly";
import { loadJSON, isRecord } from "@/lib/safe-storage";
import { loadBrain, saveBrain, learnFromGame, type BrainState } from "./brain";
import type { GameAnalysis, GamePick } from "./three-models";
import { etDateString } from "@/lib/sports-date";

// Minimum edge (%) against the best available line before the bot will bet a
// game. Without this the bot ranked purely on model win probability, so a
// heavy favorite at a bad price counted as a "pick".
const MIN_EV_FLOOR = 0.5;

// ── Per-model accuracy tracking ──

export interface ModelAccuracy {
  pitcher: { correct: number; total: number; winRate: number };
  market: { correct: number; total: number; winRate: number };
  trend: { correct: number; total: number; winRate: number };
  consensus: { correct: number; total: number; winRate: number };
  lastUpdated: string;
}

export function loadModelAccuracy(): ModelAccuracy {
  // Validated read — a corrupt `dq_model_accuracy` key used to crash the tab.
  return loadJSON<ModelAccuracy>(
    "dq_model_accuracy",
    defaultAccuracy(),
    (v) =>
      isRecord(v) &&
      ["pitcher", "market", "trend", "consensus"].every(
        (k) => isRecord(v[k]) && typeof (v[k] as any).total === "number",
      ),
  );
}

export function saveModelAccuracy(acc: ModelAccuracy) {
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem("dq_model_accuracy", JSON.stringify(acc));
    } catch {}
  }
  // Cloud sync
  syncAccuracyToCloud(acc);
}

async function syncAccuracyToCloud(acc: ModelAccuracy) {
  try {
    const { cloudSet } = await import("@/lib/supabase/client");
    await cloudSet("model_accuracy", acc);
  } catch {}
}

function defaultAccuracy(): ModelAccuracy {
  return {
    pitcher: { correct: 0, total: 0, winRate: 0 },
    market: { correct: 0, total: 0, winRate: 0 },
    trend: { correct: 0, total: 0, winRate: 0 },
    consensus: { correct: 0, total: 0, winRate: 0 },
    lastUpdated: new Date().toISOString(),
  };
}

// ── Smart Bot Pick ──

export interface SmartBotPick {
  id: string;
  gameId?: string; // MLB gamePk — used for reliable settlement matching
  date: string;
  game: string;
  pick: string;
  market: string;
  odds: number;
  bookmaker: string;
  stake: number;
  result: "pending" | "win" | "loss" | "push";
  payout: number;
  // 3-model data
  pitcherScore: number;
  marketScore: number;
  trendScore: number;
  consensusProb: number;
  confidence: string;
  reasoning: string[];
  // Value context — model vs market at the price actually bet
  fairProb?: number;
  impliedProb?: number;
  evPercentage?: number;
  // True only when no game cleared the confidence+EV bar today and this is
  // the least-bad option shown for visibility, not a real recommendation.
  isForcedPick?: boolean;
  // Settlement
  finalScore?: string;
  settledAt?: string;
  // Which models were right (filled after settlement)
  pitcherCorrect?: boolean;
  marketCorrect?: boolean;
  trendCorrect?: boolean;
}

export interface SmartBotState {
  bankroll: number;
  picks: SmartBotPick[];
  dailyPnL: Record<string, number>;
}

const STARTING_BANKROLL = 5000;

// Sport-aware load/save — MLB and NBA have separate bot states
export function loadSmartBot(sport: string = "mlb"): SmartBotState {
  const key = sport === "nba" ? "dq_smart_bot_nba" : "dq_smart_bot";
  // Validated read — a corrupt bot-state key used to crash the tab on load.
  return loadJSON<SmartBotState>(
    key,
    { bankroll: STARTING_BANKROLL, picks: [], dailyPnL: {} },
    (v) =>
      isRecord(v) && typeof v.bankroll === "number" && Array.isArray(v.picks),
  );
}

export function saveSmartBot(state: SmartBotState, sport: string = "mlb") {
  if (typeof window !== "undefined") {
    const key = sport === "nba" ? "dq_smart_bot_nba" : "dq_smart_bot";
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {}
  }
  syncSmartBotToCloud(state, sport);
}

async function syncSmartBotToCloud(
  state: SmartBotState,
  sport: string = "mlb",
) {
  try {
    const { cloudSet } = await import("@/lib/supabase/client");
    const cloudKey = sport === "nba" ? "smart_bot_nba" : "smart_bot";
    await cloudSet(cloudKey, state);
  } catch {}
}

// ── Generate 4 picks from 3-model analysis ──

export function generateSmartPicks(
  analyses: GameAnalysis[],
  bankroll: number,
): SmartBotPick[] {
  const today = etDateString();

  // Sort: HIGH confidence first, then MEDIUM, then by consensus probability strength
  const ranked = [...analyses]
    .filter((a) => a.consensus.confidence !== "NO_PLAY")
    .sort((a, b) => {
      const confOrder: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      const aConf = confOrder[a.consensus.confidence] ?? 2;
      const bConf = confOrder[b.consensus.confidence] ?? 2;
      if (aConf !== bConf) return aConf - bConf;
      // Within same confidence, pick the one with strongest probability lean
      return (
        Math.abs(b.consensus.homeWinProb - 0.5) -
        Math.abs(a.consensus.homeWinProb - 0.5)
      );
    });

  const picks: SmartBotPick[] = [];
  const usedGames = new Set<string>();

  for (const game of ranked) {
    if (picks.length >= 4) break;
    const gameName = `${game.awayTeam} @ ${game.homeTeam}`;
    if (usedGames.has(gameName)) continue;
    usedGames.add(gameName);

    // Decide side
    const isHome = game.consensus.homeWinProb > 0.5;
    const pickTeam = isHome ? game.homeTeam : game.awayTeam;
    const pickOdds = isHome ? game.bestHomeML : game.bestAwayML;
    const pickBook = isHome ? game.bestHomeBook : game.bestAwayBook;
    const fairProb = isHome
      ? game.consensus.homeWinProb
      : 1 - game.consensus.homeWinProb;

    if (pickOdds === -999 || pickOdds === 0) continue;

    const decOdds = americanToDecimal(pickOdds);

    // ── Price check (odds-aware gate) ──
    // Previously this ranked purely on model win probability and took the top
    // 4, so a 70% favorite at -400 (negative EV) could be a "pick". Require a
    // real edge against the best available line before betting it.
    const impliedProb = americanToImpliedProb(pickOdds);
    const evPercentage = (fairProb * decOdds - 1) * 100;
    if (!Number.isFinite(evPercentage) || evPercentage < MIN_EV_FLOOR) continue;

    // Price also caps confidence — a thin edge can't be a HIGH-confidence play
    let confidence = game.consensus.confidence;
    if (evPercentage < 1) confidence = "LOW";
    else if (evPercentage < 2 && confidence === "HIGH") confidence = "MEDIUM";

    const rawKelly = kellyStake(fairProb, decOdds, bankroll, 0.15); // reduced from 0.25 to 0.15
    // Cap: min $50, max $150 (prevents huge variance between bets)
    const stake = Math.max(Math.min(rawKelly, 150), 50);

    const reasoning = [
      `Price check: fair ${(fairProb * 100).toFixed(1)}% vs implied ${(impliedProb * 100).toFixed(1)}% → EV ${evPercentage >= 0 ? "+" : ""}${evPercentage.toFixed(1)}% at ${pickBook}`,
      `Pitcher Model: ${(game.pitcherModel.homeWinProb * 100).toFixed(0)}% home — ${game.pitcherModel.factors[0] ?? ""}`,
      `Market Model: ${(game.marketModel.homeWinProb * 100).toFixed(0)}% home — ${game.marketModel.factors[0] ?? ""}`,
      `Elo Power: ${(game.trendModel.homeWinProb * 100).toFixed(0)}% home — ${game.trendModel.factors[0] ?? ""}`,
      `Consensus: ${(game.consensus.homeWinProb * 100).toFixed(1)}% home | Models ${game.consensus.modelsAgree ? "AGREE" : "DISAGREE"}`,
      game.homePitcher
        ? `Home: ${game.homePitcher.name} (${game.homePitcher.era} ERA, ${game.homePitcher.whip} WHIP)`
        : "",
      game.awayPitcher
        ? `Away: ${game.awayPitcher.name} (${game.awayPitcher.era} ERA, ${game.awayPitcher.whip} WHIP)`
        : "",
    ].filter(Boolean);

    picks.push({
      id: `smart-${today}-${picks.length}`,
      gameId: game.gameId,
      date: today,
      game: gameName,
      pick: `${pickTeam} ML`,
      market: "moneyline",
      odds: pickOdds,
      bookmaker: pickBook,
      stake: Math.round(stake * 100) / 100,
      result: "pending",
      payout: 0,
      pitcherScore: Math.round(game.pitcherModel.homeWinProb * 100),
      marketScore: Math.round(game.marketModel.homeWinProb * 100),
      trendScore: Math.round(game.trendModel.homeWinProb * 100),
      consensusProb: Math.round(game.consensus.homeWinProb * 1000) / 10,
      confidence,
      reasoning,
      // Value context (additive) — lets the UI show why this price is a bet
      fairProb: Math.round(fairProb * 1000) / 10,
      impliedProb: Math.round(impliedProb * 1000) / 10,
      evPercentage: Math.round(evPercentage * 10) / 10,
    });
  }

  // No game cleared both the confidence bar AND the price bar today — that's
  // a real outcome, not a bug, and it should stay the default (a bad forced
  // bet is worse than no bet). But an empty tab looks broken and gives no
  // signal at all. Surface the single least-bad option as an explicit
  // "closest call" — same math, clearly labeled as NOT a real recommendation,
  // staked at the table minimum only.
  if (picks.length === 0 && analyses.length > 0) {
    let best: {
      game: GameAnalysis;
      pickOdds: number;
      pickBook: string;
      pickTeam: string;
      fairProb: number;
      evPercentage: number;
    } | null = null;
    for (const game of analyses) {
      const isHome = game.consensus.homeWinProb > 0.5;
      const pickOdds = isHome ? game.bestHomeML : game.bestAwayML;
      const pickBook = isHome ? game.bestHomeBook : game.bestAwayBook;
      const pickTeam = isHome ? game.homeTeam : game.awayTeam;
      const fairProb = isHome
        ? game.consensus.homeWinProb
        : 1 - game.consensus.homeWinProb;
      if (pickOdds === -999 || pickOdds === 0) continue;
      const decOdds = americanToDecimal(pickOdds);
      const evPercentage = (fairProb * decOdds - 1) * 100;
      if (!Number.isFinite(evPercentage)) continue;
      if (!best || evPercentage > best.evPercentage) {
        best = { game, pickOdds, pickBook, pickTeam, fairProb, evPercentage };
      }
    }
    if (best) {
      const impliedProb = americanToImpliedProb(best.pickOdds);
      picks.push({
        id: `smart-${today}-forced`,
        gameId: best.game.gameId,
        date: today,
        game: `${best.game.awayTeam} @ ${best.game.homeTeam}`,
        pick: `${best.pickTeam} ML`,
        market: "moneyline",
        odds: best.pickOdds,
        bookmaker: best.pickBook,
        stake: 50,
        result: "pending",
        payout: 0,
        pitcherScore: Math.round(best.game.pitcherModel.homeWinProb * 100),
        marketScore: Math.round(best.game.marketModel.homeWinProb * 100),
        trendScore: Math.round(best.game.trendModel.homeWinProb * 100),
        consensusProb: Math.round(best.game.consensus.homeWinProb * 1000) / 10,
        confidence: "NO_PLAY",
        reasoning: [
          "No game today clears both the model's confidence bar and a real market edge — this is the closest call, not a recommended bet.",
          `Price check: fair ${(best.fairProb * 100).toFixed(1)}% vs implied ${(impliedProb * 100).toFixed(1)}% → EV ${best.evPercentage >= 0 ? "+" : ""}${best.evPercentage.toFixed(1)}% at ${best.pickBook}`,
        ],
        fairProb: Math.round(best.fairProb * 1000) / 10,
        impliedProb: Math.round(impliedProb * 1000) / 10,
        evPercentage: Math.round(best.evPercentage * 10) / 10,
        isForcedPick: true,
      });
    }
  }

  return picks;
}

// ── Auto-settle + learn from results ──

export function settleAndLearn(
  botState: SmartBotState,
  scores: any[],
  sport: string = "mlb",
): { botState: SmartBotState; accuracy: ModelAccuracy } {
  let accuracy = loadModelAccuracy();
  let changed = false;

  const updatedPicks = botState.picks.map((pick) => {
    if (pick.result !== "pending") return pick;

    const norm = (s: string | undefined | null) =>
      (s ?? "").toLowerCase().trim();
    const teamMatch = (pickTeam: string, fullName: string, abbrev: string) => {
      const a = norm(pickTeam),
        f = norm(fullName),
        ab = norm(abbrev);
      if (!a) return false;
      if (ab && a === ab) return true;
      if (f && (f.includes(a) || a.includes(f))) return true;
      // Last-word (nickname) match: "Lakers" vs "Los Angeles Lakers"
      const lastWord = f.split(/\s+/).pop() ?? "";
      if (lastWord && a.includes(lastWord)) return true;
      return false;
    };
    const score = scores.find((s: any) => {
      if (s.status !== "final") return false;
      if (pick.gameId && s.id && pick.gameId === String(s.id)) return true;
      const [pickAway, pickHome] = pick.game.split(" @ ");
      const awayHit = pickAway && teamMatch(pickAway, s.awayTeam, s.awayAbbrev);
      const homeHit = pickHome && teamMatch(pickHome, s.homeTeam, s.homeAbbrev);
      return !!(awayHit && homeHit);
    });
    if (!score) return pick;

    changed = true;
    const homeWon = score.homeScore > score.awayScore;
    const awayWon = score.awayScore > score.homeScore;
    const finalScore = `${score.awayAbbrev} ${score.awayScore} - ${score.homeAbbrev} ${score.homeScore}`;

    // Determine result
    let result: SmartBotPick["result"] = "loss";
    let payout = 0;
    const pickedHome =
      pick.pick.includes(score.homeTeam) ||
      pick.pick.includes(score.homeAbbrev);
    const pickedAway =
      pick.pick.includes(score.awayTeam) ||
      pick.pick.includes(score.awayAbbrev);

    if ((pickedHome && homeWon) || (pickedAway && awayWon)) {
      result = "win";
      payout = pick.stake * americanToDecimal(pick.odds);
    } else if (score.homeScore === score.awayScore) {
      result = "push";
      payout = pick.stake;
    }

    // ── Grade each model ──
    const actualHomeWon = homeWon;
    const pitcherPredictedHome = pick.pitcherScore > 50;
    const marketPredictedHome = pick.marketScore > 50;
    const trendPredictedHome = pick.trendScore > 50;
    const consensusPredictedHome = pick.consensusProb > 50;

    const pitcherCorrect = pitcherPredictedHome === actualHomeWon;
    const marketCorrect = marketPredictedHome === actualHomeWon;
    const trendCorrect = trendPredictedHome === actualHomeWon;
    const consensusCorrect = consensusPredictedHome === actualHomeWon;

    // Update per-model accuracy
    accuracy.pitcher.total++;
    if (pitcherCorrect) accuracy.pitcher.correct++;
    accuracy.pitcher.winRate =
      Math.round((accuracy.pitcher.correct / accuracy.pitcher.total) * 1000) /
      10;

    accuracy.market.total++;
    if (marketCorrect) accuracy.market.correct++;
    accuracy.market.winRate =
      Math.round((accuracy.market.correct / accuracy.market.total) * 1000) / 10;

    accuracy.trend.total++;
    if (trendCorrect) accuracy.trend.correct++;
    accuracy.trend.winRate =
      Math.round((accuracy.trend.correct / accuracy.trend.total) * 1000) / 10;

    accuracy.consensus.total++;
    if (consensusCorrect) accuracy.consensus.correct++;
    accuracy.consensus.winRate =
      Math.round(
        (accuracy.consensus.correct / accuracy.consensus.total) * 1000,
      ) / 10;

    accuracy.lastUpdated = new Date().toISOString();

    // ── Feed to Brain ──
    let brain = loadBrain();
    brain = learnFromGame(brain, {
      id: pick.id,
      date: pick.date,
      gameName: pick.game,
      homeWon: actualHomeWon,
      homeScore: score.homeScore,
      awayScore: score.awayScore,
      predictedHomeProb: pick.consensusProb / 100,
    });
    saveBrain(brain);

    return {
      ...pick,
      result,
      payout: Math.round(payout * 100) / 100,
      finalScore,
      settledAt: new Date().toISOString(),
      pitcherCorrect,
      marketCorrect,
      trendCorrect,
    };
  });

  if (!changed) return { botState, accuracy };

  // Recalculate bankroll
  const totalStaked = updatedPicks.reduce((s, p) => s + p.stake, 0);
  const totalReturns = updatedPicks
    .filter((p) => p.result !== "pending")
    .reduce((s, p) => s + p.payout, 0);
  const pendingStake = updatedPicks
    .filter((p) => p.result === "pending")
    .reduce((s, p) => s + p.stake, 0);

  // Daily P&L
  const dailyPnL: Record<string, number> = {};
  for (const pick of updatedPicks.filter((p) => p.result !== "pending")) {
    dailyPnL[pick.date] =
      (dailyPnL[pick.date] ?? 0) + (pick.payout - pick.stake);
  }

  const newState: SmartBotState = {
    bankroll: STARTING_BANKROLL + totalReturns - totalStaked + pendingStake,
    picks: updatedPicks,
    dailyPnL,
  };

  saveSmartBot(newState, sport);
  saveModelAccuracy(accuracy);

  return { botState: newState, accuracy };
}
