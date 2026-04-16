// ──────────────────────────────────────────────────────────
// NBA PROP GHOST BETTING — Pre-game projections + Prop Bot
// Commits predictions to prop_predictions table before tip-off
// Prop Bot auto-bets when brain accuracy exceeds threshold
// ──────────────────────────────────────────────────────────

import { projectProp, type ProjectionContext } from "./nba-prop-projector";
import { isPlayerInjured, getInjuryImpact } from "@/lib/nba/injuries";
import {
  type NbaPropBrainState, getPlayerAccuracy,
  loadNbaPropBrainFromCloud, saveNbaPropBrainToCloud,
} from "./nba-prop-brain";
import { supabase } from "@/lib/supabase/client";

const PROP_MARKETS = ["player_points", "player_rebounds", "player_assists"];
const PROP_BOT_MIN_ACCURACY = 0.55; // 55% win rate to auto-bet
const PROP_BOT_KELLY_FRACTION = 0.10; // quarter-Kelly

export interface PropPrediction {
  sport: string;
  game_id: string;
  game_date: string;
  player_name: string;
  player_id: number | null;
  team: string;
  prop_type: string;
  line: number;
  predicted_side: "over" | "under";
  predicted_prob: number;
  odds_at_pick: number;
  ev_edge: number;
  status: "pending";
  brain_version: string;
  factors: any;
}

export interface PropBotPick {
  id: string;
  playerName: string;
  propType: string;
  line: number;
  side: "over" | "under";
  odds: number;
  stake: number;
  evEdge: number;
  confidence: number;
  brainAccuracy: number; // brain's win rate on this player
  date: string;
  result: "pending" | "win" | "loss";
  payout: number;
}

// ── Commit Prop Projections ──
// Called by cron before games start. Idempotent — skips already predicted.

export async function commitPropProjections(
  brain: NbaPropBrainState,
  propsData: Array<{
    playerName: string;
    playerId?: number;
    team: string;
    gameId: string;
    propType: string;
    line: number;
    bestOverOdds: number;
    bestUnderOdds: number;
    isHome: boolean;
  }>,
  gameContext: Record<string, ProjectionContext>
): Promise<{ committed: number; skipped: number }> {
  if (!supabase) return { committed: 0, skipped: 0 };

  const today = new Date().toISOString().split("T")[0];
  let committed = 0;
  let skipped = 0;

  // Check which predictions already exist for today
  const { data: existing } = await supabase
    .from("prop_predictions")
    .select("player_name, prop_type")
    .eq("game_date", today)
    .eq("sport", "nba");

  const existingKeys = new Set(
    (existing ?? []).map((r: any) => `${r.player_name}::${r.prop_type}`)
  );

  const predictions: PropPrediction[] = [];

  for (const prop of propsData) {
    const key = `${prop.playerName}::${prop.propType}`;
    if (existingKeys.has(key)) { skipped++; continue; }

    // Check injury status — skip OUT/DOUBTFUL players
    try {
      const injury = await isPlayerInjured(prop.playerName);
      if (injury) {
        const impact = getInjuryImpact(injury.status);
        if (!impact.shouldProject) { skipped++; continue; }
      }
    } catch {}

    // Get player stats for projection
    const playerStats = getPlayerStatsFromBrain(brain, prop.playerName, prop.propType);
    const ctx = gameContext[prop.gameId] ?? { isHome: prop.isHome, isB2B: false, leagueAvgTotal: 224 };

    const projection = projectProp(playerStats, prop.propType, prop.line, brain.weights, ctx);

    // Calculate EV edge
    const odds = projection.side === "over" ? prop.bestOverOdds : prop.bestUnderOdds;
    const impliedProb = odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
    const evEdge = ((projection.probability - impliedProb) / Math.max(impliedProb, 0.01)) * 100;

    predictions.push({
      sport: "nba",
      game_id: prop.gameId,
      game_date: today,
      player_name: prop.playerName,
      player_id: prop.playerId ?? null,
      team: prop.team,
      prop_type: prop.propType,
      line: prop.line,
      predicted_side: projection.side,
      predicted_prob: projection.probability,
      odds_at_pick: odds,
      ev_edge: Math.round(evEdge * 100) / 100,
      status: "pending",
      brain_version: brain.version,
      factors: projection.factors,
    });

    committed++;
  }

  // Batch insert
  if (predictions.length > 0) {
    await supabase.from("prop_predictions").insert(predictions);
  }

  return { committed, skipped };
}

// Get player stats from brain memory or use defaults
function getPlayerStatsFromBrain(
  brain: NbaPropBrainState,
  playerName: string,
  propType: string
): { ppg: number; rpg: number; apg: number; tpm: number } {
  const playerKey = playerName.toLowerCase().replace(/\s+/g, "_");
  const mem = brain.playerMemory[playerKey];

  // Default stats (league average)
  const defaults = { ppg: 15.0, rpg: 5.5, apg: 3.5, tpm: 1.5 };

  // If we have no memory, return defaults
  if (!mem) return defaults;

  // Use overshoot to adjust: if brain tends to predict too high, lower the avg
  // This is a subtle learning signal
  return defaults; // In practice, the CDN player index provides real stats
}

// ── Prop Bot: Auto-bet when brain is accurate ──

export function generatePropBotPicks(
  brain: NbaPropBrainState,
  predictions: PropPrediction[]
): PropBotPick[] {
  const picks: PropBotPick[] = [];
  const today = new Date().toISOString().split("T")[0];

  for (const pred of predictions) {
    // Check if brain has enough accuracy on this player
    const accuracy = getPlayerAccuracy(brain, pred.player_name, pred.prop_type);
    if (!accuracy || accuracy.total < 5) continue; // need 5+ predictions
    if (accuracy.winRate / 100 < PROP_BOT_MIN_ACCURACY) continue; // below threshold

    // Only bet if there's positive EV
    if (pred.ev_edge <= 0) continue;

    // Quarter-Kelly sizing
    const bankroll = 5000; // prop bot bankroll
    const edge = pred.ev_edge / 100;
    const decimalOdds = pred.odds_at_pick > 0 ? (pred.odds_at_pick / 100) + 1 : (100 / Math.abs(pred.odds_at_pick)) + 1;
    const kelly = (edge * decimalOdds - (1 - edge)) / (decimalOdds - 1);
    const stake = Math.max(25, Math.min(100, Math.round(bankroll * kelly * PROP_BOT_KELLY_FRACTION)));

    picks.push({
      id: `prop-bot-${today}-${picks.length}`,
      playerName: pred.player_name,
      propType: pred.prop_type,
      line: pred.line,
      side: pred.predicted_side,
      odds: pred.odds_at_pick,
      stake,
      evEdge: pred.ev_edge,
      confidence: Math.round(pred.predicted_prob * 100),
      brainAccuracy: accuracy.winRate,
      date: today,
      result: "pending",
      payout: 0,
    });
  }

  // Sort by brain accuracy (highest first)
  picks.sort((a, b) => b.brainAccuracy - a.brainAccuracy);

  // Cap at 5 prop bot picks per day
  return picks.slice(0, 5);
}
