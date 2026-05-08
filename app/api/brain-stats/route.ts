import { NextResponse } from "next/server";
import { cloudGet } from "@/lib/supabase/client";
import { loadNbaPropBrainFromCloud } from "@/lib/bot/nba-prop-brain";
import type { EvolutionState } from "@/lib/bot/nba-brain-evolution";

export const dynamic = "force-dynamic";

// CDN cache: 60s fresh, 5 min stale-while-revalidate. Brain only updates daily
// during cron training, so fresh-after-60s is plenty.
const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" };

export async function GET() {
  try {
    const [brain, evolution] = await Promise.all([
      loadNbaPropBrainFromCloud(),
      cloudGet<EvolutionState | null>("nba_brain_evolution", null),
    ]);

    // Top players by win rate (min 5 picks)
    const players = Object.values(brain.playerMemory ?? {})
      .filter((p: any) => p.totalPredictions >= 5)
      .sort((a: any, b: any) => b.winRate - a.winRate)
      .slice(0, 30)
      .map((p: any) => ({
        name: p.name,
        team: p.team,
        total: p.totalPredictions,
        hits: p.hits,
        winRate: p.winRate,
        brierScore: p.brierScore,
        byPropType: p.byPropType,
      }));

    return NextResponse.json({
      ok: true,
      brain: {
        version: brain.version,
        epoch: brain.epoch,
        lastTrainedAt: brain.lastTrainedAt,
        lastAuditAt: brain.lastAuditAt,
        weights: brain.weights,
        learningRate: brain.learningRate,
        totalPredictions: brain.totalPredictions,
        totalHits: brain.totalHits,
        totalGamesProcessed: brain.totalGamesProcessed,
        markets: brain.markets,
        recentAudits: (brain.recentAudits ?? []).slice(-15),
        playerCount: Object.keys(brain.playerMemory ?? {}).length,
      },
      topPlayers: players,
      evolution: evolution ? {
        currentGeneration: evolution.currentGeneration,
        liveBrainId: evolution.liveBrainId,
        bestEverWinRate: evolution.bestEverWinRate,
        history: evolution.history,
      } : null,
    }, { headers: CACHE_HEADERS });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
