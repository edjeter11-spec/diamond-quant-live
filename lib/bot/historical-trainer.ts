// ──────────────────────────────────────────────────────────
// Historical Trainer
// Fetches 2025 MLB game results and runs them through the
// learning loop to pre-train the model weights
// ──────────────────────────────────────────────────────────

import { learnFromBet, type LearningState } from "./learning";

const MLB_API = "https://statsapi.mlb.com/api/v1";

interface HistoricalGame {
  gamePk: number;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  homeWin: boolean;
  totalRuns: number;
  homePitcher: string;
  awayPitcher: string;
}

// Fetch completed games for a date range from MLB Stats API
export async function fetchHistoricalGames(
  startDate: string,  // YYYY-MM-DD
  endDate: string
): Promise<HistoricalGame[]> {
  const url = `${MLB_API}/schedule?sportId=1&startDate=${startDate}&endDate=${endDate}&gameType=R&hydrate=probablePitcher`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MLB API error: ${res.status}`);

  const data = await res.json();
  const games: HistoricalGame[] = [];

  for (const dateEntry of data.dates ?? []) {
    for (const game of dateEntry.games ?? []) {
      // Only completed games
      if (game.status?.statusCode !== "F") continue;

      const homeScore = game.teams?.home?.score ?? 0;
      const awayScore = game.teams?.away?.score ?? 0;

      games.push({
        gamePk: game.gamePk,
        date: dateEntry.date,
        homeTeam: game.teams?.home?.team?.name ?? "",
        awayTeam: game.teams?.away?.team?.name ?? "",
        homeScore,
        awayScore,
        homeWin: homeScore > awayScore,
        totalRuns: homeScore + awayScore,
        homePitcher: game.teams?.home?.probablePitcher?.fullName ?? "Unknown",
        awayPitcher: game.teams?.away?.probablePitcher?.fullName ?? "Unknown",
      });
    }
  }

  return games;
}

// Simulate what the model would have predicted and learn from actual results
export function trainOnHistoricalGames(
  state: LearningState,
  games: HistoricalGame[]
): { state: LearningState; stats: TrainingStats } {
  let updatedState = { ...state };
  let mlWins = 0, mlLosses = 0;
  let totalWins = 0, totalLosses = 0;
  let totalGames = 0;

  for (const game of games) {
    totalGames++;

    // Simulate ML prediction: home team
    // Use a simple heuristic — home teams win ~54% historically
    // The model will learn to adjust this based on actual results
    const baseHomeProb = 0.54;

    // Simulate the model's "bet" — did home team win?
    const homeWon = game.homeWin;

    // Feed as a moneyline bet
    updatedState = learnFromBet(updatedState, {
      market: "moneyline",
      fairProb: baseHomeProb,
      result: homeWon ? "win" : "loss",
      evAtPlacement: 2.0, // assumed avg edge
    });

    if (homeWon) mlWins++;
    else mlLosses++;

    // Simulate total prediction: league avg is ~8.5 runs
    const avgTotal = 8.5;
    const overHit = game.totalRuns > avgTotal;

    updatedState = learnFromBet(updatedState, {
      market: "total",
      fairProb: 0.50,
      result: overHit ? "win" : "loss",
      evAtPlacement: 1.5,
    });

    if (overHit) totalWins++;
    else totalLosses++;
  }

  return {
    state: updatedState,
    stats: {
      gamesProcessed: totalGames,
      mlRecord: `${mlWins}W-${mlLosses}L`,
      mlWinRate: totalGames > 0 ? (mlWins / totalGames) * 100 : 0,
      totalRecord: `${totalWins}W-${totalLosses}L`,
      totalWinRate: totalGames > 0 ? (totalWins / totalGames) * 100 : 0,
      finalWeights: updatedState.weights,
      finalVersion: updatedState.version,
      epoch: updatedState.epoch,
    },
  };
}

export interface TrainingStats {
  gamesProcessed: number;
  mlRecord: string;
  mlWinRate: number;
  totalRecord: string;
  totalWinRate: number;
  finalWeights: any;
  finalVersion: string;
  epoch: number;
}
