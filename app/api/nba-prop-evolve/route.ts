import { NextRequest, NextResponse } from "next/server";
import { evolve } from "@/lib/bot/nba-brain-evolution";
import { loadNbaPropBrainFromCloud, saveNbaPropBrainToCloud } from "@/lib/bot/nba-prop-brain";
import { fetchAllTrainingData } from "@/lib/bot/nba-stats-fetcher";
import { cloudGet, cloudSet } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const generations = Math.min(2, parseInt(searchParams.get("generations") || "2"));

  try {
    // Load current brain weights as starting point
    const brain = await loadNbaPropBrainFromCloud();
    const startingWeights = brain.weights;

    // Update evolution progress
    await cloudSet("nba_evolution_progress", {
      status: "running",
      generation: 0,
      totalGenerations: generations,
      message: "Loading training data...",
      startedAt: new Date().toISOString(),
    });

    // Fetch training data (cached)
    const allData = await fetchAllTrainingData([2022, 2023, 2024], async (msg) => {
      await cloudSet("nba_evolution_progress", {
        status: "running", generation: 0, totalGenerations: generations, message: msg,
        startedAt: new Date().toISOString(),
      }).catch(() => {});
    });

    if (allData.length === 0) {
      return NextResponse.json({ ok: false, error: "No training data available" }, { status: 500 });
    }

    // Run evolution
    const evolutionState = await evolve(startingWeights, generations, allData, async (msg) => {
      const genMatch = msg.match(/GENERATION (\d+)/);
      const gen = genMatch ? parseInt(genMatch[1]) : 0;
      await cloudSet("nba_evolution_progress", {
        status: "running",
        generation: gen,
        totalGenerations: generations,
        message: msg,
        startedAt: new Date().toISOString(),
      }).catch(() => {});
    });

    // Promote winner: update the live brain with winning weights
    if (evolutionState.bestEverWinRate > 0) {
      brain.weights = { ...evolutionState.liveWeights };
      brain.isPreTrained = true;
      brain.lastTrainedAt = new Date().toISOString();
      brain.version = `evolved-gen${evolutionState.totalGenerationsRun}`;
      brain.logs.push({
        timestamp: new Date().toISOString(),
        type: "EVOLUTION",
        message: `Evolved through ${generations} generations. Best: ${evolutionState.bestEverVariantId} at ${evolutionState.bestEverWinRate}%`,
      });
      await saveNbaPropBrainToCloud(brain);
    }

    // Save evolution state
    await cloudSet("nba_brain_evolution", evolutionState);

    // Mark complete
    await cloudSet("nba_evolution_progress", {
      status: "complete",
      generation: generations,
      totalGenerations: generations,
      bestWinRate: evolutionState.bestEverWinRate,
      bestVariant: evolutionState.bestEverVariantId,
      history: evolutionState.history,
      completedAt: new Date().toISOString(),
    });

    return NextResponse.json({
      ok: true,
      generations: evolutionState.totalGenerationsRun,
      bestWinRate: evolutionState.bestEverWinRate,
      bestVariant: evolutionState.bestEverVariantId,
      finalWeights: evolutionState.liveWeights,
      history: evolutionState.history,
      allVariants: evolutionState.variants.map(v => ({
        id: v.id, name: v.name, generation: v.generation,
        testWinRate: v.overallTestWinRate, strategy: v.strategy,
      })),
    });
  } catch (error: any) {
    await cloudSet("nba_evolution_progress", { status: "error", error: error.message }).catch(() => {});
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
