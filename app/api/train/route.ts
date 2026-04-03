import { NextResponse } from "next/server";
import { fetchHistoricalGames, trainOnHistoricalGames } from "@/lib/bot/historical-trainer";
import { loadLearningState, saveLearningState, type LearningState } from "@/lib/bot/learning";

// Training is expensive — don't cache aggressively
export const dynamic = "force-dynamic";

const DEFAULT_STATE: LearningState = {
  version: "v1.0.0",
  epoch: 0,
  gamesLearned: 0,
  lastOptimized: new Date().toISOString(),
  weights: {
    pitching: 0.28, hitting: 0.22, bullpen: 0.12, defense: 0.08,
    weather: 0.08, umpire: 0.07, momentum: 0.10, homeField: 0.05,
  },
  marketAccuracy: {
    moneyline: { market: "moneyline", totalBets: 0, wins: 0, losses: 0, brierScore: 0.25, avgEdge: 0, dynamicThreshold: 1.5 },
    spread: { market: "spread", totalBets: 0, wins: 0, losses: 0, brierScore: 0.25, avgEdge: 0, dynamicThreshold: 2.0 },
    total: { market: "total", totalBets: 0, wins: 0, losses: 0, brierScore: 0.25, avgEdge: 0, dynamicThreshold: 2.0 },
    player_prop: { market: "player_prop", totalBets: 0, wins: 0, losses: 0, brierScore: 0.25, avgEdge: 0, dynamicThreshold: 1.5 },
  },
  learningRate: 0.03,
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const startDate = searchParams.get("start") || "2025-03-20"; // Opening Day 2025
  const endDate = searchParams.get("end") || new Date().toISOString().split("T")[0];
  const reset = searchParams.get("reset") === "true";

  try {
    // Fetch historical games in chunks (MLB API handles date ranges)
    const allGames = [];
    let currentStart = new Date(startDate);
    const finalEnd = new Date(endDate);

    // Process in 30-day chunks to avoid overwhelming the API
    while (currentStart < finalEnd) {
      const chunkEnd = new Date(currentStart);
      chunkEnd.setDate(chunkEnd.getDate() + 30);
      if (chunkEnd > finalEnd) chunkEnd.setTime(finalEnd.getTime());

      const chunk = await fetchHistoricalGames(
        currentStart.toISOString().split("T")[0],
        chunkEnd.toISOString().split("T")[0]
      );
      allGames.push(...chunk);

      currentStart.setDate(currentStart.getDate() + 31);
    }

    // Train on all games
    const initialState = reset ? { ...DEFAULT_STATE } : DEFAULT_STATE;
    const { state: trainedState, stats } = trainOnHistoricalGames(initialState, allGames);

    return NextResponse.json({
      success: true,
      trainedState,
      stats,
      dateRange: { start: startDate, end: endDate },
      message: `Trained on ${stats.gamesProcessed} games from ${startDate} to ${endDate}`,
    });
  } catch (error: any) {
    console.error("Training error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
