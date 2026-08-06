// ──────────────────────────────────────────────────────────
// Track Record — daily pick logging + settlement
// Feeds the public /results page so users can verify hit rate.
// All writes go through supabaseAdmin (service role).
// ──────────────────────────────────────────────────────────

import { supabaseAdmin } from "@/lib/supabase/server-auth";
import { americanToDecimal } from "@/lib/model/kelly";
import { gradeLeg, findGame, type CompletedGame } from "@/lib/bot/bet-grader";

export type PickCategory = "parlay" | "lock" | "longshot" | "prop";
export type PickResult = "pending" | "win" | "loss" | "push" | "void";
// Which surface the pick was surfaced on. Additive — defaults to "bot" so
// existing rows (all logged from the cron's bot slate) keep working.
export type PickSource = "bot" | "board" | "prop" | "nrfi";

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
  pickSource?: PickSource;
}

// Canonical implementation lives in lib/sports-date.ts (client-safe, so the
// UI can share it). Imported for local use and re-exported to keep existing
// import sites working.
import { etDateString } from "@/lib/sports-date";
export { etDateString };

/**
 * Log a batch of today's picks. Deduplicated server-side by
 * (pick_date, sport, category, pick_text) via unique-ish fingerprint.
 */
export async function logDailyPicks(
  picks: LoggedPick[],
): Promise<{ inserted: number }> {
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
    for (const row of data ?? [])
      existing.add(`${row.category}:${row.pick_text}`);
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
      pick_source: p.pickSource ?? "bot",
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
 *
 * Uses the same abbreviation/last-name-aware matcher (`findGame`) and
 * push-safe per-market grader (`gradeLeg`) as the user bet-grader, instead of
 * a separate weaker substring matcher — previously this function only
 * recognized moneyline and total picks (never spreads) and had no push
 * branch for moneyline ties.
 *
 * Idempotent: only ever reads rows with result = 'pending' and updates them
 * once, so re-running settlement (e.g. duplicate cron invocations) cannot
 * double-count or re-grade an already-settled pick.
 */
export async function settlePendingPicks(
  completedGames: CompletedGame[],
): Promise<{ settled: number; failed: number }> {
  if (!supabaseAdmin || completedGames.length === 0)
    return { settled: 0, failed: 0 };

  const { data: pending } = await supabaseAdmin
    .from("daily_picks_log")
    .select("*")
    .eq("result", "pending")
    .limit(500);

  if (!pending || pending.length === 0) return { settled: 0, failed: 0 };

  let settled = 0;
  let failed = 0;
  for (const pick of pending) {
    // Match on the game field first (most reliable), falling back to the
    // pick text itself (covers rows where `game` wasn't populated).
    const game =
      findGame(pick.game ?? "", completedGames) ??
      findGame(pick.pick_text ?? "", completedGames);
    if (!game) continue;

    const result = gradeLeg(pick.market ?? "", pick.pick_text ?? "", game);
    if (result === "pending") continue; // can't confidently grade — leave pending

    const stake = 1; // 1-unit sizing for track-record clarity
    const profit =
      result === "win"
        ? stake * (americanToDecimal(pick.odds ?? -110) - 1)
        : result === "push"
          ? 0
          : -stake;

    // Check the error and only count a settlement that actually landed. This
    // used to increment unconditionally with `error` never destructured, so a
    // failed write returned "settled: N" to the caller and the failure left no
    // trace anywhere — the pick silently stayed pending while the logs said
    // it had been graded.
    const { error: settleErr } = await supabaseAdmin
      .from("daily_picks_log")
      .update({
        result,
        settled_at: new Date().toISOString(),
        profit_units: Math.round(profit * 100) / 100,
      })
      .eq("id", pick.id)
      .eq("result", "pending"); // belt-and-suspenders: no-op if already settled
    if (settleErr) {
      console.error(
        `daily_picks_log settle failed for ${pick.id}:`,
        settleErr.message,
      );
      failed++;
      continue;
    }
    settled++;
  }
  return { settled, failed };
}

/**
 * Roll-up stats for the /results page.
 */
export async function getTrackRecordStats(days: number = 30): Promise<{
  overall: {
    total: number;
    wins: number;
    losses: number;
    pushes: number;
    winRate: number;
    profitUnits: number;
  };
  byCategory: Record<
    PickCategory,
    {
      total: number;
      wins: number;
      losses: number;
      winRate: number;
      profitUnits: number;
    }
  >;
  bySport: Record<
    "mlb" | "nba",
    {
      total: number;
      wins: number;
      losses: number;
      winRate: number;
      profitUnits: number;
    }
  >;
  daily: Array<{
    date: string;
    wins: number;
    losses: number;
    profitUnits: number;
  }>;
  // Additive: props + NRFI/YRFI, sourced from `prop_predictions` (its own
  // commit/grade pipeline), merged into the same overall totals so accuracy
  // reflects EVERY pick type the app surfaces, not just the bot slate.
  propsAndNrfi?: {
    total: number;
    wins: number;
    losses: number;
    pushes: number;
    winRate: number;
    profitUnits: number;
  };
} | null> {
  if (!supabaseAdmin) return null;

  // ET-anchored window boundary so it lines up with the ET dates picks are
  // actually bucketed under (pick_date / game_date are both ET strings).
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  const sinceDate = etDateString(since);

  const { data } = await supabaseAdmin
    .from("daily_picks_log")
    .select("*")
    .gte("pick_date", sinceDate)
    .neq("result", "pending")
    .order("pick_date", { ascending: false });

  const rows = data ?? [];

  const bucket = () => ({
    total: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    winRate: 0,
    profitUnits: 0,
  });
  const overall = bucket();
  const byCategory: Record<string, any> = {
    parlay: bucket(),
    lock: bucket(),
    longshot: bucket(),
    prop: bucket(),
  };
  const bySport: Record<string, any> = { mlb: bucket(), nba: bucket() };
  const dailyMap = new Map<
    string,
    { wins: number; losses: number; profitUnits: number }
  >();

  // profitUnits for daily_picks_log rows is 1-unit flat sizing computed at
  // settlement time (see settlePendingPicks) using the odds recorded at
  // pick time — already correct, kept as-is here.
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
    else if (r.result === "push") cat.pushes++;
    cat.profitUnits += Number(r.profit_units ?? 0);
    byCategory[r.category] = cat;

    const sport = bySport[r.sport] ?? bucket();
    sport.total++;
    if (r.result === "win") sport.wins++;
    else if (r.result === "loss") sport.losses++;
    else if (r.result === "push") sport.pushes++;
    sport.profitUnits += Number(r.profit_units ?? 0);
    bySport[r.sport] = sport;

    const d = r.pick_date;
    const day = dailyMap.get(d) ?? { wins: 0, losses: 0, profitUnits: 0 };
    if (r.result === "win") day.wins++;
    else if (r.result === "loss") day.losses++;
    day.profitUnits += Number(r.profit_units ?? 0);
    dailyMap.set(d, day);
  }

  // ── Props + NRFI/YRFI: pull graded rows from prop_predictions and fold
  // them into the same overall/bySport/daily buckets. `result` is the
  // push-safe column (migration 008); fall back to the legacy `hit`
  // boolean for rows graded before that column existed (those rows can
  // never have been a push in-place, since the old code coerced push→loss
  // at write time, so treating missing `result` as win/loss off `hit` is
  // safe and doesn't invent pushes that didn't happen).
  const propBucket = bucket();
  try {
    const { data: propRows } = await supabaseAdmin
      .from("prop_predictions")
      .select("sport,game_date,result,hit,odds_at_pick,status")
      .eq("status", "graded")
      .gte("game_date", sinceDate);

    for (const r of propRows ?? []) {
      const result: PickResult =
        r.result === "win" || r.result === "loss" || r.result === "push"
          ? r.result
          : r.hit === true
            ? "win"
            : r.hit === false
              ? "loss"
              : "push"; // hit is null/unknown — don't guess a decided result
      if (result === "push") {
        propBucket.total++;
        propBucket.pushes++;
      } else {
        const stake = 1;
        const profit =
          result === "win"
            ? stake * (americanToDecimal(r.odds_at_pick ?? -110) - 1)
            : -stake;
        propBucket.total++;
        if (result === "win") propBucket.wins++;
        else propBucket.losses++;
        propBucket.profitUnits += profit;

        overall.total++;
        if (result === "win") overall.wins++;
        else overall.losses++;
        overall.profitUnits += profit;

        const sport = bySport[r.sport] ?? bucket();
        sport.total++;
        if (result === "win") sport.wins++;
        else sport.losses++;
        sport.profitUnits += profit;
        bySport[r.sport] = sport;

        const cat = byCategory.prop;
        cat.total++;
        if (result === "win") cat.wins++;
        else cat.losses++;
        cat.profitUnits += profit;

        const d = r.game_date;
        const day = dailyMap.get(d) ?? { wins: 0, losses: 0, profitUnits: 0 };
        if (result === "win") day.wins++;
        else day.losses++;
        day.profitUnits += profit;
        dailyMap.set(d, day);
      }
    }
  } catch (e) {
    console.error("getTrackRecordStats prop rollup error:", e);
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
  finalize(propBucket);

  const daily = Array.from(dailyMap.entries())
    .map(([date, v]) => ({
      date,
      ...v,
      profitUnits: Math.round(v.profitUnits * 100) / 100,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    overall: overall as any,
    byCategory: byCategory as any,
    bySport: bySport as any,
    daily,
    propsAndNrfi: propBucket,
  };
}
