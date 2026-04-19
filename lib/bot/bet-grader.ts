// ──────────────────────────────────────────────────────────
// Bet Grader — auto-settle user bets against completed games
//
// Consumes pending rows from user_state.betHistory. For each bet:
//   - Match against completed game(s) from today's slate
//   - Grade moneyline / total / spread legs
//   - Parlay: only win if ALL legs win; any loss = loss; any push = push
//   - Player props: stay pending (need box scores we don't have)
//   - Unknown games: stay pending
//
// Output drives bankroll adjustments + UI state flip.
// ──────────────────────────────────────────────────────────

import { americanToDecimal } from "@/lib/model/kelly";

export interface CompletedGame {
  homeTeam: string;
  awayTeam: string;
  homeAbbrev?: string;
  awayAbbrev?: string;
  homeScore: number;
  awayScore: number;
}

export type BetResult = "win" | "loss" | "push" | "pending";

export interface BetToGrade {
  id: string;
  game: string;                  // "Yankees @ Red Sox" or "Yankees + Lakers + ..." for parlay
  market: string;                // "moneyline" | "spread" | "total" | "parlay" | "player_prop"
  pick: string;                  // "Yankees ML" or concatenated legs
  odds: number;                  // American odds (single for straight, combined for parlay)
  stake: number;
  result: BetResult;
  payout: number;
  isParlay?: boolean;
  parlayLegs?: string[];         // ["Yankees ML", "Lakers -3.5", ...]
}

export interface GradeOutcome {
  result: BetResult;
  payout: number;
  settledAt?: string;
  reason: string;
}

// ─── Text-parse helpers ───────────────────────────────────

function normalizeTeam(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function findGame(pickOrGame: string, games: CompletedGame[]): CompletedGame | null {
  const text = normalizeTeam(pickOrGame);
  for (const g of games) {
    const home = normalizeTeam(g.homeTeam);
    const away = normalizeTeam(g.awayTeam);
    const homeAbbr = (g.homeAbbrev ?? "").toLowerCase();
    const awayAbbr = (g.awayAbbrev ?? "").toLowerCase();
    // Match on full name, abbrev, or last word (team nickname)
    if (text.includes(home) || text.includes(away)) return g;
    if (homeAbbr && text.includes(homeAbbr)) return g;
    if (awayAbbr && text.includes(awayAbbr)) return g;
    const homeLast = home.split(" ").pop() ?? "";
    const awayLast = away.split(" ").pop() ?? "";
    if (homeLast.length > 3 && text.includes(homeLast)) return g;
    if (awayLast.length > 3 && text.includes(awayLast)) return g;
  }
  return null;
}

// ─── Per-leg grading ─────────────────────────────────────

function gradeMoneyline(pickText: string, game: CompletedGame): BetResult {
  const text = normalizeTeam(pickText);
  const home = normalizeTeam(game.homeTeam);
  const away = normalizeTeam(game.awayTeam);
  const homeWon = game.homeScore > game.awayScore;
  const awayWon = game.awayScore > game.homeScore;
  if (game.homeScore === game.awayScore) return "push"; // extremely rare — game ended tied

  const pickedHome =
    text.includes(home) || text.includes(home.split(" ").pop() ?? "!!!") ||
    (game.homeAbbrev && text.includes(game.homeAbbrev.toLowerCase()));
  const pickedAway =
    text.includes(away) || text.includes(away.split(" ").pop() ?? "!!!") ||
    (game.awayAbbrev && text.includes(game.awayAbbrev.toLowerCase()));

  if (pickedHome && homeWon) return "win";
  if (pickedAway && awayWon) return "win";
  if (pickedHome && awayWon) return "loss";
  if (pickedAway && homeWon) return "loss";
  return "pending";
}

function gradeTotal(pickText: string, game: CompletedGame): BetResult {
  const text = pickText.toLowerCase();
  const total = game.homeScore + game.awayScore;
  const overMatch = text.match(/over\s+(\d+(\.\d+)?)/);
  const underMatch = text.match(/under\s+(\d+(\.\d+)?)/);
  if (overMatch) {
    const line = parseFloat(overMatch[1]);
    if (total > line) return "win";
    if (total < line) return "loss";
    return "push";
  }
  if (underMatch) {
    const line = parseFloat(underMatch[1]);
    if (total < line) return "win";
    if (total > line) return "loss";
    return "push";
  }
  return "pending";
}

function gradeSpread(pickText: string, game: CompletedGame): BetResult {
  // Match "Team -3.5" or "Team +7" formats
  const signMatch = pickText.match(/([+\-])(\d+(\.\d+)?)/);
  if (!signMatch) return "pending";
  const sign = signMatch[1] === "+" ? 1 : -1;
  const line = parseFloat(signMatch[2]) * sign;

  const text = normalizeTeam(pickText);
  const home = normalizeTeam(game.homeTeam);
  const away = normalizeTeam(game.awayTeam);
  const pickedHome =
    text.includes(home) || text.includes(home.split(" ").pop() ?? "!!!") ||
    (game.homeAbbrev && text.includes(game.homeAbbrev.toLowerCase()));
  const pickedAway =
    text.includes(away) || text.includes(away.split(" ").pop() ?? "!!!") ||
    (game.awayAbbrev && text.includes(game.awayAbbrev.toLowerCase()));
  if (!pickedHome && !pickedAway) return "pending";

  // Home covers if (homeScore + line) > awayScore
  // Away covers if picked side had an opposite-sign line applied to their score
  const margin = pickedHome
    ? game.homeScore + line - game.awayScore
    : game.awayScore + line - game.homeScore;
  if (Math.abs(margin) < 0.01) return "push";
  return margin > 0 ? "win" : "loss";
}

/** Grade a single leg given its market + pick text. */
export function gradeLeg(
  market: string,
  pickText: string,
  game: CompletedGame | null
): BetResult {
  if (!game) return "pending";
  const m = (market ?? "").toLowerCase();
  if (m === "moneyline" || m === "ml") return gradeMoneyline(pickText, game);
  if (m === "total" || m === "totals" || m === "over/under") return gradeTotal(pickText, game);
  if (m === "spread" || m === "run line" || m === "runline" || m === "point spread") return gradeSpread(pickText, game);
  // Player props, futures, derivatives → can't grade from scores alone
  return "pending";
}

// ─── Top-level grader ────────────────────────────────────

/**
 * Grade a user bet (straight or parlay) against the list of completed games.
 * Returns "pending" if we can't yet confirm the outcome (some legs unsettled).
 */
export function gradeBet(bet: BetToGrade, completedGames: CompletedGame[]): GradeOutcome {
  if (bet.result !== "pending") {
    return { result: bet.result, payout: bet.payout, reason: "Already settled" };
  }

  const stake = Number(bet.stake ?? 0);
  if (stake <= 0) return { result: "pending", payout: 0, reason: "No stake" };

  // ── Parlay: grade every leg ─────────────────────────────
  if (bet.isParlay || (bet.parlayLegs && bet.parlayLegs.length > 1)) {
    const legs = bet.parlayLegs ?? [];
    if (legs.length === 0) return { result: "pending", payout: 0, reason: "No legs listed" };

    const legResults: BetResult[] = [];
    for (const leg of legs) {
      const game = findGame(leg, completedGames);
      // Detect market from leg text (best-effort)
      let legMarket = "moneyline";
      if (/\bML\b|\bMoneyline\b/i.test(leg)) legMarket = "moneyline";
      else if (/\bover|under\b/i.test(leg)) legMarket = "total";
      else if (/[+\-]\d+(\.\d+)?/.test(leg)) legMarket = "spread";
      else if (/points|rebounds|assists|strikeouts|hits|runs|total bases|home runs/i.test(leg)) legMarket = "player_prop";
      legResults.push(gradeLeg(legMarket, leg, game));
    }

    if (legResults.some(r => r === "pending")) {
      return { result: "pending", payout: 0, reason: "Some legs not yet settled" };
    }
    if (legResults.some(r => r === "loss")) {
      return {
        result: "loss",
        payout: 0,
        settledAt: new Date().toISOString(),
        reason: `Parlay lost — ${legResults.filter(r => r === "loss").length} leg(s) missed`,
      };
    }
    if (legResults.some(r => r === "push")) {
      // Simple rule: any push in parlay = whole parlay pushes (safer than leg-drop)
      return {
        result: "push",
        payout: stake,
        settledAt: new Date().toISOString(),
        reason: "Parlay pushed — at least one leg pushed",
      };
    }
    // All wins
    const decimal = americanToDecimal(bet.odds);
    return {
      result: "win",
      payout: Math.round(stake * decimal * 100) / 100,
      settledAt: new Date().toISOString(),
      reason: `All ${legs.length} legs hit`,
    };
  }

  // ── Straight bet ────────────────────────────────────────
  const game = findGame(bet.pick || bet.game, completedGames);
  if (!game) return { result: "pending", payout: 0, reason: "Game not yet completed" };

  const result = gradeLeg(bet.market, bet.pick, game);
  if (result === "pending") {
    return { result: "pending", payout: 0, reason: `Can't grade ${bet.market} from final score alone` };
  }

  const decimal = americanToDecimal(bet.odds);
  const payout =
    result === "win" ? Math.round(stake * decimal * 100) / 100
    : result === "push" ? stake
    : 0;

  return {
    result,
    payout,
    settledAt: new Date().toISOString(),
    reason: result === "win" ? "Pick hit" : result === "loss" ? "Pick missed" : "Push",
  };
}
