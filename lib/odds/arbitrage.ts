// ──────────────────────────────────────────────────────────
// Arbitrage & Market Efficiency Detection
// Scans all books for price discrepancies
// ──────────────────────────────────────────────────────────

import type { OddsLine, ArbitrageOpportunity, EVBet } from "@/lib/model/types";
import {
  americanToDecimal,
  americanToImpliedProb,
  devig,
  evPercentage,
  kellyStake,
  getConfidence,
  probToFairAmerican,
} from "@/lib/model/kelly";

// Find arbitrage opportunities across books
export function findArbitrage(
  oddsLines: OddsLine[],
  gameName: string
): ArbitrageOpportunity[] {
  const arbs: ArbitrageOpportunity[] = [];
  const parts = gameName.split(" @ ");
  const awayTeam = parts[0] ?? "Away";
  const homeTeam = parts[1] ?? "Home";

  // Check moneyline arbs
  for (let i = 0; i < oddsLines.length; i++) {
    for (let j = i + 1; j < oddsLines.length; j++) {
      // Home on book i, Away on book j
      checkArb(
        oddsLines[i], oddsLines[j],
        oddsLines[i].homeML, oddsLines[j].awayML,
        "moneyline", gameName, `${homeTeam} ML`, `${awayTeam} ML`,
        arbs
      );

      // Away on book i, Home on book j
      checkArb(
        oddsLines[i], oddsLines[j],
        oddsLines[i].awayML, oddsLines[j].homeML,
        "moneyline", gameName, `${awayTeam} ML`, `${homeTeam} ML`,
        arbs
      );

      // Over on book i, Under on book j
      if (oddsLines[i].total === oddsLines[j].total && oddsLines[i].total > 0) {
        checkArb(
          oddsLines[i], oddsLines[j],
          oddsLines[i].overPrice, oddsLines[j].underPrice,
          "total", gameName,
          `Over ${oddsLines[i].total}`, `Under ${oddsLines[j].total}`,
          arbs
        );
      }
    }
  }

  return arbs.sort((a, b) => a.holdPercentage - b.holdPercentage);
}

function checkArb(
  line1: OddsLine,
  line2: OddsLine,
  odds1: number,
  odds2: number,
  type: ArbitrageOpportunity["type"],
  game: string,
  pick1: string,
  pick2: string,
  results: ArbitrageOpportunity[]
) {
  if (odds1 === 0 || odds2 === 0) return;

  const imp1 = americanToImpliedProb(odds1);
  const imp2 = americanToImpliedProb(odds2);
  const hold = imp1 + imp2 - 1;

  // Negative hold = arbitrage opportunity
  if (hold < 0) {
    const totalStake = 100;
    const dec1 = americanToDecimal(odds1);
    const dec2 = americanToDecimal(odds2);
    const stake1 = totalStake * (imp1 / (imp1 + imp2));
    const stake2 = totalStake * (imp2 / (imp1 + imp2));
    const profit = (stake1 * dec1) - totalStake;

    results.push({
      type,
      game,
      side1: { bookmaker: line1.bookmaker, odds: odds1, pick: pick1 },
      side2: { bookmaker: line2.bookmaker, odds: odds2, pick: pick2 },
      holdPercentage: Math.round(hold * 10000) / 100,
      profit: Math.round(profit * 100) / 100,
      stake1: Math.round(stake1 * 100) / 100,
      stake2: Math.round(stake2 * 100) / 100,
    });
  }
}

// Find +EV bets using the "market consensus" as fair probability
export function findEVBets(
  oddsLines: OddsLine[],
  gameName: string,
  modelProb?: number, // our engine's probability
  bankroll: number = 1000
): EVBet[] {
  const evBets: EVBet[] = [];

  // Calculate market consensus (sharp line = average of best lines)
  const { fairHomeProb, fairAwayProb } = getMarketConsensus(oddsLines);

  // Use model probability if available, otherwise use market consensus
  const homeProb = modelProb ?? fairHomeProb;
  const awayProb = 1 - homeProb;

  // Parse team names from gameName ("Away Team @ Home Team")
  const parts = gameName.split(" @ ");
  const awayTeam = parts[0] ?? "Away";
  const homeTeam = parts[1] ?? "Home";

  // Check each book for +EV against fair line
  for (const line of oddsLines) {
    // Home ML — use actual team name
    checkEV(line, line.homeML, homeProb, "moneyline", `${homeTeam} ML`, gameName, bankroll, evBets);
    // Away ML — use actual team name
    checkEV(line, line.awayML, awayProb, "moneyline", `${awayTeam} ML`, gameName, bankroll, evBets);
    // Over/Under — include game name for clarity
    if (line.total > 0) {
      const { overProb } = getTotalConsensus(oddsLines);
      checkEV(line, line.overPrice, overProb, "total", `${awayTeam}/${homeTeam} Over ${line.total}`, gameName, bankroll, evBets);
      checkEV(line, line.underPrice, 1 - overProb, "total", `${awayTeam}/${homeTeam} Under ${line.total}`, gameName, bankroll, evBets);
    }
  }

  return evBets.sort((a, b) => b.evPercentage - a.evPercentage);
}

function checkEV(
  line: OddsLine,
  odds: number,
  fairProb: number,
  market: string,
  pick: string,
  game: string,
  bankroll: number,
  results: EVBet[]
) {
  if (odds === 0) return;

  const decimalOdds = americanToDecimal(odds);
  const impliedProb = americanToImpliedProb(odds);
  const ev = evPercentage(fairProb, decimalOdds);
  const confidence = getConfidence(ev);

  if (ev > 1.0) { // minimum 1% edge
    results.push({
      game,
      market,
      pick,
      bookmaker: line.bookmaker,
      odds,
      fairOdds: probToFairAmerican(fairProb),
      impliedProb: Math.round(impliedProb * 10000) / 100,
      fairProb: Math.round(fairProb * 10000) / 100,
      evPercentage: Math.round(ev * 100) / 100,
      kellyStake: kellyStake(fairProb, decimalOdds, bankroll, 0.25),
      halfKellyStake: kellyStake(fairProb, decimalOdds, bankroll, 0.125),
      confidence,
      reasoning: [],
    });
  }
}

// Get market consensus from all books (de-vigged average)
function getMarketConsensus(oddsLines: OddsLine[]): { fairHomeProb: number; fairAwayProb: number } {
  if (oddsLines.length === 0) return { fairHomeProb: 0.5, fairAwayProb: 0.5 };

  let totalHomeProb = 0;
  let count = 0;

  for (const line of oddsLines) {
    if (line.homeML !== 0 && line.awayML !== 0) {
      const { prob1 } = devig(line.homeML, line.awayML);
      totalHomeProb += prob1;
      count++;
    }
  }

  const fairHomeProb = count > 0 ? totalHomeProb / count : 0.5;
  return { fairHomeProb, fairAwayProb: 1 - fairHomeProb };
}

function getTotalConsensus(oddsLines: OddsLine[]): { overProb: number } {
  let totalOverProb = 0;
  let count = 0;

  for (const line of oddsLines) {
    if (line.overPrice !== 0 && line.underPrice !== 0) {
      const { prob1 } = devig(line.overPrice, line.underPrice);
      totalOverProb += prob1;
      count++;
    }
  }

  return { overProb: count > 0 ? totalOverProb / count : 0.5 };
}

// Detect sharp line movement (significant line change)
export function detectLineMovement(
  currentOdds: OddsLine[],
  previousOdds: OddsLine[]
): Array<{ bookmaker: string; market: string; oldOdds: number; newOdds: number; movement: number }> {
  const movements: Array<{ bookmaker: string; market: string; oldOdds: number; newOdds: number; movement: number }> = [];

  for (const current of currentOdds) {
    const prev = previousOdds.find((p) => p.bookmaker === current.bookmaker);
    if (!prev) continue;

    const homeMove = americanToImpliedProb(current.homeML) - americanToImpliedProb(prev.homeML);
    if (Math.abs(homeMove) > 0.02) {
      movements.push({
        bookmaker: current.bookmaker,
        market: "Home ML",
        oldOdds: prev.homeML,
        newOdds: current.homeML,
        movement: Math.round(homeMove * 10000) / 100,
      });
    }

    if (current.total !== prev.total) {
      movements.push({
        bookmaker: current.bookmaker,
        market: "Total",
        oldOdds: prev.total,
        newOdds: current.total,
        movement: current.total - prev.total,
      });
    }
  }

  return movements;
}

export { getMarketConsensus, getTotalConsensus };
