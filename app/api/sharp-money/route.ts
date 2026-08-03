import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchOdds } from "@/lib/odds/the-odds-api";
import { getApiKey } from "@/lib/odds/api-keys";
import { getCached, setCache } from "@/lib/odds/server-cache";

export const revalidate = 0;

// Server-only route → use service-role key to bypass RLS for trusted writes.
const supabase = (() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "";
  return url && key
    ? createClient(url, key, { auth: { persistSession: false } })
    : null;
})();

// ── helpers ──────────────────────────────────────────────

function americanToImplied(odds: number): number {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

function computeMovements(rows: any[]) {
  // Group by game_id + bookmaker + market
  const groups: Record<string, any[]> = {};
  for (const r of rows) {
    const k = `${r.game_id}|${r.bookmaker}|${r.market}`;
    (groups[k] ??= []).push(r);
  }

  const movements: any[] = [];

  for (const entries of Object.values(groups)) {
    if (entries.length < 2) continue;
    const first = entries[0];
    const last = entries[entries.length - 1];
    const game = `${first.away_team} @ ${first.home_team}`;
    const ago = Math.round(
      (new Date(last.captured_at).getTime() -
        new Date(first.captured_at).getTime()) /
        60000,
    );

    if (
      first.market === "spreads" &&
      first.spread != null &&
      last.spread != null
    ) {
      const delta = Math.abs(last.spread - first.spread);
      if (delta >= 0.5) {
        movements.push({
          game,
          game_id: first.game_id,
          bookmaker: first.bookmaker,
          market: "Spread",
          from: first.spread,
          to: last.spread,
          delta,
          direction: last.spread > first.spread ? "up" : "down",
          minutes_ago: ago,
          is_sharp: delta >= 1.5,
        });
      }
    }

    if (
      first.market === "totals" &&
      first.total != null &&
      last.total != null
    ) {
      const delta = Math.abs(last.total - first.total);
      if (delta >= 0.5) {
        movements.push({
          game,
          game_id: first.game_id,
          bookmaker: first.bookmaker,
          market: "Total",
          from: first.total,
          to: last.total,
          delta,
          direction: last.total > first.total ? "up" : "down",
          minutes_ago: ago,
          is_sharp: delta >= 1.5,
        });
      }
    }

    if (
      first.market === "moneyline" &&
      first.home_price != null &&
      last.home_price != null
    ) {
      const oldP = americanToImplied(first.home_price);
      const newP = americanToImplied(last.home_price);
      const probDelta = Math.abs(newP - oldP);
      if (probDelta >= 0.02) {
        movements.push({
          game,
          game_id: first.game_id,
          bookmaker: first.bookmaker,
          market: "ML",
          from: first.home_price,
          to: last.home_price,
          delta: Math.round(probDelta * 100 * 10) / 10, // % probability
          direction: last.home_price > first.home_price ? "up" : "down",
          minutes_ago: ago,
          is_sharp: probDelta >= 0.04,
          prob_delta: probDelta,
        });
      }
    }
  }

  return movements.sort((a, b) => b.delta - a.delta);
}

// ── Cross-book outliers ──────────────────────────────────
//
// DraftKings and FanDuel are where the bets actually get placed, so the
// question that matters isn't only "did this line move" — it's "is OUR book
// currently off the market". If DK still has a total at 8.5 while five other
// books have moved to 9.5, that's a stale number you can take before it
// corrects, and it's visible without any model at all.
//
// Uses the most recent snapshot per (game, book, market) and compares our
// books against the median of everyone else.
const OUR_BOOKS = new Set(["draftkings", "fanduel"]);

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function computeOutliers(rows: any[]): any[] {
  // Latest row per game+book+market.
  const latest = new Map<string, any>();
  for (const r of rows) {
    const k = `${r.game_id}|${r.bookmaker}|${r.market}`;
    const prev = latest.get(k);
    if (!prev || new Date(r.captured_at) > new Date(prev.captured_at))
      latest.set(k, r);
  }

  // Regroup by game+market so books can be compared against each other.
  const byMarket = new Map<string, any[]>();
  for (const r of latest.values()) {
    const k = `${r.game_id}|${r.market}`;
    (byMarket.get(k) ?? byMarket.set(k, []).get(k)!).push(r);
  }

  const out: any[] = [];
  for (const entries of byMarket.values()) {
    if (entries.length < 3) continue; // need a real market to be an outlier from

    const field = entries[0].market === "totals" ? "total" : "spread";
    const vals = entries
      .map((e) => e[field])
      .filter((v): v is number => typeof v === "number");
    if (vals.length < 3) continue;

    const mid = median(vals);
    for (const e of entries) {
      const book = String(e.bookmaker ?? "").toLowerCase();
      if (!OUR_BOOKS.has(book)) continue;
      const v = e[field];
      if (typeof v !== "number") continue;
      const diff = v - mid;
      // Half a run/point is the smallest gap worth acting on in MLB.
      if (Math.abs(diff) < 0.5) continue;
      out.push({
        game: `${e.away_team} @ ${e.home_team}`,
        game_id: e.game_id,
        bookmaker: e.bookmaker,
        market: e.market === "totals" ? "Total" : "Spread",
        ourLine: v,
        marketMedian: mid,
        diff: Math.round(diff * 10) / 10,
        books: vals.length,
        // Which way the value points depends on which side you'd take.
        note:
          diff > 0
            ? `${e.bookmaker} is ${Math.abs(diff)} HIGHER than the market — value on the under`
            : `${e.bookmaker} is ${Math.abs(diff)} LOWER than the market — value on the over`,
      });
    }
  }
  return out.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
}

// ── GET — return line movements from last 60 min ─────────

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sport = searchParams.get("sport") || "baseball_mlb";
  const CACHE_KEY = `sharp_movements_${sport}`;

  // server-cache TTL is in milliseconds — 60_000 = 60s
  const cached = getCached(CACHE_KEY, 60_000);
  if (cached) return NextResponse.json(cached);

  if (!supabase) return NextResponse.json({ movements: [], count: 0, sport });

  // Look back over the whole betting day, not the last hour. The interesting
  // move is "where did this line open vs where is it now", and an hour-wide
  // window on a 30-minute cron could only ever see one interval.
  const hours = Math.min(
    36,
    Math.max(1, Number(searchParams.get("hours") ?? 18)),
  );
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("odds_history")
    .select("*")
    .eq("sport", sport)
    .gte("captured_at", since)
    .order("captured_at", { ascending: true });

  if (error || !data) {
    if (error) console.error("sharp-money db error:", error.message);
    return NextResponse.json({ movements: [], count: 0, sport });
  }

  const movements = computeMovements(data);
  const outliers = computeOutliers(data);
  const result = {
    movements,
    count: movements.length,
    outliers,
    outlierCount: outliers.length,
    sport,
    hours,
  };
  setCache(CACHE_KEY, result);
  return NextResponse.json(result);
}

// ── POST — snapshot current odds into history ────────────

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const sport = body.sport || "baseball_mlb";

  if (!supabase) return NextResponse.json({ ok: false, error: "No DB" });

  // Fetch fresh odds from The Odds API
  const apiKey = getApiKey();
  if (!apiKey) return NextResponse.json({ ok: false, error: "No API key" });

  let rawGames: any[] = [];
  try {
    rawGames = await fetchOdds(apiKey, sport);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message });
  }

  // Build rows per bookmaker per market
  const rows: any[] = [];
  const now = new Date().toISOString();

  for (const game of rawGames) {
    for (const book of game.bookmakers ?? []) {
      for (const mkt of book.markets ?? []) {
        if (mkt.key === "h2h") {
          const home = mkt.outcomes.find((o: any) => o.name === game.home_team);
          const away = mkt.outcomes.find((o: any) => o.name === game.away_team);
          rows.push({
            sport,
            game_id: game.id,
            home_team: game.home_team,
            away_team: game.away_team,
            bookmaker: book.key,
            market: "moneyline",
            home_price: home?.price ?? null,
            away_price: away?.price ?? null,
            captured_at: now,
          });
        } else if (mkt.key === "spreads") {
          const homeSpread = mkt.outcomes.find(
            (o: any) => o.name === game.home_team,
          );
          rows.push({
            sport,
            game_id: game.id,
            home_team: game.home_team,
            away_team: game.away_team,
            bookmaker: book.key,
            market: "spreads",
            spread: homeSpread?.point ?? null,
            home_price: homeSpread?.price ?? null,
            captured_at: now,
          });
        } else if (mkt.key === "totals") {
          const over = mkt.outcomes.find((o: any) => o.name === "Over");
          rows.push({
            sport,
            game_id: game.id,
            home_team: game.home_team,
            away_team: game.away_team,
            bookmaker: book.key,
            market: "totals",
            total: over?.point ?? null,
            home_price: over?.price ?? null,
            captured_at: now,
          });
        }
      }
    }
  }

  if (rows.length === 0) return NextResponse.json({ ok: true, inserted: 0 });

  const { error: insertErr } = await supabase.from("odds_history").insert(rows);

  // Prune records older than 36 hours.
  //
  // Was 65 minutes, which on a 30-minute snapshot cron meant at most two
  // captures ever coexisted and every move older than an hour was deleted
  // before anyone could see it. That's why the Line Movement panel sat empty:
  // not a display bug, the history was being thrown away. 36h keeps a full
  // slate's worth of movement — open-to-close is the interesting comparison —
  // while still bounding the table.
  const cutoff = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
  await supabase.from("odds_history").delete().lt("captured_at", cutoff);

  return NextResponse.json({
    ok: !insertErr,
    inserted: rows.length,
    error: insertErr?.message,
  });
}
