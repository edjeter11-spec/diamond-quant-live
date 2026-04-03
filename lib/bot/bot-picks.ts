// ──────────────────────────────────────────────────────────
// Bot Challenge — Simulated $5,000 bankroll
// Picks 4 bets per day using model logic on FanDuel odds only
// Auto-generates on page load, auto-settles from scores
// ──────────────────────────────────────────────────────────

import { americanToDecimal, americanToImpliedProb, kellyStake, devig } from "@/lib/model/kelly";

export interface BotPick {
  id: string;
  date: string;
  game: string;
  pick: string;
  market: string;
  odds: number;
  stake: number;
  result: "pending" | "win" | "loss" | "push";
  payout: number;
  fairProb: number;
  impliedProb: number;
  evEdge: number;
  confidence: string;
  reasoning: string[];
  finalScore?: string;
  settledAt?: string;
}

export interface BotState {
  startingBankroll: number;
  currentBankroll: number;
  picks: BotPick[];
  dailyPnL: Record<string, number>;
}

const STARTING_BANKROLL = 5000;

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

function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

export function hasTodaysPicks(state: BotState): boolean {
  return state.picks.filter((p) => p.date === getToday()).length >= 4;
}

// ──────────────────────────────────────────────────────────
// PICK GENERATION — always produces exactly 4 picks
// ──────────────────────────────────────────────────────────
export function generateDailyPicks(oddsData: any[], currentBankroll: number): BotPick[] {
  const today = getToday();

  interface Candidate {
    game: string;
    pick: string;
    market: string;
    fdOdds: number;
    fairProb: number;
    evEdge: number;
    reasoning: string[];
  }

  const candidates: Candidate[] = [];

  for (const game of oddsData) {
    if (!game.oddsLines || game.oddsLines.length === 0) continue;

    const gameName = `${game.awayTeam} @ ${game.homeTeam}`;

    // Find FanDuel line (try multiple name variations)
    const fdLine = game.oddsLines.find((l: any) =>
      l.bookmaker === "FanDuel" ||
      l.bookmakerKey === "fanduel" ||
      l.bookmaker?.toLowerCase().includes("fanduel")
    );

    // If no FanDuel, use the first available book as proxy
    const line = fdLine ?? game.oddsLines[0];
    if (!line) continue;

    const bookName = fdLine ? "FanDuel" : line.bookmaker;

    // Get consensus fair probability from ALL available books
    const allHomeProbs: number[] = [];
    const allAwayProbs: number[] = [];
    for (const l of game.oddsLines) {
      if (l.homeML !== 0 && l.awayML !== 0) {
        const { prob1, prob2 } = devig(l.homeML, l.awayML);
        allHomeProbs.push(prob1);
        allAwayProbs.push(prob2);
      }
    }

    // Even with 1 book, we can de-vig it against itself for fair value
    if (allHomeProbs.length === 0 && line.homeML !== 0 && line.awayML !== 0) {
      const { prob1, prob2 } = devig(line.homeML, line.awayML);
      allHomeProbs.push(prob1);
      allAwayProbs.push(prob2);
    }

    if (allHomeProbs.length === 0) continue;

    const fairHome = avg(allHomeProbs);
    const fairAway = avg(allAwayProbs);
    const multiBook = allHomeProbs.length >= 2;

    // HOME ML
    if (line.homeML !== 0) {
      const imp = americanToImpliedProb(line.homeML);
      const ev = ((fairHome - imp) / Math.max(imp, 0.01)) * 100;
      candidates.push({
        game: gameName, pick: `${game.homeTeam} ML`, market: "moneyline",
        fdOdds: line.homeML, fairProb: fairHome, evEdge: ev,
        reasoning: buildReasoning(game.homeTeam, "ML", line.homeML, fairHome, imp, ev, bookName, multiBook, allHomeProbs.length),
      });
    }

    // AWAY ML
    if (line.awayML !== 0) {
      const imp = americanToImpliedProb(line.awayML);
      const ev = ((fairAway - imp) / Math.max(imp, 0.01)) * 100;
      candidates.push({
        game: gameName, pick: `${game.awayTeam} ML`, market: "moneyline",
        fdOdds: line.awayML, fairProb: fairAway, evEdge: ev,
        reasoning: buildReasoning(game.awayTeam, "ML", line.awayML, fairAway, imp, ev, bookName, multiBook, allAwayProbs.length),
      });
    }

    // TOTALS (over/under)
    if (line.total > 0 && line.overPrice !== 0 && line.underPrice !== 0) {
      const overProbs: number[] = [];
      for (const l of game.oddsLines) {
        if (l.overPrice !== 0 && l.underPrice !== 0 && l.total === line.total) {
          const { prob1 } = devig(l.overPrice, l.underPrice);
          overProbs.push(prob1);
        }
      }
      if (overProbs.length === 0) {
        const { prob1 } = devig(line.overPrice, line.underPrice);
        overProbs.push(prob1);
      }

      const fairOver = avg(overProbs);
      const fairUnder = 1 - fairOver;

      // Over
      const impOver = americanToImpliedProb(line.overPrice);
      const evOver = ((fairOver - impOver) / Math.max(impOver, 0.01)) * 100;
      candidates.push({
        game: gameName, pick: `Over ${line.total}`, market: "total",
        fdOdds: line.overPrice, fairProb: fairOver, evEdge: evOver,
        reasoning: buildReasoning("Over", `${line.total}`, line.overPrice, fairOver, impOver, evOver, bookName, overProbs.length >= 2, overProbs.length),
      });

      // Under
      const impUnder = americanToImpliedProb(line.underPrice);
      const evUnder = ((fairUnder - impUnder) / Math.max(impUnder, 0.01)) * 100;
      candidates.push({
        game: gameName, pick: `Under ${line.total}`, market: "total",
        fdOdds: line.underPrice, fairProb: fairUnder, evEdge: evUnder,
        reasoning: buildReasoning("Under", `${line.total}`, line.underPrice, fairUnder, impUnder, evUnder, bookName, overProbs.length >= 2, overProbs.length),
      });
    }
  }

  // Sort: best EV first
  candidates.sort((a, b) => b.evEdge - a.evEdge);

  // Select top 4: prefer unique games, then fill
  const selected: Candidate[] = [];
  const usedGames = new Set<string>();

  // Pass 1: best pick per game
  for (const c of candidates) {
    if (usedGames.has(c.game)) continue;
    if (c.evEdge < -5) continue; // skip terrible picks
    usedGames.add(c.game);
    selected.push(c);
    if (selected.length >= 4) break;
  }

  // Pass 2: if still under 4, allow 2nd pick from same game
  if (selected.length < 4) {
    for (const c of candidates) {
      if (selected.find((s) => s.pick === c.pick)) continue;
      if (c.evEdge < -5) continue;
      selected.push(c);
      if (selected.length >= 4) break;
    }
  }

  // Pass 3: if STILL under 4, take whatever's left (even negative EV — the bot needs 4)
  if (selected.length < 4) {
    for (const c of candidates) {
      if (selected.find((s) => s.pick === c.pick)) continue;
      selected.push(c);
      if (selected.length >= 4) break;
    }
  }

  return selected.slice(0, 4).map((c, i) => {
    const decimalOdds = americanToDecimal(c.fdOdds);
    const rawKelly = kellyStake(c.fairProb, decimalOdds, currentBankroll, 0.25);
    const stake = c.evEdge > 0
      ? Math.max(rawKelly, 25)
      : 25; // minimum bet on negative EV (forced pick)

    const confidence = c.evEdge > 8 ? "HIGH" : c.evEdge > 3 ? "MEDIUM" : c.evEdge > 0 ? "LOW" : "FADE";

    return {
      id: `bot-${today}-${i}`,
      date: today,
      game: c.game,
      pick: c.pick,
      market: c.market,
      odds: c.fdOdds,
      stake: Math.round(Math.min(stake, currentBankroll * 0.1) * 100) / 100, // cap at 10% of bankroll
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

function avg(arr: number[]): number {
  return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0.5;
}

// ──────────────────────────────────────────────────────────
// REASONING — fully transparent step-by-step
// ──────────────────────────────────────────────────────────
function buildReasoning(
  team: string, market: string, odds: number, fairProb: number,
  impliedProb: number, ev: number, bookName: string, multiBook: boolean, bookCount: number
): string[] {
  const r: string[] = [];
  const fmtOdds = (o: number) => (o > 0 ? `+${o}` : `${o}`);

  r.push(`SCAN: ${bookName} has ${team} ${market} at ${fmtOdds(odds)} → implies ${(impliedProb * 100).toFixed(1)}% win probability`);

  if (multiBook) {
    r.push(`CONSENSUS: De-vigged fair probability across ${bookCount} books = ${(fairProb * 100).toFixed(1)}%`);
  } else {
    r.push(`FAIR VALUE: De-vigged line gives ${(fairProb * 100).toFixed(1)}% fair probability (single-book estimate)`);
  }

  if (ev > 0) {
    r.push(`EDGE: ${(fairProb * 100).toFixed(1)}% fair − ${(impliedProb * 100).toFixed(1)}% implied = +${ev.toFixed(1)}% EV ✓`);
  } else {
    r.push(`EDGE: ${(fairProb * 100).toFixed(1)}% fair − ${(impliedProb * 100).toFixed(1)}% implied = ${ev.toFixed(1)}% EV (slim/no edge, forced pick)`);
  }

  if (ev > 8) {
    r.push("VERDICT: Strong edge — oversized quarter-Kelly stake. This is the kind of line the sharp books would move on.");
  } else if (ev > 3) {
    r.push("VERDICT: Solid value. Standard quarter-Kelly sizing. Consistent +EV over volume.");
  } else if (ev > 0) {
    r.push("VERDICT: Marginal edge. Minimum stake — grinding small edges adds up over time.");
  } else {
    r.push("VERDICT: No clear edge but included to fill the 4-pick quota. Minimum $25 stake.");
  }

  return r;
}

// ──────────────────────────────────────────────────────────
// AUTO-SETTLEMENT from live scores
// ──────────────────────────────────────────────────────────
export function settlePicksFromScores(state: BotState, scores: any[]): BotState {
  let changed = false;
  const updatedPicks = state.picks.map((pick) => {
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
      if (isOver && totalRuns > line) { result = "win"; payout = pick.stake * americanToDecimal(pick.odds); }
      else if (!isOver && totalRuns < line) { result = "win"; payout = pick.stake * americanToDecimal(pick.odds); }
      else if (totalRuns === line) { result = "push"; payout = pick.stake; }
    }

    return { ...pick, result, payout: Math.round(payout * 100) / 100, finalScore, settledAt: new Date().toISOString() };
  });

  if (!changed) return state;

  // Recalculate bankroll
  const totalStaked = updatedPicks.reduce((s, p) => s + p.stake, 0);
  const totalReturns = updatedPicks.filter((p) => p.result !== "pending").reduce((s, p) => s + p.payout, 0);
  const pendingStake = updatedPicks.filter((p) => p.result === "pending").reduce((s, p) => s + p.stake, 0);
  const currentBankroll = STARTING_BANKROLL + totalReturns - totalStaked + pendingStake;

  // Daily P&L
  const dailyPnL: Record<string, number> = {};
  for (const pick of updatedPicks.filter((p) => p.result !== "pending")) {
    const day = pick.date;
    dailyPnL[day] = (dailyPnL[day] ?? 0) + (pick.payout - pick.stake);
  }

  const newState = { ...state, picks: updatedPicks, currentBankroll, dailyPnL };
  saveBotState(newState);
  return newState;
}
