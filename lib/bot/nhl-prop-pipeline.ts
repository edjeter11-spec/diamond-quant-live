// ──────────────────────────────────────────────────────────
// NHL PROP PIPELINE — commit + grade NHL player props.
// ──────────────────────────────────────────────────────────

import { supabase } from "@/lib/supabase/client";
import { getNHLStarsForTeams } from "@/lib/nhl/star-fallback";
import { loadNHLPropBrainFromCloud } from "./nhl-prop-brain";
import { projectNHLProp } from "./nhl-prop-projector";
import { computeNHLFatigue } from "@/lib/nhl/rest-fatigue";
import { fetchNHLInjuries, getNHLTeamInjuries } from "@/lib/nhl/injuries";
import { getNHLTeamRating } from "@/lib/nhl/team-ratings";
import { fetchNHLBoxScore } from "@/lib/nhl/stats-api";
import { NHL_STAR_FALLBACK } from "@/lib/nhl/star-fallback";

const NHL_MARKETS = [
  "player_points",
  "player_goals",
  "player_assists",
  "player_shots_on_goal",
  "player_total_saves",
] as const;

interface NHLGameForCommit {
  gameId: string;
  homeAbbrev: string;
  awayAbbrev: string;
  gameDate: string;
}

export async function commitNHLPropProjections(
  games: NHLGameForCommit[],
  gameDate: string,
): Promise<{ committed: number; skipped: number }> {
  if (!supabase) return { committed: 0, skipped: 0 };
  if (games.length === 0) return { committed: 0, skipped: 0 };

  const brain = await loadNHLPropBrainFromCloud();
  const teamsPlaying = new Set<string>();
  for (const g of games) {
    teamsPlaying.add(g.homeAbbrev);
    teamsPlaying.add(g.awayAbbrev);
  }
  const stars = getNHLStarsForTeams(teamsPlaying);
  if (stars.length === 0) return { committed: 0, skipped: 0 };

  const injuryReports = await fetchNHLInjuries().catch(() => []);
  const outNames = new Set<string>();
  for (const t of injuryReports) for (const p of t.players) {
    const s = p.status.toLowerCase();
    if (s.includes("out") || s.includes("ltir") || s.includes("ir")) outNames.add(p.name.toLowerCase());
  }

  const { data: existing } = await supabase
    .from("prop_predictions")
    .select("player_name, prop_type")
    .eq("sport", "nhl")
    .eq("game_date", gameDate);
  const seen = new Set((existing ?? []).map((r: any) => `${r.player_name}::${r.prop_type}`));

  const rows: any[] = [];
  let skipped = 0;

  // Build a map: team → starting goalie SV% (rough — use top goalie listed)
  const teamGoaliePct = new Map<string, number>();
  for (const g of NHL_STAR_FALLBACK.filter(p => p.position === "G")) {
    if (!teamGoaliePct.has(g.team)) teamGoaliePct.set(g.team, g.savePct ?? 0.910);
  }

  for (const star of stars) {
    if (outNames.has(star.playerName.toLowerCase())) { skipped++; continue; }

    const game = games.find((g) => g.homeAbbrev === star.team || g.awayAbbrev === star.team);
    if (!game) continue;
    const isHome = game.homeAbbrev === star.team;
    const oppAbbrev = isHome ? game.awayAbbrev : game.homeAbbrev;

    const fatigue = computeNHLFatigue(star.team, null, null, gameDate, 1);

    const ownInjuries = await getNHLTeamInjuries(star.team);
    const keyOuts = ownInjuries.filter((p) => p.status.toLowerCase().includes("out")).length;
    const injuryFactor = Math.max(0.7, 1 - keyOuts * 0.04);

    const ownRating = getNHLTeamRating(star.team);
    const oppRating = getNHLTeamRating(oppAbbrev);
    const oppGoalieSavePct = teamGoaliePct.get(oppAbbrev) ?? 0.910;

    for (const market of NHL_MARKETS) {
      // Skip goalie markets for non-goalies, skip non-goalie markets for goalies
      if (market === "player_total_saves" && star.position !== "G") continue;
      if (market !== "player_total_saves" && star.position === "G") continue;

      const key = `${star.playerName}::${market}`;
      if (seen.has(key)) { skipped++; continue; }

      let baseline = 0;
      switch (market) {
        case "player_points": baseline = star.pointsPerGame ?? 0; break;
        case "player_goals": baseline = star.goalsPerGame ?? 0; break;
        case "player_assists": baseline = star.assistsPerGame ?? 0; break;
        case "player_shots_on_goal": baseline = star.shotsPerGame ?? 0; break;
        case "player_total_saves": baseline = star.savesPerGame ?? 0; break;
      }
      if (baseline <= 0) continue;

      // Synthetic line — round to .5
      const line = Math.max(0.5, Math.round(baseline * 2) / 2 - 0.5);

      const proj = projectNHLProp(
        star,
        market,
        line,
        brain.weights,
        {
          oppAbbrev,
          isHome,
          fatigue,
          injuryFactor,
          oppGoalieSavePct,
          oppPK: oppRating.pkPct,
          ownPP: ownRating.ppPct,
        },
      );
      if (!proj) { skipped++; continue; }
      if (proj.confidence < 22) { skipped++; continue; }
      if (Math.abs(proj.probability - 0.5) < 0.07) { skipped++; continue; }

      const odds = -110;
      const impliedProb = Math.abs(odds) / (Math.abs(odds) + 100);
      const evEdge = ((proj.probability - impliedProb) / Math.max(impliedProb, 0.01)) * 100;
      if (evEdge < 2) { skipped++; continue; }

      rows.push({
        sport: "nhl",
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
        brain_version: "nhl-v1",
        factors: proj.factors.slice(0, 5).map((f) => ({ name: f.name, value: Math.round(f.contribution * 100) / 100, explanation: f.explanation })),
      });
    }
  }

  if (rows.length > 0) await supabase.from("prop_predictions").insert(rows);
  return { committed: rows.length, skipped };
}

const MARKET_TO_STAT_KEY: Record<string, string> = {
  player_points: "points",
  player_goals: "goals",
  player_assists: "assists",
  player_shots_on_goal: "shots",
  player_total_saves: "saves",
};

export async function gradeNHLPropPredictions(
  completedGames: Array<{ id: string }>,
): Promise<{ graded: number; newlyGraded: any[] }> {
  if (!supabase) return { graded: 0, newlyGraded: [] };
  if (completedGames.length === 0) return { graded: 0, newlyGraded: [] };

  const gameIds = completedGames.map((g) => String(g.id));
  const { data: pending } = await supabase
    .from("prop_predictions")
    .select("*")
    .eq("sport", "nhl")
    .eq("status", "pending")
    .in("game_id", gameIds)
    .limit(500);

  if (!pending || pending.length === 0) return { graded: 0, newlyGraded: [] };

  const newlyGraded: any[] = [];
  let graded = 0;

  const byGame = new Map<string, any[]>();
  for (const p of pending) {
    const list = byGame.get(p.game_id) ?? [];
    list.push(p);
    byGame.set(p.game_id, list);
  }

  for (const [gameId, preds] of byGame.entries()) {
    try {
      const box = await fetchNHLBoxScore(gameId);
      if (box.length === 0) continue;

      for (const pred of preds) {
        const statKey = MARKET_TO_STAT_KEY[pred.prop_type];
        if (!statKey) continue;
        const lower = pred.player_name.toLowerCase();
        const lastName = lower.split(" ").slice(-1)[0];
        const player = box.find((b) => b.playerName.toLowerCase() === lower || b.playerName.toLowerCase().includes(lastName));
        if (!player) continue;
        const actual = Number((player.stats as any)[statKey] ?? 0);

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
          sport: "nhl",
        });
        graded++;
      }
    } catch {}
  }

  return { graded, newlyGraded };
}
