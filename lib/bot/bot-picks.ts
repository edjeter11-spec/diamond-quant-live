// ──────────────────────────────────────────────────────────
// Bot Challenge — Simulated $5,000 bankroll
// Picks 4 bets per day using model logic on FanDuel odds only
// ──────────────────────────────────────────────────────────

import { americanToDecimal, americanToImpliedProb, kellyStake, evPercentage, devig } from "@/lib/model/kelly";

export interface BotPick {
  id: string;
  date: string;           // YYYY-MM-DD
  game: string;
  pick: string;
  market: string;         // "moneyline" | "spread" | "total"
  odds: number;           // American, FanDuel only
  stake: number;
  result: "pending" | "win" | "loss" | "push";
  payout: number;
  // Transparent reasoning
  fairProb: number;       // model's fair probability %
  impliedProb: number;    // what FanDuel odds imply %
  evEdge: number;         // EV % edge
  confidence: string;
  reasoning: string[];    // step-by-step thought process
  // Settlement
  finalScore?: string;
  settledAt?: string;
}

export interface BotState {
  startingBankroll: number;
  currentBankroll: number;
  picks: BotPick[];
  dailyPnL: Record<string, number>; // date -> profit/loss
}

const STARTING_BANKROLL = 5000;

// Load bot state from localStorage
export function loadBotState(): BotState {
  if (typeof window === "undefined") {
    return { startingBankroll: STARTING_BANKROLL, currentBankroll: STARTING_BANKROLL, picks: [], dailyPnL: {} };
  }
  try {
    const stored = localStorage.getItem("dq_bot_state");
    if (stored) return JSON.parse(stored);
  } catch {}
  return { startingBankroll: STARTING_BANKROLL, currentBankroll: STARTING_BANKROLL, picks: [], dailyPnL: {} };
}

export function saveBotState(state: BotState) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem("dq_bot_state", JSON.stringify(state)); } catch {}
}

// Get today's date string
function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

// Check if bot already has picks for today
export function hasTodaysPicks(state: BotState): boolean {
  const today = getToday();
  return state.picks.filter((p) => p.date === today).length >= 4;
}

// Generate 4 picks for today from odds data (FanDuel only)
export function generateDailyPicks(
  oddsData: any[],
  currentBankroll: number
): BotPick[] {
  const today = getToday();
  const candidates: Array<{
    game: string;
    pick: string;
    market: string;
    fdOdds: number;
    oppOdds: number;
    fairProb: number;
    evEdge: number;
    reasoning: string[];
  }> = [];

  for (const game of oddsData) {
    if (!game.oddsLines || game.oddsLines.length === 0) continue;

    // Find FanDuel line
    const fdLine = game.oddsLines.find(
      (l: any) => l.bookmaker === "FanDuel" || l.bookmakerKey === "fanduel"
    );
    if (!fdLine) continue;

    const gameName = `${game.awayTeam} @ ${game.homeTeam}`;

    // Get market consensus for fair probability (using all books)
    const allHomeProbs: number[] = [];
    const allAwayProbs: number[] = [];
    for (const line of game.oddsLines) {
      if (line.homeML !== 0 && line.awayML !== 0) {
        const { prob1, prob2 } = devig(line.homeML, line.awayML);
        allHomeProbs.push(prob1);
        allAwayProbs.push(prob2);
      }
    }

    if (allHomeProbs.length < 2) continue; // Need 2+ books for consensus

    const fairHomeProb = allHomeProbs.reduce((a, b) => a + b, 0) / allHomeProbs.length;
    const fairAwayProb = allAwayProbs.reduce((a, b) => a + b, 0) / allAwayProbs.length;

    // Check home ML
    if (fdLine.homeML !== 0) {
      const impliedHome = americanToImpliedProb(fdLine.homeML);
      const ev = ((fairHomeProb - impliedHome) / impliedHome) * 100;
      if (ev > 1.5) {
        const reasoning = buildReasoning(
          game.homeTeam, "ML", fdLine.homeML, fairHomeProb, impliedHome, ev, gameName, game.oddsLines
        );
        candidates.push({
          game: gameName, pick: `${game.homeTeam} ML`, market: "moneyline",
          fdOdds: fdLine.homeML, oppOdds: fdLine.awayML,
          fairProb: fairHomeProb, evEdge: ev, reasoning,
        });
      }
    }

    // Check away ML
    if (fdLine.awayML !== 0) {
      const impliedAway = americanToImpliedProb(fdLine.awayML);
      const ev = ((fairAwayProb - impliedAway) / impliedAway) * 100;
      if (ev > 1.5) {
        const reasoning = buildReasoning(
          game.awayTeam, "ML", fdLine.awayML, fairAwayProb, impliedAway, ev, gameName, game.oddsLines
        );
        candidates.push({
          game: gameName, pick: `${game.awayTeam} ML`, market: "moneyline",
          fdOdds: fdLine.awayML, oppOdds: fdLine.homeML,
          fairProb: fairAwayProb, evEdge: ev, reasoning,
        });
      }
    }

    // Check totals
    if (fdLine.total > 0 && fdLine.overPrice !== 0 && fdLine.underPrice !== 0) {
      const allOverProbs: number[] = [];
      for (const line of game.oddsLines) {
        if (line.overPrice !== 0 && line.underPrice !== 0 && line.total === fdLine.total) {
          const { prob1 } = devig(line.overPrice, line.underPrice);
          allOverProbs.push(prob1);
        }
      }
      if (allOverProbs.length >= 2) {
        const fairOverProb = allOverProbs.reduce((a, b) => a + b, 0) / allOverProbs.length;
        const fairUnderProb = 1 - fairOverProb;

        // Over
        const impliedOver = americanToImpliedProb(fdLine.overPrice);
        const evOver = ((fairOverProb - impliedOver) / impliedOver) * 100;
        if (evOver > 2) {
          candidates.push({
            game: gameName, pick: `Over ${fdLine.total}`, market: "total",
            fdOdds: fdLine.overPrice, oppOdds: fdLine.underPrice,
            fairProb: fairOverProb, evEdge: evOver,
            reasoning: buildReasoning("Over", `${fdLine.total}`, fdLine.overPrice, fairOverProb, impliedOver, evOver, gameName, game.oddsLines),
          });
        }

        // Under
        const impliedUnder = americanToImpliedProb(fdLine.underPrice);
        const evUnder = ((fairUnderProb - impliedUnder) / impliedUnder) * 100;
        if (evUnder > 2) {
          candidates.push({
            game: gameName, pick: `Under ${fdLine.total}`, market: "total",
            fdOdds: fdLine.underPrice, oppOdds: fdLine.overPrice,
            fairProb: fairUnderProb, evEdge: evUnder,
            reasoning: buildReasoning("Under", `${fdLine.total}`, fdLine.underPrice, fairUnderProb, impliedUnder, evUnder, gameName, game.oddsLines),
          });
        }
      }
    }
  }

  // Sort by EV edge, pick top 4 (max 1 per game)
  candidates.sort((a, b) => b.evEdge - a.evEdge);

  const selected: typeof candidates = [];
  const usedGames = new Set<string>();
  for (const c of candidates) {
    if (usedGames.has(c.game)) continue;
    usedGames.add(c.game);
    selected.push(c);
    if (selected.length >= 4) break;
  }

  // If we don't have 4 unique game picks, allow 2nd pick from same game
  if (selected.length < 4) {
    for (const c of candidates) {
      if (selected.find((s) => s.pick === c.pick)) continue;
      selected.push(c);
      if (selected.length >= 4) break;
    }
  }

  // Convert to BotPick with Kelly sizing
  return selected.map((c, i) => {
    const decimalOdds = americanToDecimal(c.fdOdds);
    const stake = Math.max(
      kellyStake(c.fairProb, decimalOdds, currentBankroll, 0.25),
      25 // minimum $25 bet
    );

    const confidence = c.evEdge > 8 ? "HIGH" : c.evEdge > 4 ? "MEDIUM" : "LOW";

    return {
      id: `bot-${today}-${i}`,
      date: today,
      game: c.game,
      pick: c.pick,
      market: c.market,
      odds: c.fdOdds,
      stake: Math.round(stake * 100) / 100,
      result: "pending" as const,
      payout: 0,
      fairProb: Math.round(c.fairProb * 1000) / 10,
      impliedProb: Math.round(americanToImpliedProb(c.fdOdds) * 1000) / 10,
      evEdge: Math.round(c.evEdge * 100) / 100,
      confidence,
      reasoning: c.reasoning,
    };
  });
}

// Build transparent reasoning
function buildReasoning(
  team: string, market: string, odds: number, fairProb: number,
  impliedProb: number, ev: number, game: string, allLines: any[]
): string[] {
  const r: string[] = [];
  const fmtOdds = (o: number) => (o > 0 ? `+${o}` : `${o}`);

  r.push(`STEP 1: FanDuel has ${team} ${market} at ${fmtOdds(odds)} (implies ${(impliedProb * 100).toFixed(1)}% win probability)`);

  const bookCount = allLines.filter((l: any) => l.homeML !== 0).length;
  r.push(`STEP 2: De-vigged consensus across ${bookCount} books gives a fair probability of ${(fairProb * 100).toFixed(1)}%`);

  r.push(`STEP 3: Edge = ${(fairProb * 100).toFixed(1)}% fair - ${(impliedProb * 100).toFixed(1)}% implied = +${ev.toFixed(1)}% EV`);

  if (ev > 8) {
    r.push("STEP 4: This is a STRONG edge (>8% EV). Quarter-Kelly sizing applied — larger stake.");
  } else if (ev > 4) {
    r.push("STEP 4: Solid edge (4-8% EV). Standard quarter-Kelly stake.");
  } else {
    r.push("STEP 4: Marginal edge (1.5-4% EV). Small stake — grind it out over volume.");
  }

  // Show which books are off
  const fdPrice = odds;
  let softestBook = "";
  let sharpestBook = "";
  let maxDiff = 0;
  for (const line of allLines) {
    const bookOdds = market === "ML"
      ? (team.includes("Over") || team.includes("Under") ? line.overPrice : line.homeML)
      : line.homeML;
    if (bookOdds && Math.abs(bookOdds - fdPrice) > maxDiff) {
      maxDiff = Math.abs(bookOdds - fdPrice);
      if (bookOdds > fdPrice) softestBook = line.bookmaker;
      else sharpestBook = line.bookmaker;
    }
  }
  if (softestBook || sharpestBook) {
    r.push(`STEP 5: FanDuel is ${softestBook ? "softer than " + softestBook : "in line with market"}. ${sharpestBook ? sharpestBook + " has the sharpest line." : ""}`);
  }

  return r;
}

// Auto-settle picks based on scores data
export function settlePicksFromScores(
  state: BotState,
  scores: any[]
): BotState {
  let changed = false;
  const updatedPicks = state.picks.map((pick) => {
    if (pick.result !== "pending") return pick;

    // Find the matching game in scores
    const score = scores.find((s: any) => {
      if (s.status !== "final") return false;
      const gameName = `${s.awayTeam} @ ${s.homeTeam}`;
      return pick.game === gameName ||
        pick.game.includes(s.homeAbbrev) ||
        pick.game.includes(s.awayAbbrev);
    });

    if (!score) return pick; // Game not finished yet

    changed = true;
    const homeWon = score.homeScore > score.awayScore;
    const awayWon = score.awayScore > score.homeScore;
    const totalRuns = score.homeScore + score.awayScore;
    const finalScore = `${score.awayAbbrev} ${score.awayScore} - ${score.homeAbbrev} ${score.homeScore}`;

    let result: BotPick["result"] = "loss";
    let payout = 0;

    if (pick.market === "moneyline") {
      const pickedHome = pick.pick.includes(score.homeTeam) || pick.pick.includes(score.homeAbbrev);
      const pickedAway = pick.pick.includes(score.awayTeam) || pick.pick.includes(score.awayAbbrev);

      if ((pickedHome && homeWon) || (pickedAway && awayWon)) {
        result = "win";
        payout = pick.stake * americanToDecimal(pick.odds);
      } else if (score.homeScore === score.awayScore) {
        result = "push";
        payout = pick.stake;
      }
    } else if (pick.market === "total") {
      const line = parseFloat(pick.pick.replace(/[^0-9.]/g, ""));
      const isOver = pick.pick.toLowerCase().includes("over");

      if (isOver && totalRuns > line) {
        result = "win";
        payout = pick.stake * americanToDecimal(pick.odds);
      } else if (!isOver && totalRuns < line) {
        result = "win";
        payout = pick.stake * americanToDecimal(pick.odds);
      } else if (totalRuns === line) {
        result = "push";
        payout = pick.stake;
      }
    }

    return {
      ...pick,
      result,
      payout: Math.round(payout * 100) / 100,
      finalScore,
      settledAt: new Date().toISOString(),
    };
  });

  if (!changed) return state;

  // Recalculate bankroll
  const totalStaked = updatedPicks.reduce((s, p) => s + p.stake, 0);
  const totalReturns = updatedPicks.filter((p) => p.result !== "pending").reduce((s, p) => s + p.payout, 0);
  const pendingStake = updatedPicks.filter((p) => p.result === "pending").reduce((s, p) => s + p.stake, 0);
  const currentBankroll = STARTING_BANKROLL + totalReturns - totalStaked + pendingStake;

  // Daily P&L
  const dailyPnL = { ...state.dailyPnL };
  for (const pick of updatedPicks) {
    if (pick.settledAt && pick.result !== "pending") {
      const day = pick.date;
      dailyPnL[day] = (dailyPnL[day] ?? 0);
    }
  }
  // Recalculate all daily PnL
  for (const pick of updatedPicks.filter((p) => p.result !== "pending")) {
    const day = pick.date;
    const dayPicks = updatedPicks.filter((p) => p.date === day && p.result !== "pending");
    dailyPnL[day] = dayPicks.reduce((s, p) => s + p.payout - p.stake, 0);
  }

  const newState = { ...state, picks: updatedPicks, currentBankroll, dailyPnL };
  saveBotState(newState);
  return newState;
}
