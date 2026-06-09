// ──────────────────────────────────────────────────────────
// NFL PROP PIPELINE — commit + grade NFL prop predictions.
// Daily flow:
//  1. Cron pulls today's NFL games + weather + injuries
//  2. For each game's star players, project each prop market
//  3. Commit predictions where line deviation suggests edge
//  4. After games end, fetch box scores, grade via prop-grader
//  5. Append to prop_pick_history_nfl
// ──────────────────────────────────────────────────────────

import { supabase } from "@/lib/supabase/client";
import { NFL_STAR_FALLBACK, getStarsForTeams } from "@/lib/nfl/star-fallback";
import { loadNFLPropBrainFromCloud } from "./nfl-prop-brain";
import { projectNFLProp } from "./nfl-prop-projector";
import { getNFLGameWeather } from "@/lib/nfl/weather";
import { computeNFLRest } from "@/lib/nfl/rest-days";
import { fetchNFLInjuries, nflInjuryImpact, getNFLTeamInjuries } from "@/lib/nfl/injuries";
import { getNFLTeamRating } from "@/lib/nfl/team-ratings";
import { getNFLTeamAbbrev } from "@/lib/nfl/teams";
import { fetchNFLBoxScore, getNFLGameStatus } from "@/lib/nfl/stats-api";

// Markets we commit projections for
const NFL_MARKETS = [
  "player_pass_yds",
  "player_pass_tds",
  "player_pass_attempts",
  "player_rush_yds",
  "player_rush_attempts",
  "player_receptions",
  "player_reception_yds",
] as const;

interface NFLGameForCommit {
  gameId: string;
  homeAbbrev: string;
  awayAbbrev: string;
  gameDate: string;
}

export async function commitNFLPropProjections(
  games: NFLGameForCommit[],
  gameDate: string,
): Promise<{ committed: number; skipped: number }> {
  if (!supabase) return { committed: 0, skipped: 0 };
  if (games.length === 0) return { committed: 0, skipped: 0 };

  const brain = await loadNFLPropBrainFromCloud();
  const teamsPlaying = new Set<string>();
  for (const g of games) {
    teamsPlaying.add(g.homeAbbrev);
    teamsPlaying.add(g.awayAbbrev);
  }
  const stars = getStarsForTeams(teamsPlaying);
  if (stars.length === 0) return { committed: 0, skipped: 0 };

  // Pre-fetch injuries once
  const injuryReports = await fetchNFLInjuries().catch(() => []);
  const outNames = new Set<string>();
  for (const t of injuryReports) for (const p of t.players) {
    if (p.status.toLowerCase().includes("out") || p.status.toLowerCase().includes("ir")) {
      outNames.add(p.name.toLowerCase());
    }
  }

  // De-dup against existing rows
  const { data: existing } = await supabase
    .from("prop_predictions")
    .select("player_name, prop_type")
    .eq("sport", "nfl")
    .eq("game_date", gameDate);
  const seen = new Set((existing ?? []).map((r: any) => `${r.player_name}::${r.prop_type}`));

  const rows: any[] = [];
  let skipped = 0;

  for (const star of stars) {
    if (outNames.has(star.playerName.toLowerCase())) { skipped++; continue; }

    // Find which game this star is in
    const game = games.find((g) => g.homeAbbrev === star.team || g.awayAbbrev === star.team);
    if (!game) continue;
    const isHome = game.homeAbbrev === star.team;
    const oppAbbrev = isHome ? game.awayAbbrev : game.homeAbbrev;

    // Weather (only home stadium matters)
    const weather = await getNFLGameWeather(game.homeAbbrev);

    // Rest (estimate from week — punt to 7 days for v1)
    const rest = computeNFLRest(null, gameDate);

    // Own team's injury factor
    const ownInjuries = await getNFLTeamInjuries(star.team);
    const keyOuts = ownInjuries.filter((p) => p.status.toLowerCase().includes("out") && ["QB","WR","RB","TE","LT","LG","C","RG","RT"].includes(p.position)).length;
    const injuryFactor = Math.max(0.7, 1 - keyOuts * 0.05);

    // Pace
    const pace = getNFLTeamRating(star.team).paceSec;

    for (const market of NFL_MARKETS) {
      const key = `${star.playerName}::${market}`;
      if (seen.has(key)) { skipped++; continue; }

      // Use a synthetic line based on seasonal average (since no Odds API)
      // — round to nearest half + slight book vig direction
      let baseline = 0;
      switch (market) {
        case "player_pass_yds": baseline = star.passYds ?? 0; break;
        case "player_pass_tds": baseline = star.passTds ?? 0; break;
        case "player_pass_attempts": baseline = star.passAttempts ?? 0; break;
        case "player_rush_yds": baseline = star.rushYds ?? 0; break;
        case "player_rush_attempts": baseline = star.rushAttempts ?? 0; break;
        case "player_receptions": baseline = star.receptions ?? 0; break;
        case "player_reception_yds": baseline = star.receivingYds ?? 0; break;
      }
      if (baseline <= 0) continue;

      // Synthetic line = baseline rounded down to .5
      const line = Math.max(0.5, Math.round(baseline * 2) / 2 - 0.5);

      const proj = projectNFLProp(
        star,
        market,
        line,
        brain.weights,
        { oppAbbrev, isHome, weather, rest, injuryFactor, pace },
      );
      if (!proj) { skipped++; continue; }

      // Skip neutral picks — only commit when signal is strong
      if (proj.confidence < 25) { skipped++; continue; }
      if (Math.abs(proj.probability - 0.5) < 0.08) { skipped++; continue; }

      // Standard prop odds -110
      const odds = -110;
      const impliedProb = Math.abs(odds) / (Math.abs(odds) + 100);
      const evEdge = ((proj.probability - impliedProb) / Math.max(impliedProb, 0.01)) * 100;

      // Only commit positive-EV
      if (evEdge < 2) { skipped++; continue; }

      rows.push({
        sport: "nfl",
        game_id: game.gameId,
        game_date: gameDate,
        player_name: star.playerName,
        player_id: null,
        team: star.team,
        prop_type: market,
        line,
        predicted_side: proj.side,
        predicted_prob: proj.probability,
        odds_at_pick: odds,
        ev_edge: Math.round(evEdge * 100) / 100,
        status: "pending",
        brain_version: "nfl-v1",
        factors: proj.factors.slice(0, 5).map((f) => ({ name: f.name, value: Math.round(f.contribution * 100) / 100, explanation: f.explanation })),
      });
    }
  }

  if (rows.length > 0) await supabase.from("prop_predictions").insert(rows);
  return { committed: rows.length, skipped };
}

// Grade pending NFL props against ESPN box scores
const MARKET_TO_STAT: Record<string, keyof Awaited<ReturnType<typeof fetchNFLBoxScore>>[0]["stats"]> = {
  player_pass_yds: "passYds",
  player_pass_tds: "passTds",
  player_pass_attempts: "passAttempts",
  player_rush_yds: "rushYds",
  player_rush_attempts: "rushAttempts",
  player_receptions: "receptions",
  player_reception_yds: "receivingYds",
};

export async function gradeNFLPropPredictions(
  completedGames: Array<{ id: string }>,
): Promise<{ graded: number; newlyGraded: any[] }> {
  if (!supabase) return { graded: 0, newlyGraded: [] };
  if (completedGames.length === 0) return { graded: 0, newlyGraded: [] };

  const gameIds = completedGames.map((g) => String(g.id));
  const { data: pending } = await supabase
    .from("prop_predictions")
    .select("*")
    .eq("sport", "nfl")
    .eq("status", "pending")
    .in("game_id", gameIds)
    .limit(500);

  if (!pending || pending.length === 0) return { graded: 0, newlyGraded: [] };

  const newlyGraded: any[] = [];
  let graded = 0;

  // Group by game so we only fetch each box once
  const byGame = new Map<string, any[]>();
  for (const p of pending) {
    const list = byGame.get(p.game_id) ?? [];
    list.push(p);
    byGame.set(p.game_id, list);
  }

  for (const [gameId, preds] of byGame.entries()) {
    try {
      const box = await fetchNFLBoxScore(gameId);
      if (box.length === 0) continue;

      for (const pred of preds) {
        const statKey = MARKET_TO_STAT[pred.prop_type];
        if (!statKey) continue;
        const lower = pred.player_name.toLowerCase();
        const lastName = lower.split(" ").slice(-1)[0];
        const player = box.find((b) => b.playerName.toLowerCase() === lower || b.playerName.toLowerCase().includes(lastName));
        if (!player) continue;
        const actual = Number((player.stats as any)[statKey] ?? 0);
        // Push: exact line tie counts as push
        if (actual === pred.line) {
          await supabase.from("prop_predictions").update({
            actual_value: actual, hit: null, status: "graded", graded_at: new Date().toISOString(),
          }).eq("id", pred.id);
          continue;
        }
        const hit = pred.predicted_side === "over" ? actual > pred.line : actual < pred.line;
        const brierScore = Math.pow((pred.predicted_prob ?? 0.5) - (hit ? 1 : 0), 2);

        await supabase.from("prop_predictions").update({
          actual_value: actual,
          hit,
          brier_score: Math.round(brierScore * 10000) / 10000,
          status: "graded",
          graded_at: new Date().toISOString(),
        }).eq("id", pred.id);

        newlyGraded.push({
          playerName: pred.player_name,
          propType: pred.prop_type,
          market: pred.prop_type,
          line: pred.line,
          side: pred.predicted_side,
          result: hit ? "win" : "loss",
          actualValue: actual,
          date: pred.game_date,
          odds: pred.odds_at_pick,
          sport: "nfl",
        });
        graded++;
      }
    } catch {}
  }

  return { graded, newlyGraded };
}
