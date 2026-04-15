// ──────────────────────────────────────────────────────────
// NBA PROP AUDIT — Post-Game Grading + Brain Learning
// Runs after games finish: compares actuals to projections
// Feeds results into brain learning loop
// ──────────────────────────────────────────────────────────

import { learnFromPropResult, type NbaPropBrainState, type AuditResult } from "./nba-prop-brain";
import { supabase } from "@/lib/supabase/client";

// Prop type → box score stat key mapping
const PROP_TO_BOX: Record<string, string> = {
  player_points: "pts",
  player_rebounds: "reb",
  player_assists: "ast",
  player_threes: "fg3m",
};

// ── Fuzzy player name matching ──
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\./g, "")          // P.J. → PJ
    .replace(/'/g, "")           // O'Brien → OBrien
    .replace(/\s+(jr|sr|ii|iii|iv)$/i, "") // Strip suffixes
    .replace(/\s+/g, " ")
    .trim();
}

function playerMatch(predicted: string, boxScore: string): boolean {
  const a = normalizeName(predicted);
  const b = normalizeName(boxScore);
  if (a === b) return true;
  // Last name + first 3 chars of first name
  const aParts = a.split(" ");
  const bParts = b.split(" ");
  if (aParts.length >= 2 && bParts.length >= 2) {
    const aKey = `${aParts[aParts.length - 1]}${aParts[0].slice(0, 3)}`;
    const bKey = `${bParts[bParts.length - 1]}${bParts[0].slice(0, 3)}`;
    return aKey === bKey;
  }
  return false;
}

// ── Main Audit Function ──
export async function auditCompletedGames(
  brain: NbaPropBrainState
): Promise<{
  updatedBrain: NbaPropBrainState;
  graded: number;
  hits: number;
  misses: number;
}> {
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

  // 2. Get unique game IDs
  const gameIds = [...new Set(pending.map((p: any) => p.game_id))];
  let updatedBrain = { ...brain };
  let totalGraded = 0;
  let totalHits = 0;
  let totalMisses = 0;

  // Process max 3 games per cron run (Vercel timeout safety)
  for (const gameId of gameIds.slice(0, 3)) {
    try {
      // 3. Check if game is final via balldontlie
      const gameRes = await fetch(`https://api.balldontlie.io/v1/games/${gameId}`, {
        headers: { Authorization: process.env.BALLDONTLIE_API_KEY || "" },
      });
      if (!gameRes.ok) continue;
      const gameData = await gameRes.json();
      const game = gameData.data ?? gameData;

      if (game.status !== "Final") continue;

      // 4. Fetch box score stats for this game
      const statsRes = await fetch(
        `https://api.balldontlie.io/v1/stats?game_ids[]=${gameId}&per_page=100`,
        { headers: { Authorization: process.env.BALLDONTLIE_API_KEY || "" } }
      );
      if (!statsRes.ok) continue;
      const statsData = await statsRes.json();
      const playerStats: Array<{
        player: { first_name: string; last_name: string; id: number };
        pts: number; reb: number; ast: number; fg3m: number;
      }> = statsData.data ?? [];

      // 5. Grade each pending prediction for this game
      const gamePredictions = pending.filter((p: any) => p.game_id === gameId);

      for (const pred of gamePredictions) {
        const statKey = PROP_TO_BOX[pred.prop_type];
        if (!statKey) continue;

        // Find matching player in box score
        const boxPlayer = playerStats.find(s =>
          playerMatch(pred.player_name, `${s.player.first_name} ${s.player.last_name}`)
        );

        if (!boxPlayer) {
          // Player didn't play — void the prediction
          await supabase.from("prop_predictions").update({
            status: "void",
            graded_at: new Date().toISOString(),
          }).eq("id", pred.id);
          continue;
        }

        const actualValue = (boxPlayer as any)[statKey] ?? 0;
        const hit = pred.predicted_side === "over"
          ? actualValue > pred.line
          : actualValue < pred.line;
        const brierScore = Math.pow(pred.predicted_prob - (hit ? 1 : 0), 2);

        // 6. Update prediction row
        await supabase.from("prop_predictions").update({
          actual_value: actualValue,
          hit,
          brier_score: Math.round(brierScore * 10000) / 10000,
          status: "graded",
          graded_at: new Date().toISOString(),
        }).eq("id", pred.id);

        // 7. Feed into brain learning
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
        if (hit) totalHits++;
        else totalMisses++;
      }
    } catch (err) {
      // Skip game on error, try next
      continue;
    }
  }

  // 8. Record audit result
  if (totalGraded > 0) {
    const auditResult: AuditResult = {
      gameId: gameIds.join(","),
      gameDate: today,
      graded: totalGraded,
      hits: totalHits,
      misses: totalMisses,
      avgBrier: totalGraded > 0 ? Math.round((totalMisses / totalGraded) * 100) / 100 : 0,
      timestamp: new Date().toISOString(),
    };
    updatedBrain.recentAudits = [...updatedBrain.recentAudits, auditResult].slice(-20);
    updatedBrain.lastAuditAt = new Date().toISOString();
  }

  return { updatedBrain, graded: totalGraded, hits: totalHits, misses: totalMisses };
}
