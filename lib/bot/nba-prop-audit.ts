// ──────────────────────────────────────────────────────────
// NBA PROP AUDIT — Post-Game Grading via NBA CDN Box Scores
// No paid API needed — uses free cdn.nba.com box score endpoint
// Runs after games finish: compares actuals to projections
// Feeds results into brain learning loop
// ──────────────────────────────────────────────────────────

import { learnFromPropResult, type NbaPropBrainState, type AuditResult } from "./nba-prop-brain";
import { supabase } from "@/lib/supabase/client";

const PROP_TO_BOX: Record<string, string> = {
  player_points: "points",
  player_rebounds: "reboundsTotal",
  player_assists: "assists",
  player_threes: "threePointersMade",
};

// Fallback stat keys (CDN format varies)
const PROP_TO_BOX_ALT: Record<string, string> = {
  player_points: "pts",
  player_rebounds: "reb",
  player_assists: "ast",
  player_threes: "fg3m",
};

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\./g, "").replace(/'/g, "").replace(/\s+(jr|sr|ii|iii|iv)$/i, "").replace(/\s+/g, " ").trim();
}

function playerMatch(predicted: string, boxFirst: string, boxLast: string): boolean {
  const a = normalizeName(predicted);
  const b = normalizeName(`${boxFirst} ${boxLast}`);
  if (a === b) return true;
  const aParts = a.split(" ");
  const bParts = b.split(" ");
  if (aParts.length >= 2 && bParts.length >= 2) {
    return aParts[aParts.length - 1] === bParts[bParts.length - 1] && aParts[0].slice(0, 3) === bParts[0].slice(0, 3);
  }
  return false;
}

// Fetch box score from NBA CDN (free, no auth)
async function fetchCDNBoxScore(gameId: string): Promise<Array<{
  firstName: string; lastName: string; personId: number;
  points: number; reboundsTotal: number; assists: number; threePointersMade: number;
}> | null> {
  try {
    const res = await fetch(`https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${gameId}.json`);
    if (!res.ok) return null;
    const data = await res.json();
    const game = data.game;
    if (!game || game.gameStatus < 3) return null; // not final

    const players: Array<any> = [];
    for (const team of [game.homeTeam, game.awayTeam]) {
      for (const p of team?.players ?? []) {
        if (p.played !== "1") continue;
        const stats = p.statistics ?? {};
        players.push({
          firstName: p.firstName ?? "",
          lastName: p.familyName ?? "",
          personId: p.personId,
          points: stats.points ?? 0,
          reboundsTotal: stats.reboundsTotal ?? 0,
          assists: stats.assists ?? 0,
          threePointersMade: stats.threePointersMade ?? 0,
        });
      }
    }
    return players;
  } catch {
    return null;
  }
}

// Get today's finished game IDs from NBA CDN scoreboard
async function getTodayFinishedGameIds(): Promise<string[]> {
  try {
    const res = await fetch("https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json");
    if (!res.ok) return [];
    const data = await res.json();
    const games = data.scoreboard?.games ?? [];
    return games.filter((g: any) => g.gameStatus === 3).map((g: any) => g.gameId);
  } catch {
    return [];
  }
}

// ── Main Audit Function ──
export async function auditCompletedGames(
  brain: NbaPropBrainState
): Promise<{ updatedBrain: NbaPropBrainState; graded: number; hits: number; misses: number }> {
  if (!supabase) return { updatedBrain: brain, graded: 0, hits: 0, misses: 0 };

  // 1. Find pending predictions
  const today = new Date().toISOString().split("T")[0];
  const { data: pending } = await supabase
    .from("prop_predictions")
    .select("*")
    .eq("status", "pending")
    .eq("sport", "nba")
    .lte("game_date", today)
    .limit(100);

  if (!pending || pending.length === 0) {
    return { updatedBrain: brain, graded: 0, hits: 0, misses: 0 };
  }

  // 2. Get today's finished games from NBA CDN
  const finishedGameIds = await getTodayFinishedGameIds();
  if (finishedGameIds.length === 0) {
    return { updatedBrain: brain, graded: 0, hits: 0, misses: 0 };
  }

  let updatedBrain = { ...brain };
  let totalGraded = 0, totalHits = 0, totalMisses = 0;

  // 3. For each finished game, fetch box score and grade predictions
  for (const gameId of finishedGameIds.slice(0, 5)) {
    const boxScore = await fetchCDNBoxScore(gameId);
    if (!boxScore || boxScore.length === 0) continue;

    // Find predictions that match this game (fuzzy match on team names in game_id or date)
    const gamePredictions = pending.filter((p: any) => {
      // Match by date (all pending for today)
      return p.game_date === today && p.status === "pending";
    });

    for (const pred of gamePredictions) {
      const statKey = PROP_TO_BOX[pred.prop_type];
      const statKeyAlt = PROP_TO_BOX_ALT[pred.prop_type];
      if (!statKey) continue;

      // Find matching player in box score
      const boxPlayer = boxScore.find(p => playerMatch(pred.player_name, p.firstName, p.lastName));
      if (!boxPlayer) continue; // player not in this game's box score

      const actualValue = (boxPlayer as any)[statKey] ?? (boxPlayer as any)[statKeyAlt] ?? 0;
      const hit = pred.predicted_side === "over" ? actualValue > pred.line : actualValue < pred.line;
      const brierScore = Math.pow(pred.predicted_prob - (hit ? 1 : 0), 2);

      // Update prediction row
      await supabase.from("prop_predictions").update({
        actual_value: actualValue,
        hit,
        brier_score: Math.round(brierScore * 10000) / 10000,
        status: "graded",
        graded_at: new Date().toISOString(),
      }).eq("id", pred.id);

      // Feed into brain learning
      updatedBrain = learnFromPropResult(updatedBrain, {
        playerName: pred.player_name,
        playerId: pred.player_id,
        team: pred.team,
        propType: pred.prop_type,
        predictedProb: pred.predicted_prob,
        predictedSide: pred.predicted_side,
        actualValue,
        line: pred.line,
        hit,
        factors: pred.factors ?? [],
      });

      totalGraded++;
      if (hit) totalHits++; else totalMisses++;
    }

    // Small delay between games
    await new Promise(r => setTimeout(r, 200));
  }

  // Record audit result
  if (totalGraded > 0) {
    updatedBrain.recentAudits = [...updatedBrain.recentAudits, {
      gameId: finishedGameIds.join(","),
      gameDate: today,
      graded: totalGraded,
      hits: totalHits,
      misses: totalMisses,
      avgBrier: Math.round((totalMisses / totalGraded) * 100) / 100,
      timestamp: new Date().toISOString(),
    }].slice(-20);
    updatedBrain.lastAuditAt = new Date().toISOString();
  }

  return { updatedBrain, graded: totalGraded, hits: totalHits, misses: totalMisses };
}
