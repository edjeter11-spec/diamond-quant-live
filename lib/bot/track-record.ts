// ──────────────────────────────────────────────────────────
// Track Record — daily pick logging + settlement
// Feeds the public /results page so users can verify hit rate.
// All writes go through supabaseAdmin (service role).
// ──────────────────────────────────────────────────────────

import { supabaseAdmin } from "@/lib/supabase/server-auth";
import { americanToDecimal } from "@/lib/model/kelly";

export type PickCategory = "parlay" | "lock" | "longshot" | "prop";
export type PickResult = "pending" | "win" | "loss" | "push" | "void";

export interface LoggedPick {
  sport: "mlb" | "nba";
  pickDate: string; // YYYY-MM-DD (ET)
  category: PickCategory;
  pickText: string;
  game?: string;
  market?: string;
  odds?: number;
  bookmaker?: string;
  evPercentage?: number;
  fairProb?: number;
  confidence?: string;
}

export function etDateString(d = new Date()): string {
  const et = new Date(d.toLocaleString("en-US", { timeZone: "America/New_York" }));
  return `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, "0")}-${String(et.getDate()).padStart(2, "0")}`;
}

/**
 * Log a batch of today's picks. Deduplicated server-side by
 * (pick_date, sport, category, pick_text) via unique-ish fingerprint.
 */
export async function logDailyPicks(picks: LoggedPick[]): Promise<{ inserted: number }> {
  if (!supabaseAdmin || picks.length === 0) return { inserted: 0 };

  // Fetch today's existing rows to avoid duplicate re-logging across cron runs
  const byDate = new Map<string, Set<string>>();
  for (const p of picks) {
    const key = `${p.pickDate}|${p.sport}`;
    if (!byDate.has(key)) byDate.set(key, new Set());
  }
  for (const [key] of byDate) {
    const [date, sport] = key.split("|");
    const { data } = await supabaseAdmin
      .from("daily_picks_log")
      .select("category,pick_text")
      .eq("pick_date", date)
      .eq("sport", sport);
    const existing = new Set<string>();
    for (const row of data ?? []) existing.add(`${row.category}:${row.pick_text}`);
    byDate.set(key, existing);
  }

  const rows = [];
  for (const p of picks) {
    const seen = byDate.get(`${p.pickDate}|${p.sport}`) ?? new Set();
    if (seen.has(`${p.category}:${p.pickText}`)) continue;
    rows.push({
      sport: p.sport,
      pick_date: p.pickDate,
      category: p.category,
      pick_text: p.pickText,
      game: p.game,
      market: p.market,
      odds: p.odds,
      bookmaker: p.bookmaker,
      ev_percentage: p.evPercentage,
      fair_prob: p.fairProb,
      confidence: p.confidence,
    });
  }
  if (rows.length === 0) return { inserted: 0 };

  const { error } = await supabaseAdmin.from("daily_picks_log").insert(rows);
  if (error) {
    console.error("logDailyPicks error:", error);
    return { inserted: 0 };
  }
  return { inserted: rows.length };
}

/**
 * Grade pending picks whose games have finished.
 * Very simple matcher: compares pick_text against a list of completed-game outcomes.
 * Returns count of rows settled.
 */
export async function settlePendingPicks(completedGames: Array<{
  homeTeam: string; awayTeam: string;
  homeAbbrev?: string; awayAbbrev?: string;
  homeScore: number; awayScore: number;
}>): Promise<{ settled: number }> {
  if (!supabaseAdmin || completedGames.length === 0) return { settled: 0 };

  const { data: pending } = await supabaseAdmin
    .from("daily_picks_log")
    .select("*")
    .eq("result", "pending")
    .limit(500);

  if (!pending || pending.length === 0) return { settled: 0 };

  let settled = 0;
  for (const pick of pending) {
    const match = completedGames.find(g =>
      (pick.game ?? "").includes(g.homeTeam) || (pick.game ?? "").includes(g.awayTeam) ||
      (pick.game ?? "").includes(g.homeAbbrev ?? "__") || (pick.game ?? "").includes(g.awayAbbrev ?? "__") ||
      (pick.pick_text ?? "").includes(g.homeTeam) || (pick.pick_text ?? "").includes(g.awayTeam)
    );
    if (!match) continue;

    const result = gradeMLPick(pick, match);
    if (!result) continue;

    const stake = 1; // 1-unit sizing for track-record clarity
    const profit = result === "win"
      ? stake * (americanToDecimal(pick.odds ?? -110) - 1)
      : result === "push" ? 0
      : -stake;

    await supabaseAdmin.from("daily_picks_log").update({
      result,
      settled_at: new Date().toISOString(),
      profit_units: Math.round(profit * 100) / 100,
    }).eq("id", pick.id);
    settled++;
  }
  return { settled };
}

/**
 * Grade a single ML/total pick against a completed game.
 * Returns null if we can't confidently grade it (e.g., a prop with no score to check).
 */
function gradeMLPick(pick: any, game: { homeTeam: string; awayTeam: string; homeScore: number; awayScore: number }): PickResult | null {
  const text = (pick.pick_text ?? "").toLowerCase();
  const homeWin = game.homeScore > game.awayScore;
  const total = game.homeScore + game.awayScore;

  // Moneyline / spread pick naming: "Yankees ML" or "Yankees -1.5"
  if (text.includes("ml") || pick.market === "moneyline") {
    const homeWon = homeWin;
    const pickedHome = text.includes(game.homeTeam.toLowerCase());
    const pickedAway = text.includes(game.awayTeam.toLowerCase());
    if (!pickedHome && !pickedAway) return null;
    return (pickedHome && homeWon) || (pickedAway && !homeWon) ? "win" : "loss";
  }

  // Over/Under: look for a number after "over" or "under"
  const overMatch = text.match(/over\s+(\d+(\.\d+)?)/);
  const underMatch = text.match(/under\s+(\d+(\.\d+)?)/);
  if (overMatch) {
    const line = parseFloat(overMatch[1]);
    if (total > line) return "win";
    if (total < line) return "loss";
    return "push";
  }
  if (underMatch) {
    const line = parseFloat(underMatch[1]);
    if (total < line) return "win";
    if (total > line) return "loss";
    return "push";
  }

  return null; // unknown pick type — leave pending (e.g., player props)
}

/**
 * Roll-up stats for the /results page.
 */
export async function getTrackRecordStats(days: number = 30): Promise<{
  overall: { total: number; wins: number; losses: number; pushes: number; winRate: number; profitUnits: number };
  byCategory: Record<PickCategory, { total: number; wins: number; losses: number; winRate: number; profitUnits: number }>;
  bySport: Record<"mlb" | "nba", { total: number; wins: number; losses: number; winRate: number; profitUnits: number }>;
  daily: Array<{ date: string; wins: number; losses: number; profitUnits: number }>;
} | null> {
  if (!supabaseAdmin) return null;

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  const sinceDate = since.toISOString().split("T")[0];

  const { data } = await supabaseAdmin
    .from("daily_picks_log")
    .select("*")
    .gte("pick_date", sinceDate)
    .neq("result", "pending")
    .order("pick_date", { ascending: false });

  const rows = data ?? [];

  const bucket = () => ({ total: 0, wins: 0, losses: 0, pushes: 0, winRate: 0, profitUnits: 0 });
  const overall = bucket();
  const byCategory: Record<string, any> = { parlay: bucket(), lock: bucket(), longshot: bucket(), prop: bucket() };
  const bySport: Record<string, any> = { mlb: bucket(), nba: bucket() };
  const dailyMap = new Map<string, { wins: number; losses: number; profitUnits: number }>();

  for (const r of rows) {
    overall.total++;
    if (r.result === "win") overall.wins++;
    else if (r.result === "loss") overall.losses++;
    else if (r.result === "push") overall.pushes++;
    overall.profitUnits += Number(r.profit_units ?? 0);

    const cat = byCategory[r.category] ?? bucket();
    cat.total++;
    if (r.result === "win") cat.wins++;
    else if (r.result === "loss") cat.losses++;
    cat.profitUnits += Number(r.profit_units ?? 0);
    byCategory[r.category] = cat;

    const sport = bySport[r.sport] ?? bucket();
    sport.total++;
    if (r.result === "win") sport.wins++;
    else if (r.result === "loss") sport.losses++;
    sport.profitUnits += Number(r.profit_units ?? 0);
    bySport[r.sport] = sport;

    const d = r.pick_date;
    const day = dailyMap.get(d) ?? { wins: 0, losses: 0, profitUnits: 0 };
    if (r.result === "win") day.wins++;
    else if (r.result === "loss") day.losses++;
    day.profitUnits += Number(r.profit_units ?? 0);
    dailyMap.set(d, day);
  }

  const finalize = (b: any) => {
    const decided = b.wins + b.losses;
    b.winRate = decided > 0 ? (b.wins / decided) * 100 : 0;
    b.profitUnits = Math.round(b.profitUnits * 100) / 100;
    return b;
  };
  finalize(overall);
  for (const k of Object.keys(byCategory)) finalize(byCategory[k]);
  for (const k of Object.keys(bySport)) finalize(bySport[k]);

  const daily = Array.from(dailyMap.entries())
    .map(([date, v]) => ({ date, ...v, profitUnits: Math.round(v.profitUnits * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { overall: overall as any, byCategory: byCategory as any, bySport: bySport as any, daily };
}
