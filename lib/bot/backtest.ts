// ──────────────────────────────────────────────────────────
// BACKTEST — Run current model against recent historical games
// Shows what profit/loss would have been
// ──────────────────────────────────────────────────────────

import { type BrainState } from "./brain";

const MLB_API = "https://statsapi.mlb.com/api/v1";

export interface BacktestResult {
  period: string;
  gamesAnalyzed: number;
  homePicks: number;
  awayPicks: number;
  wins: number;
  losses: number;
  winRate: number;
  profitLoss: number;     // on $100 flat bets
  roi: number;
  bestStreak: number;
  worstStreak: number;
  byMonth: Array<{ month: string; wins: number; losses: number; pnl: number }>;
}

export async function runBacktest(
  brain: BrainState,
  startDate: string,
  endDate: string
): Promise<BacktestResult> {
  let wins = 0, losses = 0, pnl = 0;
  let homePicks = 0, awayPicks = 0;
  let currentStreak = 0, bestStreak = 0, worstStreak = 0;
  let totalGames = 0;
  const byMonth: Record<string, { wins: number; losses: number; pnl: number }> = {};

  // Fetch games in the date range
  const res = await fetch(`${MLB_API}/schedule?sportId=1&startDate=${startDate}&endDate=${endDate}&gameType=R&hydrate=probablePitcher`);
  if (!res.ok) throw new Error("Failed to fetch backtest data");
  const data = await res.json();

  for (const dateEntry of data.dates ?? []) {
    const month = dateEntry.date.slice(0, 7); // YYYY-MM
    if (!byMonth[month]) byMonth[month] = { wins: 0, losses: 0, pnl: 0 };

    for (const game of dateEntry.games ?? []) {
      if (game.status?.statusCode !== "F") continue;

      const homeScore = game.teams?.home?.score ?? 0;
      const awayScore = game.teams?.away?.score ?? 0;
      if (homeScore === 0 && awayScore === 0) continue;
      const homeWon = homeScore > awayScore;

      const homeTeam = game.teams?.home?.team?.name ?? "";
      const awayTeam = game.teams?.away?.team?.name ?? "";
      const homePitcher = game.teams?.home?.probablePitcher?.fullName ?? "";
      const awayPitcher = game.teams?.away?.probablePitcher?.fullName ?? "";

      // Use brain's pitcher memory to predict
      let predictedHomeProb = 0.54; // baseline

      // Check pitcher memory
      if (brain.pitcherMemory) {
        const hpMem = brain.pitcherMemory[homePitcher.toLowerCase()];
        const apMem = brain.pitcherMemory[awayPitcher.toLowerCase()];

        if (hpMem && hpMem.gamesTracked >= 5) {
          predictedHomeProb += (hpMem.winRate / 100 - 0.5) * 0.3;
        }
        if (apMem && apMem.gamesTracked >= 5) {
          predictedHomeProb -= (apMem.winRate / 100 - 0.5) * 0.3;
        }
      }

      // Check matchup memory
      if (brain.matchupMemory) {
        const mKey = `${awayTeam.toLowerCase()}::${homeTeam.toLowerCase()}`;
        const matchup = brain.matchupMemory[mKey];
        if (matchup && matchup.games >= 3) {
          const matchupHomeRate = matchup.homeWins / matchup.games;
          predictedHomeProb = predictedHomeProb * 0.7 + matchupHomeRate * 0.3;
        }
      }

      // Check park memory
      const venue = game.venue?.name ?? "";
      if (brain.parkMemory && brain.parkMemory[venue]) {
        const parkHome = brain.parkMemory[venue].homeWins / Math.max(brain.parkMemory[venue].games, 1);
        predictedHomeProb = predictedHomeProb * 0.85 + parkHome * 0.15;
      }

      // Apply brain weights
      predictedHomeProb = Math.min(0.80, Math.max(0.20, predictedHomeProb));

      // Make a pick: bet the side with >55% predicted prob
      const pickHome = predictedHomeProb > 0.55;
      const pickAway = predictedHomeProb < 0.45;

      if (!pickHome && !pickAway) continue; // skip uncertain games

      totalGames++;
      if (pickHome) homePicks++;
      else awayPicks++;

      const won = (pickHome && homeWon) || (pickAway && !homeWon);

      if (won) {
        wins++;
        pnl += 90; // ~-110 odds = $90 profit on $100
        byMonth[month].wins++;
        byMonth[month].pnl += 90;
        currentStreak = Math.max(currentStreak + 1, 1);
        if (currentStreak > bestStreak) bestStreak = currentStreak;
      } else {
        losses++;
        pnl -= 100;
        byMonth[month].losses++;
        byMonth[month].pnl -= 100;
        currentStreak = Math.min(currentStreak - 1, -1);
        if (Math.abs(currentStreak) > worstStreak) worstStreak = Math.abs(currentStreak);
      }
    }
  }

  const winRate = (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 1000) / 10 : 0;
  const totalStaked = (wins + losses) * 100;
  const roi = totalStaked > 0 ? Math.round((pnl / totalStaked) * 1000) / 10 : 0;

  return {
    period: `${startDate} to ${endDate}`,
    gamesAnalyzed: totalGames,
    homePicks,
    awayPicks,
    wins,
    losses,
    winRate,
    profitLoss: pnl,
    roi,
    bestStreak,
    worstStreak,
    byMonth: Object.entries(byMonth).map(([month, data]) => ({ month, ...data })),
  };
}
