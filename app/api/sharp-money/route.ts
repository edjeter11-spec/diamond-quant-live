import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchOdds } from "@/lib/odds/the-odds-api";
import { getApiKey } from "@/lib/odds/api-keys";
import { getCached, setCache } from "@/lib/odds/server-cache";

export const revalidate = 0;

const supabase = (() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  return url && key ? createClient(url, key) : null;
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
      (new Date(last.captured_at).getTime() - new Date(first.captured_at).getTime()) / 60000
    );

    if (first.market === "spreads" && first.spread != null && last.spread != null) {
      const delta = Math.abs(last.spread - first.spread);
      if (delta >= 0.5) {
        movements.push({
          game, game_id: first.game_id, bookmaker: first.bookmaker,
          market: "Spread",
          from: first.spread, to: last.spread, delta,
          direction: last.spread > first.spread ? "up" : "down",
          minutes_ago: ago,
          is_sharp: delta >= 1.5,
        });
      }
    }

    if (first.market === "totals" && first.total != null && last.total != null) {
      const delta = Math.abs(last.total - first.total);
      if (delta >= 0.5) {
        movements.push({
          game, game_id: first.game_id, bookmaker: first.bookmaker,
          market: "Total",
          from: first.total, to: last.total, delta,
          direction: last.total > first.total ? "up" : "down",
          minutes_ago: ago,
          is_sharp: delta >= 1.5,
        });
      }
    }

    if (first.market === "moneyline" && first.home_price != null && last.home_price != null) {
      const oldP = americanToImplied(first.home_price);
      const newP = americanToImplied(last.home_price);
      const probDelta = Math.abs(newP - oldP);
      if (probDelta >= 0.02) {
        movements.push({
          game, game_id: first.game_id, bookmaker: first.bookmaker,
          market: "ML",
          from: first.home_price, to: last.home_price,
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

// ── GET — return line movements from last 60 min ─────────

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sport = searchParams.get("sport") || "baseball_mlb";
  const CACHE_KEY = `sharp_movements_${sport}`;

  const cached = getCached(CACHE_KEY, 60); // 60s cache so we don't hammer DB
  if (cached) return NextResponse.json(cached);

  if (!supabase) return NextResponse.json({ movements: [], error: "No DB" });

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("odds_history")
    .select("*")
    .eq("sport", sport)
    .gte("captured_at", since)
    .order("captured_at", { ascending: true });

  if (error || !data) return NextResponse.json({ movements: [], error: error?.message });

  const movements = computeMovements(data);
  const result = { movements, count: movements.length, sport };
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
            sport, game_id: game.id,
            home_team: game.home_team, away_team: game.away_team,
            bookmaker: book.key, market: "moneyline",
            home_price: home?.price ?? null,
            away_price: away?.price ?? null,
            captured_at: now,
          });
        } else if (mkt.key === "spreads") {
          const homeSpread = mkt.outcomes.find((o: any) => o.name === game.home_team);
          rows.push({
            sport, game_id: game.id,
            home_team: game.home_team, away_team: game.away_team,
            bookmaker: book.key, market: "spreads",
            spread: homeSpread?.point ?? null,
            home_price: homeSpread?.price ?? null,
            captured_at: now,
          });
        } else if (mkt.key === "totals") {
          const over = mkt.outcomes.find((o: any) => o.name === "Over");
          rows.push({
            sport, game_id: game.id,
            home_team: game.home_team, away_team: game.away_team,
            bookmaker: book.key, market: "totals",
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

  // Prune records older than 65 min
  const cutoff = new Date(Date.now() - 65 * 60 * 1000).toISOString();
  await supabase.from("odds_history").delete().lt("captured_at", cutoff);

  return NextResponse.json({
    ok: !insertErr,
    inserted: rows.length,
    error: insertErr?.message,
  });
}
