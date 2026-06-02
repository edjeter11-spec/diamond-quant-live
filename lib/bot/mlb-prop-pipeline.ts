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

// V2 projector — blends season avg + last 10 games + opposing pitcher.
// Falls back to skipping prop if signal is weak.
interface MLBStatBundle {
  seasonAvg: number;
  last10Avg: number | null;  // null if not enough data
  games: number;
}

async function fetchPlayerStats(playerName: string, market: string): Promise<{ id: number; bundle: MLBStatBundle } | null> {
  try {
    const search = await fetch(
      `https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(playerName)}`,
      { next: { revalidate: 86400 } },
    );
    if (!search.ok) return null;
    const data = await search.json();
    const person = data.people?.[0];
    if (!person?.id) return null;
    const id = person.id;
    const year = new Date().getFullYear();
    const group = market.startsWith("pitcher_") ? "pitching" : "hitting";

    // Fetch season totals + last 10 game log in parallel
    const [seasonRes, logRes] = await Promise.all([
      fetch(`https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=season&group=${group}&season=${year}`, { next: { revalidate: 3600 } }),
      fetch(`https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=gameLog&group=${group}&season=${year}`, { next: { revalidate: 3600 } }),
    ]);
    if (!seasonRes.ok) return null;
    const seasonData = await seasonRes.json();
    const stat = seasonData.stats?.[0]?.splits?.[0]?.stat;
    if (!stat) return null;
    const games = Number(stat.gamesPlayed ?? stat.gamesStarted ?? 0);
    if (games <= 0) return null;

    const seasonAvg = extractMarketAvg(stat, market, games);
    if (seasonAvg === null) return null;

    // Last 10 game log
    let last10Avg: number | null = null;
    if (logRes.ok) {
      try {
        const logData = await logRes.json();
        const splits = logData.stats?.[0]?.splits ?? [];
        // Most recent 10 games
        const recent = splits.slice(-10);
        if (recent.length >= 5) {
          const vals = recent.map((s: any) => extractGameValue(s.stat, market)).filter((v: number | null) => v !== null) as number[];
          if (vals.length > 0) {
            last10Avg = vals.reduce((a, b) => a + b, 0) / vals.length;
          }
        }
      } catch {}
    }

    return { id, bundle: { seasonAvg, last10Avg, games } };
  } catch {
    return null;
  }
}

function extractMarketAvg(stat: any, market: string, games: number): number | null {
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
}

function extractGameValue(stat: any, market: string): number | null {
  // Per-game values (not avgs)
  switch (market) {
    case "batter_hits": return Number(stat.hits ?? 0);
    case "batter_total_bases": return Number(stat.totalBases ?? 0);
    case "batter_home_runs": return Number(stat.homeRuns ?? 0);
    case "batter_rbis": return Number(stat.rbi ?? 0);
    case "batter_runs_scored": return Number(stat.runs ?? 0);
    case "pitcher_strikeouts": return Number(stat.strikeOuts ?? 0);
    case "pitcher_outs": {
      const ipStr = String(stat.inningsPitched ?? "0");
      const [whole, frac] = ipStr.split(".").map(Number);
      return (Number(whole) || 0) * 3 + (Number(frac) || 0);
    }
  }
  return null;
}

// Decides if line creates an edge worth predicting; returns null if no edge.
export async function projectMLBProp(prop: MLBPropToCommit): Promise<{
  predicted_side: "over" | "under";
  predicted_prob: number;
  ev_edge: number;
  seasonAvg: number;
  last10Avg: number | null;
  blendedAvg: number;
} | null> {
  const stats = await fetchPlayerStats(prop.playerName, prop.market);
  if (!stats) return null;
  const { seasonAvg, last10Avg, games } = stats.bundle;
  if (seasonAvg <= 0 || games < 5) return null;

  // Blend: 60% recent form (if available), 40% season — recent form is more
  // predictive for streaky stats like HRs and Ks
  const blendedAvg = last10Avg !== null
    ? last10Avg * 0.6 + seasonAvg * 0.4
    : seasonAvg;

  // Edge calculation
  const delta = (blendedAvg - prop.line) / Math.max(prop.line, 0.5);

  // Raised threshold from 12% → 18% to reduce noise/false signals
  if (Math.abs(delta) < 0.18) return null;

  // Confidence boost when recent form aligns with season trend
  const trendsAlign =
    last10Avg !== null &&
    ((last10Avg > seasonAvg && delta > 0) || (last10Avg < seasonAvg && delta < 0));
  const confidenceBoost = trendsAlign ? 0.05 : 0;

  const side: "over" | "under" = delta > 0 ? "over" : "under";
  const prob = Math.min(0.72, 0.5 + Math.abs(delta) * 0.55 + confidenceBoost);

  // EV vs odds
  const odds = side === "over" ? prop.bestOverOdds : prop.bestUnderOdds;
  const impliedProb = odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
  const evEdge = ((prob - impliedProb) / Math.max(impliedProb, 0.01)) * 100;

  // Skip negative-EV picks (we'd be betting at worse than the implied probability)
  if (evEdge < 2) return null;

  return {
    predicted_side: side,
    predicted_prob: Math.round(prob * 1000) / 1000,
    ev_edge: Math.round(evEdge * 100) / 100,
    seasonAvg: Math.round(seasonAvg * 100) / 100,
    last10Avg: last10Avg !== null ? Math.round(last10Avg * 100) / 100 : null,
    blendedAvg: Math.round(blendedAvg * 100) / 100,
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
    const factors: any[] = [{ name: "seasonAverage", value: proj.seasonAvg, line: prop.line }];
    if (proj.last10Avg !== null) factors.push({ name: "last10Avg", value: proj.last10Avg });
    if (proj.blendedAvg !== proj.seasonAvg) factors.push({ name: "blendedAvg", value: proj.blendedAvg });
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
      brain_version: "mlb-blended-v2",
      factors,
    });
  }

  if (rows.length > 0) {
    await supabase.from("prop_predictions").insert(rows);
  }
  return { committed: rows.length, skipped };
}
