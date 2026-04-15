import { NextRequest, NextResponse } from "next/server";
import { deepTrainNbaProps } from "@/lib/bot/nba-prop-deep-trainer";
import { loadNbaPropBrainFromCloud, saveNbaPropBrainToCloud } from "@/lib/bot/nba-prop-brain";
import { cloudGet, cloudSet } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min max on Vercel Pro

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const reset = searchParams.get("reset") === "true";
  const seasons = (searchParams.get("seasons") || "2022,2023,2024").split(",").map(Number);

  try {
    // Load or create brain
    let brain = reset ? null : await loadNbaPropBrainFromCloud();
    if (!brain || reset) {
      // Import and create default
      const { default: createDefault } = await import("@/lib/bot/nba-prop-brain").then(m => ({ default: m }));
      brain = await loadNbaPropBrainFromCloud(); // will return default if nothing saved
      if (reset) {
        brain.weights = { seasonAverage: 0.25, recentForm: 0.20, matchupDefense: 0.18, homeAway: 0.10, restSchedule: 0.10, paceContext: 0.10, lineMovement: 0.07 };
        brain.playerMemory = {};
        brain.markets = {};
        brain.totalPredictions = 0;
        brain.totalHits = 0;
        brain.epoch = 0;
        brain.learningRate = 0.015;
        brain.isPreTrained = false;
        brain.trainedSeasons = [];
      }
    }

    // Update progress: running
    await cloudSet("nba_prop_training_progress", {
      status: "running",
      gamesProcessed: 0,
      totalGames: 0,
      currentSeason: seasons.join(","),
      startedAt: new Date().toISOString(),
      accuracy: {},
    });

    // Run training
    const result = await deepTrainNbaProps(
      brain,
      seasons,
      async (msg) => {
        // Update progress in Supabase
        const match = msg.match(/(\d+) games/);
        const gamesProcessed = match ? parseInt(match[1]) : 0;
        await cloudSet("nba_prop_training_progress", {
          status: "running",
          gamesProcessed,
          totalGames: 45000,
          message: msg,
          currentSeason: seasons.join(","),
          startedAt: new Date().toISOString(),
          accuracy: {},
        }).catch(() => {}); // don't fail training on progress save error
      }
    );

    // Save trained brain
    await saveNbaPropBrainToCloud(result.brain);

    // Update progress: complete
    await cloudSet("nba_prop_training_progress", {
      status: "complete",
      gamesProcessed: result.gamesProcessed,
      totalGames: result.gamesProcessed,
      playerGamesQuizzed: result.playerGamesQuizzed,
      propEventsTotal: result.propEventsTotal,
      accuracy: result.accuracy,
      durationMs: result.durationMs,
      completedAt: new Date().toISOString(),
    });

    return NextResponse.json({
      ok: true,
      gamesProcessed: result.gamesProcessed,
      playerGamesQuizzed: result.playerGamesQuizzed,
      propEventsTotal: result.propEventsTotal,
      accuracy: result.accuracy,
      durationMs: result.durationMs,
      weights: result.brain.weights,
      playersTracked: Object.keys(result.brain.playerMemory).length,
    });
  } catch (error: any) {
    await cloudSet("nba_prop_training_progress", {
      status: "error",
      error: error.message,
    }).catch(() => {});
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
