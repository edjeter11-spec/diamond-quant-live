// ──────────────────────────────────────────────────────────
// Ghost Bots — 3 Shadow Strategies Running in Parallel
// Each uses different logic. Best performer becomes the Live Bot.
// ──────────────────────────────────────────────────────────

import { americanToDecimal, americanToImpliedProb, kellyStake, devig } from "@/lib/model/kelly";

// ── Ghost Bot Strategies ──

export interface GhostStrategy {
  id: string;
  name: string;
  description: string;
  minEdge: number;          // minimum EV % to bet
  maxBetsPerDay: number;
  kellyFraction: number;    // how aggressive (0.1 = conservative, 0.5 = aggressive)
  preferMarkets: string[];  // which markets it favors
  weightOverrides: {
    recentForm: number;     // 0-1, how much to weight recent form vs season
    homeField: number;      // 0-1, home field advantage weight
    lineMovement: number;   // 0-1, weight sharp line moves
  };
}

export const GHOST_STRATEGIES: GhostStrategy[] = [
  {
    id: "volume",
    name: "Volume Grinder",
    description: "Bets any edge >0.5%. High volume, lower accuracy. Grinds small edges across many games.",
    minEdge: 0.5,
    maxBetsPerDay: 8,
    kellyFraction: 0.15, // smaller bets
    preferMarkets: ["moneyline", "total"],
    weightOverrides: { recentForm: 0.3, homeField: 0.5, lineMovement: 0.2 },
  },
  {
    id: "balanced",
    name: "Balanced Edge",
    description: "Standard 2% edge threshold. Balances volume with accuracy. The all-rounder.",
    minEdge: 2.0,
    maxBetsPerDay: 5,
    kellyFraction: 0.25,
    preferMarkets: ["moneyline", "total", "spread"],
    weightOverrides: { recentForm: 0.5, homeField: 0.4, lineMovement: 0.5 },
  },
  {
    id: "sniper",
    name: "Sniper",
    description: "Only bets 5%+ edges. Low volume but high conviction. Waits for the perfect shot.",
    minEdge: 5.0,
    maxBetsPerDay: 3,
    kellyFraction: 0.35, // bigger bets when it does bet
    preferMarkets: ["moneyline"],
    weightOverrides: { recentForm: 0.7, homeField: 0.3, lineMovement: 0.8 },
  },
];

// ── Ghost Bot Pick ──

export interface GhostPick {
  id: string;
  ghostId: string;
  date: string;
  game: string;
  pick: string;
  market: string;
  odds: number;
  stake: number;
  fairProb: number;
  evEdge: number;
  result: "pending" | "win" | "loss" | "push";
  payout: number;
  finalScore?: string;
}

export interface GhostState {
  id: string;
  name: string;
  bankroll: number;
  picks: GhostPick[];
  wins: number;
  losses: number;
  roi: number;
  profit: number;
  isLive: boolean; // is this the current "Live" bot?
  lastUpdated: string;
}

export interface GhostSystemState {
  ghosts: GhostState[];
  liveGhostId: string;
  lastSwapCheck: string;
  swapHistory: Array<{ date: string; from: string; to: string; reason: string }>;
}

const STARTING_BANKROLL = 5000;

export function loadGhostSystem(): GhostSystemState {
  if (typeof window === "undefined") return createDefaultSystem();
  try {
    const stored = localStorage.getItem("dq_ghost_system");
    if (stored) return JSON.parse(stored);
  } catch {}
  return createDefaultSystem();
}

export function saveGhostSystem(state: GhostSystemState) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem("dq_ghost_system", JSON.stringify(state)); } catch {}
}

function createDefaultSystem(): GhostSystemState {
  return {
    ghosts: GHOST_STRATEGIES.map((s) => ({
      id: s.id,
      name: s.name,
      bankroll: STARTING_BANKROLL,
      picks: [],
      wins: 0,
      losses: 0,
      roi: 0,
      profit: 0,
      isLive: s.id === "balanced", // balanced starts as live
      lastUpdated: new Date().toISOString(),
    })),
    liveGhostId: "balanced",
    lastSwapCheck: new Date().toISOString(),
    swapHistory: [],
  };
}

// ── Generate Picks for All 3 Ghosts ──

export function generateGhostPicks(
  oddsData: any[],
  system: GhostSystemState
): GhostSystemState {
  const today = new Date().toISOString().split("T")[0];
  const updatedGhosts = system.ghosts.map((ghost) => {
    // Skip if already has picks today
    if (ghost.picks.filter((p) => p.date === today).length > 0) return ghost;

    const strategy = GHOST_STRATEGIES.find((s) => s.id === ghost.id);
    if (!strategy) return ghost;

    const picks = generateForStrategy(strategy, oddsData, ghost.bankroll, today);

    return {
      ...ghost,
      picks: [...ghost.picks, ...picks],
      bankroll: ghost.bankroll - picks.reduce((s, p) => s + p.stake, 0),
      lastUpdated: new Date().toISOString(),
    };
  });

  return { ...system, ghosts: updatedGhosts };
}

function generateForStrategy(
  strategy: GhostStrategy,
  oddsData: any[],
  bankroll: number,
  today: string
): GhostPick[] {
  interface Candidate {
    game: string; pick: string; market: string;
    odds: number; fairProb: number; evEdge: number;
  }

  const candidates: Candidate[] = [];

  for (const game of oddsData) {
    if (!game.oddsLines || game.oddsLines.length < 2) continue;
    const gameName = `${game.awayTeam} @ ${game.homeTeam}`;

    // Build consensus fair probs
    const homeProbs: number[] = [];
    const awayProbs: number[] = [];
    for (const line of game.oddsLines) {
      if (line.homeML !== 0 && line.awayML !== 0) {
        const { prob1, prob2 } = devig(line.homeML, line.awayML);
        homeProbs.push(prob1);
        awayProbs.push(prob2);
      }
    }
    if (homeProbs.length === 0) continue;

    const fairHome = homeProbs.reduce((a, b) => a + b, 0) / homeProbs.length;
    const fairAway = awayProbs.reduce((a, b) => a + b, 0) / awayProbs.length;

    // Apply strategy weight overrides
    const adjustedHome = fairHome * (1 + strategy.weightOverrides.homeField * 0.02);
    const adjustedAway = fairAway * (1 - strategy.weightOverrides.homeField * 0.02);

    // Check each book for edges
    for (const line of game.oddsLines) {
      // Home ML
      if (line.homeML !== 0 && strategy.preferMarkets.includes("moneyline")) {
        const imp = americanToImpliedProb(line.homeML);
        const ev = ((adjustedHome - imp) / Math.max(imp, 0.01)) * 100;
        if (ev >= strategy.minEdge) {
          candidates.push({ game: gameName, pick: `${game.homeTeam} ML`, market: "moneyline", odds: line.homeML, fairProb: adjustedHome, evEdge: ev });
        }
      }
      // Away ML
      if (line.awayML !== 0 && strategy.preferMarkets.includes("moneyline")) {
        const imp = americanToImpliedProb(line.awayML);
        const ev = ((adjustedAway - imp) / Math.max(imp, 0.01)) * 100;
        if (ev >= strategy.minEdge) {
          candidates.push({ game: gameName, pick: `${game.awayTeam} ML`, market: "moneyline", odds: line.awayML, fairProb: adjustedAway, evEdge: ev });
        }
      }
      // Totals
      if (line.total > 0 && line.overPrice !== 0 && strategy.preferMarkets.includes("total")) {
        const { prob1: overProb } = devig(line.overPrice, line.underPrice);
        const impOver = americanToImpliedProb(line.overPrice);
        const evOver = ((overProb - impOver) / Math.max(impOver, 0.01)) * 100;
        if (evOver >= strategy.minEdge) {
          candidates.push({ game: gameName, pick: `Over ${line.total}`, market: "total", odds: line.overPrice, fairProb: overProb, evEdge: evOver });
        }
        const impUnder = americanToImpliedProb(line.underPrice);
        const evUnder = (((1 - overProb) - impUnder) / Math.max(impUnder, 0.01)) * 100;
        if (evUnder >= strategy.minEdge) {
          candidates.push({ game: gameName, pick: `Under ${line.total}`, market: "total", odds: line.underPrice, fairProb: 1 - overProb, evEdge: evUnder });
        }
      }
    }
  }

  // Sort by EV, take top N unique games
  candidates.sort((a, b) => b.evEdge - a.evEdge);
  const selected: Candidate[] = [];
  const usedGames = new Set<string>();
  for (const c of candidates) {
    if (usedGames.has(c.game)) continue;
    if (c.evEdge > 15) continue; // dead line filter
    usedGames.add(c.game);
    selected.push(c);
    if (selected.length >= strategy.maxBetsPerDay) break;
  }

  // Fill remaining slots if needed
  if (selected.length < Math.min(strategy.maxBetsPerDay, 2)) {
    for (const c of candidates) {
      if (selected.find((s) => s.pick === c.pick)) continue;
      if (c.evEdge > 15) continue;
      selected.push(c);
      if (selected.length >= strategy.maxBetsPerDay) break;
    }
  }

  return selected.map((c, i) => {
    const dec = americanToDecimal(c.odds);
    const rawStake = kellyStake(c.fairProb, dec, bankroll, strategy.kellyFraction);
    // Cap: min $50, max 5% of bankroll (prevents going broke on a few losses)
    const stake = Math.max(Math.min(rawStake, bankroll * 0.05), 50);
    return {
      id: `ghost-${strategy.id}-${today}-${i}`,
      ghostId: strategy.id,
      date: today,
      game: c.game, pick: c.pick, market: c.market,
      odds: c.odds, stake: Math.round(Math.min(stake, bankroll * 0.1) * 100) / 100,
      fairProb: Math.round(c.fairProb * 1000) / 10,
      evEdge: Math.round(c.evEdge * 100) / 100,
      result: "pending" as const, payout: 0,
    };
  });
}

// ── Auto-Settle Ghost Picks ──

export function settleGhostPicks(system: GhostSystemState, scores: any[]): GhostSystemState {
  let changed = false;

  const updatedGhosts = system.ghosts.map((ghost) => {
    const updatedPicks = ghost.picks.map((pick) => {
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

      let result: GhostPick["result"] = "loss";
      let payout = 0;

      if (pick.market === "moneyline") {
        const pickedHome = pick.pick.includes(score.homeTeam) || pick.pick.includes(score.homeAbbrev);
        const pickedAway = pick.pick.includes(score.awayTeam) || pick.pick.includes(score.awayAbbrev);
        if ((pickedHome && homeWon) || (pickedAway && awayWon)) {
          result = "win"; payout = pick.stake * americanToDecimal(pick.odds);
        } else if (score.homeScore === score.awayScore) {
          result = "push"; payout = pick.stake;
        }
      } else if (pick.market === "total") {
        const line = parseFloat(pick.pick.replace(/[^0-9.]/g, ""));
        const isOver = pick.pick.toLowerCase().includes("over");
        if (isOver && totalRuns > line) { result = "win"; payout = pick.stake * americanToDecimal(pick.odds); }
        else if (!isOver && totalRuns < line) { result = "win"; payout = pick.stake * americanToDecimal(pick.odds); }
        else if (totalRuns === line) { result = "push"; payout = pick.stake; }
      }

      return { ...pick, result, payout: Math.round(payout * 100) / 100, finalScore: `${score.awayAbbrev} ${score.awayScore} - ${score.homeAbbrev} ${score.homeScore}` };
    });

    const settled = updatedPicks.filter((p) => p.result !== "pending");
    const wins = settled.filter((p) => p.result === "win").length;
    const losses = settled.filter((p) => p.result === "loss").length;
    const totalStaked = settled.reduce((s, p) => s + p.stake, 0);
    const totalReturns = settled.reduce((s, p) => s + p.payout, 0);
    const profit = totalReturns - totalStaked;
    const pendingStake = updatedPicks.filter((p) => p.result === "pending").reduce((s, p) => s + p.stake, 0);

    return {
      ...ghost,
      picks: updatedPicks,
      wins, losses,
      profit,
      roi: totalStaked > 0 ? (profit / totalStaked) * 100 : 0,
      bankroll: STARTING_BANKROLL + totalReturns - totalStaked + pendingStake,
      lastUpdated: new Date().toISOString(),
    };
  });

  if (!changed) return system;
  return { ...system, ghosts: updatedGhosts };
}

// ── Auto-Swap: Best Ghost Becomes Live ──

export function checkForSwap(system: GhostSystemState): GhostSystemState {
  // Need at least 10 settled bets across all ghosts to consider swapping
  const totalSettled = system.ghosts.reduce((s, g) => s + g.wins + g.losses, 0);
  if (totalSettled < 10) return system;

  // Find the best performing ghost by ROI (minimum 5 bets)
  const eligible = system.ghosts.filter((g) => (g.wins + g.losses) >= 5);
  if (eligible.length === 0) return system;

  const best = eligible.reduce((a, b) => a.roi > b.roi ? a : b);

  if (best.id !== system.liveGhostId && best.roi > 0) {
    const currentLive = system.ghosts.find((g) => g.id === system.liveGhostId);
    // Only swap if best is meaningfully better (>3% ROI difference)
    if (currentLive && best.roi - currentLive.roi > 3) {
      return {
        ...system,
        liveGhostId: best.id,
        ghosts: system.ghosts.map((g) => ({ ...g, isLive: g.id === best.id })),
        lastSwapCheck: new Date().toISOString(),
        swapHistory: [
          ...system.swapHistory,
          {
            date: new Date().toISOString(),
            from: system.liveGhostId,
            to: best.id,
            reason: `${best.name} ROI ${best.roi.toFixed(1)}% > ${currentLive.name} ROI ${currentLive.roi.toFixed(1)}%`,
          },
        ],
      };
    }
  }

  return { ...system, lastSwapCheck: new Date().toISOString() };
}
