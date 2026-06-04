// ──────────────────────────────────────────────────────────
// NRFI / YRFI PIPELINE — commit + grade first-inning picks
//
// Daily flow:
//  1. Cron pulls today's MLB scores
//  2. analyzeNRFI returns grades A-F + probabilities
//  3. Commit grade A/B NRFI + YRFI picks to prop_predictions
//     (sport="mlb", prop_type="nrfi" or "yrfi")
//  4. After games complete, fetch linescore → check 1st inning runs
//  5. Grade pick → push to prop_pick_history_mlb
// ──────────────────────────────────────────────────────────

import { supabase } from "@/lib/supabase/client";
import { analyzeNRFI } from "./nrfi-engine";

export async function commitNRFIProjections(
  scores: any[],
  gameDate: string,
): Promise<{ committed: number; skipped: number }> {
  if (!supabase) return { committed: 0, skipped: 0 };

  const games = await analyzeNRFI(scores);
  const candidates = games.filter(
    (g) =>
      g.status === "pre" &&
      g.recommendation !== "SKIP" &&
      (g.nrfiGrade === "A" || g.nrfiGrade === "B"),
  );
  if (candidates.length === 0) return { committed: 0, skipped: 0 };

  // De-dup against existing rows for the same date
  const { data: existing } = await supabase
    .from("prop_predictions")
    .select("game_id, prop_type")
    .eq("sport", "mlb")
    .eq("game_date", gameDate)
    .in("prop_type", ["nrfi", "yrfi"]);
  const seen = new Set((existing ?? []).map((r: any) => `${r.game_id}::${r.prop_type}`));

  const rows: any[] = [];
  let skipped = 0;
  for (const g of candidates) {
    const isNRFI = g.recommendation.includes("NRFI");
    const propType = isNRFI ? "nrfi" : "yrfi";
    const key = `${g.gameId}::${propType}`;
    if (seen.has(key)) { skipped++; continue; }

    const predProb = (isNRFI ? g.nrfiProb : g.yrfiProb) / 100;
    // Standard NRFI/YRFI odds: NRFI typically -115, YRFI -105
    const odds = isNRFI ? -115 : -105;
    const impliedProb = Math.abs(odds) / (Math.abs(odds) + 100);
    const evEdge = ((predProb - impliedProb) / Math.max(impliedProb, 0.01)) * 100;

    rows.push({
      sport: "mlb",
      game_id: g.gameId,
      game_date: gameDate,
      player_name: `${g.awayAbbrev}/${g.homeAbbrev}`, // matchup as "player"
      player_id: null,
      team: `${g.awayAbbrev}@${g.homeAbbrev}`,
      prop_type: propType,
      line: 0.5, // 0 runs over/under
      predicted_side: isNRFI ? "under" : "over",
      predicted_prob: Math.round(predProb * 1000) / 1000,
      odds_at_pick: odds,
      ev_edge: Math.round(evEdge * 100) / 100,
      status: "pending",
      brain_version: "nrfi-v1",
      factors: [
        { name: "grade", value: g.nrfiGrade },
        { name: "dangerLevel", value: g.dangerLevel },
        { name: "awayPitcherERA", value: g.awayPitcher.era },
        { name: "homePitcherERA", value: g.homePitcher.era },
        ...g.factors.slice(0, 3).map((f) => ({ name: "factor", value: f })),
      ],
    });
  }

  if (rows.length > 0) {
    await supabase.from("prop_predictions").insert(rows);
  }
  return { committed: rows.length, skipped };
}

// Grade pending NRFI/YRFI predictions against MLB box-score linescore.
// Returns count graded + newly graded rows for history append.
export async function gradeNRFIPredictions(
  completedGames: Array<{ id: string }>,
): Promise<{ graded: number; newlyGraded: any[] }> {
  if (!supabase) return { graded: 0, newlyGraded: [] };
  if (completedGames.length === 0) return { graded: 0, newlyGraded: [] };

  // Pull all pending NRFI/YRFI rows that match completed game IDs
  const gameIds = completedGames.map((g) => String(g.id));
  const { data: pending } = await supabase
    .from("prop_predictions")
    .select("*")
    .eq("sport", "mlb")
    .eq("status", "pending")
    .in("prop_type", ["nrfi", "yrfi"])
    .in("game_id", gameIds);

  if (!pending || pending.length === 0) return { graded: 0, newlyGraded: [] };

  const newlyGraded: any[] = [];
  let graded = 0;

  for (const pred of pending) {
    try {
      const bxRes = await fetch(
        `https://statsapi.mlb.com/api/v1/game/${pred.game_id}/linescore`,
        { next: { revalidate: 300 } },
      );
      if (!bxRes.ok) continue;
      const ls = await bxRes.json();
      const innings = ls.innings ?? [];
      if (innings.length === 0) continue;
      const first = innings[0] ?? {};
      const homeRuns = Number(first.home?.runs ?? 0);
      const awayRuns = Number(first.away?.runs ?? 0);
      const totalRuns = homeRuns + awayRuns;
      const isNRFIPick = pred.prop_type === "nrfi";
      // NRFI wins when total = 0; YRFI wins when total >= 1
      const hit = isNRFIPick ? totalRuns === 0 : totalRuns >= 1;
      const brierScore = Math.pow((pred.predicted_prob ?? 0.5) - (hit ? 1 : 0), 2);

      await supabase
        .from("prop_predictions")
        .update({
          actual_value: totalRuns,
          hit,
          brier_score: Math.round(brierScore * 10000) / 10000,
          status: "graded",
          graded_at: new Date().toISOString(),
        })
        .eq("id", pred.id);

      newlyGraded.push({
        playerName: pred.player_name,
        propType: isNRFIPick ? "NRFI" : "YRFI",
        market: pred.prop_type,
        line: pred.line,
        side: pred.predicted_side,
        result: hit ? "win" : "loss",
        actualValue: totalRuns,
        date: pred.game_date,
        odds: pred.odds_at_pick,
        sport: "mlb",
      });
      graded++;
    } catch {}
  }

  return { graded, newlyGraded };
}
