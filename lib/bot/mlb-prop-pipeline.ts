// ──────────────────────────────────────────────────────────
// MLB PROP PIPELINE — commit, grade, and persist MLB prop picks
//
// Daily flow:
//  1. Cron pulls /api/players?sport=baseball_mlb&market=X for each market
//  2. For each prop with a sharp seasonAvg edge → predict OVER/UNDER
//  3. Commit to prop_predictions table with sport="mlb"
//  4. After games end, fetch box scores, grade via gradeMLBPropPick
//  5. Append graded picks to prop_pick_history_mlb (cumulative)
// ──────────────────────────────────────────────────────────

import { supabase } from "@/lib/supabase/client";

export const MLB_MARKETS = [
  "pitcher_strikeouts",
  "batter_hits",
  "batter_total_bases",
  "batter_home_runs",
  "batter_rbis",
  "batter_runs_scored",
  "pitcher_outs",
] as const;

export interface MLBPropToCommit {
  playerName: string;
  team: string;
  gameId: string;
  market: string;
  line: number;
  bestOverOdds: number;
  bestUnderOdds: number;
}

// Simple projector — uses player's recent average from MLB Stats API if available,
// falls back to neutral 50/50 (skipped). The projection picks a side only when
// the line deviates from a baseline estimate enough to suggest edge.
async function fetchPlayerSeasonAvg(playerName: string, market: string): Promise<number | null> {
  try {
    const search = await fetch(
      `https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(playerName)}`,
      { next: { revalidate: 86400 } },
    );
    if (!search.ok) return null;
    const data = await search.json();
    const person = data.people?.[0];
    if (!person?.id) return null;
    const year = new Date().getFullYear();
    const group = market.startsWith("pitcher_") ? "pitching" : "hitting";
    const statRes = await fetch(
      `https://statsapi.mlb.com/api/v1/people/${person.id}/stats?stats=season&group=${group}&season=${year}`,
      { next: { revalidate: 3600 } },
    );
    if (!statRes.ok) return null;
    const statData = await statRes.json();
    const stat = statData.stats?.[0]?.splits?.[0]?.stat;
    if (!stat) return null;
    const games = Number(stat.gamesPlayed ?? stat.gamesStarted ?? 0);
    if (games <= 0) return null;
    switch (market) {
      case "batter_hits": return Number(stat.hits ?? 0) / games;
      case "batter_total_bases": return Number(stat.totalBases ?? 0) / games;
      case "batter_home_runs": return Number(stat.homeRuns ?? 0) / games;
      case "batter_rbis": return Number(stat.rbi ?? 0) / games;
      case "batter_runs_scored": return Number(stat.runs ?? 0) / games;
      case "pitcher_strikeouts": return Number(stat.strikeOuts ?? 0) / games;
      case "pitcher_outs": {
        const ipStr = String(stat.inningsPitched ?? "0");
        const [whole, frac] = ipStr.split(".").map(Number);
        const outs = (Number(whole) || 0) * 3 + (Number(frac) || 0);
        return outs / games;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// Decides if line creates an edge worth predicting; returns null if no edge.
export async function projectMLBProp(prop: MLBPropToCommit): Promise<{
  predicted_side: "over" | "under";
  predicted_prob: number;
  ev_edge: number;
  seasonAvg: number;
} | null> {
  const avg = await fetchPlayerSeasonAvg(prop.playerName, prop.market);
  if (avg === null || avg <= 0) return null;

  // Calculate edge: how far the line is from the season average, normalized.
  const delta = (avg - prop.line) / Math.max(prop.line, 0.5);
  // Only commit if there's >12% deviation — otherwise too noisy.
  if (Math.abs(delta) < 0.12) return null;

  const side: "over" | "under" = delta > 0 ? "over" : "under";
  // Crude probability mapping — saturates at ~70%
  const prob = 0.5 + Math.min(0.2, Math.abs(delta) * 0.5);
  // EV vs -110: payout = 0.909 on win, -1 on loss, breakeven 52.4%
  const odds = side === "over" ? prop.bestOverOdds : prop.bestUnderOdds;
  const impliedProb = odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
  const evEdge = (prob - impliedProb) / Math.max(impliedProb, 0.01) * 100;

  return {
    predicted_side: side,
    predicted_prob: Math.round(prob * 1000) / 1000,
    ev_edge: Math.round(evEdge * 100) / 100,
    seasonAvg: Math.round(avg * 100) / 100,
  };
}

// Commit MLB prop projections to prop_predictions. Idempotent — skips
// existing predictions for the same player/market/date.
export async function commitMLBPropProjections(
  props: MLBPropToCommit[],
  gameDate: string,
): Promise<{ committed: number; skipped: number }> {
  if (!supabase) return { committed: 0, skipped: 0 };
  if (props.length === 0) return { committed: 0, skipped: 0 };

  // De-dup against today's existing rows
  const { data: existing } = await supabase
    .from("prop_predictions")
    .select("player_name, prop_type")
    .eq("game_date", gameDate)
    .eq("sport", "mlb");
  const seen = new Set((existing ?? []).map((r: any) => `${r.player_name}::${r.prop_type}`));

  const rows: any[] = [];
  let skipped = 0;
  // Limit how many we project per run — MLB stats API calls are 1/player
  for (const prop of props.slice(0, 60)) {
    const key = `${prop.playerName}::${prop.market}`;
    if (seen.has(key)) { skipped++; continue; }
    const proj = await projectMLBProp(prop);
    if (!proj) { skipped++; continue; }
    rows.push({
      sport: "mlb",
      game_id: prop.gameId,
      game_date: gameDate,
      player_name: prop.playerName,
      player_id: null,
      team: prop.team,
      prop_type: prop.market,
      line: prop.line,
      predicted_side: proj.predicted_side,
      predicted_prob: proj.predicted_prob,
      odds_at_pick: proj.predicted_side === "over" ? prop.bestOverOdds : prop.bestUnderOdds,
      ev_edge: proj.ev_edge,
      status: "pending",
      brain_version: "mlb-naive-v1",
      factors: [{ name: "seasonAverage", value: proj.seasonAvg, line: prop.line }],
    });
  }

  if (rows.length > 0) {
    await supabase.from("prop_predictions").insert(rows);
  }
  return { committed: rows.length, skipped };
}
