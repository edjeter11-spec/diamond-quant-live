// ──────────────────────────────────────────────────────────
// NBA PROP AUDIT — Post-Game Grading via NBA CDN Box Scores
// No paid API needed — uses free cdn.nba.com box score endpoint
// Runs after games finish: compares actuals to projections
// Feeds results into brain learning loop
// ──────────────────────────────────────────────────────────

import {
  learnFromPropResult,
  type NbaPropBrainState,
  type AuditResult,
} from "./nba-prop-brain";
import { supabase } from "@/lib/supabase/client";
import { etDateString } from "@/lib/sports-date";

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
  return name
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/'/g, "")
    .replace(/\s+(jr|sr|ii|iii|iv)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function playerMatch(
  predicted: string,
  boxFirst: string,
  boxLast: string,
): boolean {
  const a = normalizeName(predicted);
  const b = normalizeName(`${boxFirst} ${boxLast}`);
  if (a === b) return true;
  const aParts = a.split(" ");
  const bParts = b.split(" ");
  if (aParts.length >= 2 && bParts.length >= 2) {
    // Surname must match AND the full first name must match.
    //
    // This used to compare only the first THREE letters of the first name,
    // which collides on real NBA pairs: "Marcus Morris" vs "Markieff Morris"
    // (mar===mar, morris===morris) graded one brother off the other's line.
    // Same for Jaren/Jared, Jalen/Jaylen surname-sharers. A prefix match is
    // fine for "will these ever be the same person" heuristics; it is not
    // fine when the answer writes a win/loss into the record.
    return (
      aParts[aParts.length - 1] === bParts[bParts.length - 1] &&
      aParts[0] === bParts[0]
    );
  }
  return false;
}

// Fetch box score from NBA CDN (free, no auth)
async function fetchCDNBoxScore(gameId: string): Promise<Array<{
  firstName: string;
  lastName: string;
  personId: number;
  points: number;
  reboundsTotal: number;
  assists: number;
  threePointersMade: number;
}> | null> {
  try {
    const res = await fetch(
      `https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${gameId}.json`,
    );
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
    const res = await fetch(
      "https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json",
    );
    if (!res.ok) return [];
    const data = await res.json();
    const games = data.scoreboard?.games ?? [];
    return games
      .filter((g: any) => g.gameStatus === 3)
      .map((g: any) => g.gameId);
  } catch {
    return [];
  }
}

// ── Main Audit Function ──
export async function auditCompletedGames(brain: NbaPropBrainState): Promise<{
  updatedBrain: NbaPropBrainState;
  graded: number;
  hits: number;
  misses: number;
}> {
  if (!supabase) return { updatedBrain: brain, graded: 0, hits: 0, misses: 0 };

  // 1. Find pending predictions
  // ET, not UTC. toISOString() rolls to the next day at 00:00 UTC — 8pm ET —
  // so between 8pm and midnight ET this asked for TOMORROW's date and matched
  // nothing, meaning the evening slate (most of the NBA schedule) never
  // graded on the same night it was played.
  const today = etDateString();
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
  let totalGraded = 0,
    totalHits = 0,
    totalMisses = 0;
  // Ids already settled during THIS invocation — see the filter note below.
  const gradedThisRun = new Set<string>();

  // 3. For each finished game, fetch box score and grade predictions
  for (const gameId of finishedGameIds.slice(0, 5)) {
    const boxScore = await fetchCDNBoxScore(gameId);
    if (!boxScore || boxScore.length === 0) continue;

    // Find predictions that match this game (fuzzy match on team names in game_id or date)
    //
    // NOTE this deliberately does NOT filter by gameId — a prediction's
    // game_id doesn't reliably correspond to the CDN's, so every pending row
    // is offered to every box score and matched on the PLAYER instead. The
    // cost is that without the `gradedThisRun` guard below, a player found in
    // box score 1 was graded again against box scores 2-5, calling
    // learnFromPropResult up to 5x for one real outcome and skewing the brain
    // weights accordingly. The DB write is guarded on status="pending" too,
    // but that only stops the duplicate WRITE, not the duplicate learning.
    const gamePredictions = pending.filter((p: any) => {
      // Match by date (all pending for today)
      return (
        p.game_date === today &&
        p.status === "pending" &&
        !gradedThisRun.has(p.id)
      );
    });

    for (const pred of gamePredictions) {
      const statKey = PROP_TO_BOX[pred.prop_type];
      const statKeyAlt = PROP_TO_BOX_ALT[pred.prop_type];
      if (!statKey) continue;

      // Find matching player in box score
      const boxPlayer = boxScore.find((p) =>
        playerMatch(pred.player_name, p.firstName, p.lastName),
      );
      if (!boxPlayer) continue; // player not in this game's box score

      // `?? 0` here would settle a missing stat as a real 0 — e.g. a CDN
      // shape change dropping `reboundsTotal` would post every rebounds-over
      // as a confident LOSS. Missing means ungradeable, so skip the row and
      // leave it pending rather than inventing an outcome.
      const rawValue =
        (boxPlayer as any)[statKey] ?? (boxPlayer as any)[statKeyAlt];
      const actualValue = Number(rawValue);
      if (rawValue == null || !Number.isFinite(actualValue)) continue;
      const hit =
        pred.predicted_side === "over"
          ? actualValue > pred.line
          : actualValue < pred.line;
      const brierScore = Math.pow(pred.predicted_prob - (hit ? 1 : 0), 2);

      // Update prediction row
      await supabase
        .from("prop_predictions")
        .update({
          actual_value: actualValue,
          hit,
          brier_score: Math.round(brierScore * 10000) / 10000,
          status: "graded",
          graded_at: new Date().toISOString(),
        })
        .eq("id", pred.id)
        // Only settle a row that is still pending — without this a retry or
        // an overlapping cron run re-writes a settled outcome and re-feeds the
        // brain from the same game twice.
        .eq("status", "pending");

      gradedThisRun.add(pred.id);
      pred.status = "graded"; // keep the in-memory copy consistent too

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
      if (hit) totalHits++;
      else totalMisses++;
    }

    // Small delay between games
    await new Promise((r) => setTimeout(r, 200));
  }

  // Record audit result
  if (totalGraded > 0) {
    updatedBrain.recentAudits = [
      ...updatedBrain.recentAudits,
      {
        gameId: finishedGameIds.join(","),
        gameDate: today,
        graded: totalGraded,
        hits: totalHits,
        misses: totalMisses,
        avgBrier: Math.round((totalMisses / totalGraded) * 100) / 100,
        timestamp: new Date().toISOString(),
      },
    ].slice(-20);
    updatedBrain.lastAuditAt = new Date().toISOString();
  }

  return {
    updatedBrain,
    graded: totalGraded,
    hits: totalHits,
    misses: totalMisses,
  };
}
