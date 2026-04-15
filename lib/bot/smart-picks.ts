// ──────────────────────────────────────────────────────────
// SMART PICKS — Bot picks powered by 3-Model Analysis
// Also handles auto-learning and per-model accuracy tracking
// ──────────────────────────────────────────────────────────

import { americanToDecimal, americanToImpliedProb, kellyStake } from "@/lib/model/kelly";
import { loadBrain, saveBrain, learnFromGame, type BrainState } from "./brain";
import type { GameAnalysis, GamePick } from "./three-models";

// ── Per-model accuracy tracking ──

export interface ModelAccuracy {
  pitcher: { correct: number; total: number; winRate: number };
  market: { correct: number; total: number; winRate: number };
  trend: { correct: number; total: number; winRate: number };
  consensus: { correct: number; total: number; winRate: number };
  lastUpdated: string;
}

export function loadModelAccuracy(): ModelAccuracy {
  if (typeof window === "undefined") return defaultAccuracy();
  try {
    const stored = localStorage.getItem("dq_model_accuracy");
    if (stored) return JSON.parse(stored);
  } catch {}
  return defaultAccuracy();
}

export function saveModelAccuracy(acc: ModelAccuracy) {
  if (typeof window !== "undefined") {
    try { localStorage.setItem("dq_model_accuracy", JSON.stringify(acc)); } catch {}
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

export function loadSmartBot(): SmartBotState {
  if (typeof window === "undefined") return { bankroll: STARTING_BANKROLL, picks: [], dailyPnL: {} };
  try {
    const stored = localStorage.getItem("dq_smart_bot");
    if (stored) return JSON.parse(stored);
  } catch {}
  return { bankroll: STARTING_BANKROLL, picks: [], dailyPnL: {} };
}

export function saveSmartBot(state: SmartBotState) {
  if (typeof window !== "undefined") {
    try { localStorage.setItem("dq_smart_bot", JSON.stringify(state)); } catch {}
  }
  syncSmartBotToCloud(state);
}

async function syncSmartBotToCloud(state: SmartBotState) {
  try {
    const { cloudSet } = await import("@/lib/supabase/client");
    await cloudSet("smart_bot", state);
  } catch {}
}

// ── Generate 4 picks from 3-model analysis ──

export function generateSmartPicks(
  analyses: GameAnalysis[],
  bankroll: number
): SmartBotPick[] {
  const today = new Date().toISOString().split("T")[0];

  // Sort: HIGH confidence first, then MEDIUM, then by consensus probability strength
  const ranked = [...analyses]
    .filter(a => a.consensus.confidence !== "NO_PLAY")
    .sort((a, b) => {
      const confOrder: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      const aConf = confOrder[a.consensus.confidence] ?? 2;
      const bConf = confOrder[b.consensus.confidence] ?? 2;
      if (aConf !== bConf) return aConf - bConf;
      // Within same confidence, pick the one with strongest probability lean
      return Math.abs(b.consensus.homeWinProb - 0.5) - Math.abs(a.consensus.homeWinProb - 0.5);
    });

  const picks: SmartBotPick[] = [];
  const usedGames = new Set<string>();

  for (const game of ranked) {
    if (picks.length >= 4) break;
    const gameName = `${game.awayTeam} @ ${game.homeTeam}`;
    if (usedGames.has(gameName)) continue;
    usedGames.add(gameName);

    // Decide side
    const isHome = game.consensus.homeWinProb > 0.50;
    const pickTeam = isHome ? game.homeTeam : game.awayTeam;
    const pickOdds = isHome ? game.bestHomeML : game.bestAwayML;
    const pickBook = isHome ? game.bestHomeBook : game.bestAwayBook;
    const fairProb = isHome ? game.consensus.homeWinProb : 1 - game.consensus.homeWinProb;

    if (pickOdds === -999 || pickOdds === 0) continue;

    const decOdds = americanToDecimal(pickOdds);
    const rawKelly = kellyStake(fairProb, decOdds, bankroll, 0.15); // reduced from 0.25 to 0.15
    // Cap: min $50, max $150 (prevents huge variance between bets)
    const stake = Math.max(Math.min(rawKelly, 150), 50);

    const reasoning = [
      `Pitcher Model: ${(game.pitcherModel.homeWinProb * 100).toFixed(0)}% home — ${game.pitcherModel.factors[0] ?? ""}`,
      `Market Model: ${(game.marketModel.homeWinProb * 100).toFixed(0)}% home — ${game.marketModel.factors[0] ?? ""}`,
      `Trend Model: ${(game.trendModel.homeWinProb * 100).toFixed(0)}% home — ${game.trendModel.factors[0] ?? ""}`,
      `Consensus: ${(game.consensus.homeWinProb * 100).toFixed(1)}% home | Models ${game.consensus.modelsAgree ? "AGREE" : "DISAGREE"}`,
      game.homePitcher ? `Home: ${game.homePitcher.name} (${game.homePitcher.era} ERA, ${game.homePitcher.whip} WHIP)` : "",
      game.awayPitcher ? `Away: ${game.awayPitcher.name} (${game.awayPitcher.era} ERA, ${game.awayPitcher.whip} WHIP)` : "",
    ].filter(Boolean);

    picks.push({
      id: `smart-${today}-${picks.length}`,
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
      confidence: game.consensus.confidence,
      reasoning,
    });
  }

  return picks;
}

// ── Auto-settle + learn from results ──

export function settleAndLearn(
  botState: SmartBotState,
  scores: any[]
): { botState: SmartBotState; accuracy: ModelAccuracy } {
  let accuracy = loadModelAccuracy();
  let changed = false;

  const updatedPicks = botState.picks.map(pick => {
    if (pick.result !== "pending") return pick;

    const score = scores.find((s: any) => {
      if (s.status !== "final") return false;
      return pick.game.includes(s.homeTeam) || pick.game.includes(s.awayTeam) ||
        pick.game.includes(s.homeAbbrev) || pick.game.includes(s.awayAbbrev);
    });
    if (!score) return pick;

    changed = true;
    const homeWon = score.homeScore > score.awayScore;
    const awayWon = score.awayScore > score.homeScore;
    const finalScore = `${score.awayAbbrev} ${score.awayScore} - ${score.homeAbbrev} ${score.homeScore}`;

    // Determine result
    let result: SmartBotPick["result"] = "loss";
    let payout = 0;
    const pickedHome = pick.pick.includes(score.homeTeam) || pick.pick.includes(score.homeAbbrev);
    const pickedAway = pick.pick.includes(score.awayTeam) || pick.pick.includes(score.awayAbbrev);

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
    accuracy.pitcher.winRate = Math.round((accuracy.pitcher.correct / accuracy.pitcher.total) * 1000) / 10;

    accuracy.market.total++;
    if (marketCorrect) accuracy.market.correct++;
    accuracy.market.winRate = Math.round((accuracy.market.correct / accuracy.market.total) * 1000) / 10;

    accuracy.trend.total++;
    if (trendCorrect) accuracy.trend.correct++;
    accuracy.trend.winRate = Math.round((accuracy.trend.correct / accuracy.trend.total) * 1000) / 10;

    accuracy.consensus.total++;
    if (consensusCorrect) accuracy.consensus.correct++;
    accuracy.consensus.winRate = Math.round((accuracy.consensus.correct / accuracy.consensus.total) * 1000) / 10;

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
  const totalReturns = updatedPicks.filter(p => p.result !== "pending").reduce((s, p) => s + p.payout, 0);
  const pendingStake = updatedPicks.filter(p => p.result === "pending").reduce((s, p) => s + p.stake, 0);

  // Daily P&L
  const dailyPnL: Record<string, number> = {};
  for (const pick of updatedPicks.filter(p => p.result !== "pending")) {
    dailyPnL[pick.date] = (dailyPnL[pick.date] ?? 0) + (pick.payout - pick.stake);
  }

  const newState: SmartBotState = {
    bankroll: STARTING_BANKROLL + totalReturns - totalStaked + pendingStake,
    picks: updatedPicks,
    dailyPnL,
  };

  saveSmartBot(newState);
  saveModelAccuracy(accuracy);

  return { botState: newState, accuracy };
}
