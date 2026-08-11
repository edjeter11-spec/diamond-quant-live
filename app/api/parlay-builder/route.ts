// ──────────────────────────────────────────────────────────
// PARLAY BUILDER — on-demand parlay suggester for the Discord bot.
//
// Different from /api/parlay-today (which pins the day's official parlay
// under a lineup gate and stores it to Supabase for grading). This one
// answers ad-hoc questions like "give me a 3-leg HR parlay" — no gate,
// no store, no grading commitment. Just: given a sport + market + N,
// return the top-N picks and the combined ticket.
//
// Public (no cron secret) because the bot forwards requests from Discord
// users, but hardened against abuse: rate-limited by IP via Vercel's
// built-in and capped at N ≤ 5.
// ──────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { checkLineupGate } from "@/lib/lineup-gate";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Short edge cache — same parlay question in the next 90s returns identical
// picks (the underlying prop lines don't move that fast) without re-hitting
// The Odds API each time.
const EDGE_HEADERS = {
  "Cache-Control": "public, s-maxage=90, stale-while-revalidate=180",
};

interface Leg {
  player: string;
  team?: string;
  side: "over" | "under";
  line: number;
  market: string;
  odds: number;
  bookmaker: string;
  fairProb: number;
  game: string;
}

function decimalPayout(american: number): number {
  return american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
}

function decimalToAmerican(dec: number): string {
  const cents =
    dec >= 2 ? Math.round((dec - 1) * 100) : -Math.round(100 / (dec - 1));
  return (cents > 0 ? "+" : "") + cents;
}

// Human-readable market label for the response, matching the site's usual
// wording so a bot reply doesn't render "batter_home_runs" as-is.
const MARKET_LABEL: Record<string, string> = {
  batter_home_runs: "HR",
  batter_hits: "Hits",
  batter_total_bases: "TB",
  batter_rbis: "RBIs",
  batter_runs_scored: "Runs",
  pitcher_strikeouts: "Ks",
  player_points: "Points",
  player_rebounds: "Rebounds",
  player_assists: "Assists",
};

function normSport(input: string | null): "mlb" | "nba" | "nfl" | null {
  const s = (input ?? "").toLowerCase();
  if (s === "mlb" || s === "baseball_mlb") return "mlb";
  if (s === "nba" || s === "basketball_nba") return "nba";
  if (s === "nfl" || s === "americanfootball_nfl") return "nfl";
  return null;
}

function normMarket(sport: string, market: string | null): string {
  const m = (market ?? "").toLowerCase();
  if (sport === "mlb") {
    if (["hr", "homers", "home_runs", "homerun"].includes(m))
      return "batter_home_runs";
    if (["hits", "hit"].includes(m)) return "batter_hits";
    if (["tb", "totalbases", "total_bases"].includes(m))
      return "batter_total_bases";
    if (["ks", "strikeouts", "sos"].includes(m)) return "pitcher_strikeouts";
    if (["rbi", "rbis"].includes(m)) return "batter_rbis";
    return m || "batter_home_runs";
  }
  if (sport === "nba") {
    if (m === "pts" || m === "points") return "player_points";
    if (m === "reb" || m === "rebounds") return "player_rebounds";
    if (m === "ast" || m === "assists") return "player_assists";
    return m || "player_points";
  }
  return m;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sport = normSport(searchParams.get("sport"));
  if (!sport) {
    return NextResponse.json(
      { ok: false, error: "sport must be mlb, nba, or nfl" },
      { status: 400 },
    );
  }
  const market = normMarket(sport, searchParams.get("market"));
  // Cap at 5 legs to prevent someone spamming a 20-leg query that fans out
  // to a full player-props scan.
  const legs = Math.min(
    5,
    Math.max(2, parseInt(searchParams.get("legs") ?? "3", 10)),
  );

  // Refuse to build a parlay before lineups are confirmed for the day, same
  // gate the pinned parlay uses. Prevents someone asking at 4am from getting
  // a lineup-blind answer that looks authoritative just because the bot
  // sent it. Bypass for admin/testing via force=1.
  const force = searchParams.get("force") === "1";
  if (!force) {
    const gate = await checkLineupGate(sport);
    if (gate.waiting) {
      return NextResponse.json(
        {
          ok: true,
          sport,
          market,
          legs: [],
          notYet: true,
          buildsAtHourET: gate.buildsAtHourET,
          message: `Parlays lock in around ${gate.buildsAtHourET}:00 ET once lineups are confirmed. Ask me again then.`,
        },
        { headers: EDGE_HEADERS },
      );
    }
  }

  // Reuse the site's own player-props endpoint (already handles Odds API
  // rotation, alt lines, and prop consensus). Cheaper than another Odds API
  // hit here.
  const origin = req.nextUrl.origin;
  const sportKey =
    sport === "nba"
      ? "basketball_nba"
      : sport === "nfl"
        ? "americanfootball_nfl"
        : "baseball_mlb";
  const r = await fetch(
    `${origin}/api/players?sport=${sportKey}&market=${market}`,
    { signal: AbortSignal.timeout(20000) },
  );
  if (!r.ok) {
    return NextResponse.json(
      { ok: false, error: `Could not fetch ${market} props` },
      { status: 502 },
    );
  }
  const d = await r.json();
  const props: any[] = Array.isArray(d.props) ? d.props : [];
  if (!props.length) {
    return NextResponse.json(
      {
        ok: true,
        sport,
        market,
        legs: [],
        message: `No ${MARKET_LABEL[market] ?? market} lines posted yet for tonight.`,
      },
      { headers: EDGE_HEADERS },
    );
  }

  // Build candidate legs. HR-type markets (batter_home_runs) are ALWAYS "Yes
  // to hit one" — nobody parlays "will he NOT hit multiple HRs" at -20000
  // even if that's the model's highest probability. Same for anytime-TD.
  // For those markets, force the Over side. For everything else (K props,
  // yards) let the model pick the higher-prob side.
  const OVER_ONLY = new Set(["batter_home_runs"]);
  const isOverOnly = OVER_ONLY.has(market);
  // For OVER_ONLY markets also cap the line — a HR parlay shouldn't include
  // 1.5+ HR lines even on the over side (implied prob so small the ticket
  // pays nothing meaningful either way).
  const LINE_CAP = isOverOnly ? 0.5 : Infinity;
  // And clamp the odds themselves: any leg shorter than -400 is chalk that
  // shrinks the payout without meaningfully changing the outcome — a parlay
  // suggestion of -20000 legs is a bug in disguise, not a bet.
  const MIN_ODDS = isOverOnly ? -400 : -600;

  const candidates: Leg[] = [];
  for (const p of props) {
    if (!p.playerName || !Number.isFinite(Number(p.line))) continue;
    if (Number(p.line) > LINE_CAP) continue;

    const overP = Number(p.fairOverProb ?? 0);
    const underP = Number(p.fairUnderProb ?? 0);
    const goOver = isOverOnly ? true : overP >= underP;
    const side: "over" | "under" = goOver ? "over" : "under";
    const best = goOver ? p.bestOver : p.bestUnder;
    const fair = goOver ? overP : underP;
    if (!best?.price || !Number.isFinite(fair)) continue;
    if (Number(best.price) < MIN_ODDS) continue;

    candidates.push({
      player: p.playerName,
      team: p.team,
      side,
      line: Number(p.line),
      market,
      odds: Number(best.price),
      bookmaker: best.bookmaker,
      fairProb: fair,
      game: p.team ?? "",
    });
  }
  if (!candidates.length) {
    return NextResponse.json(
      { ok: true, sport, market, legs: [], message: "No qualifying legs." },
      { headers: EDGE_HEADERS },
    );
  }

  // Ranking: TRUE EV (fair × decimal payout − 1). Same math the pinned board
  // uses. This surfaces "cheap longshots the model likes" over "chalk with no
  // edge" — both matter, EV picks the right blend.
  candidates.sort((a, b) => {
    const evA = (a.fairProb / 100) * decimalPayout(a.odds) - 1;
    const evB = (b.fairProb / 100) * decimalPayout(b.odds) - 1;
    return evB - evA;
  });

  // Take the top N, but never two legs on the same player (a parlay of
  // "Judge o0.5 HR + Judge o1.5 TB" is a correlated bet, not a real parlay
  // in the sense the user asked for).
  const seen = new Set<string>();
  const picked: Leg[] = [];
  for (const c of candidates) {
    if (seen.has(c.player)) continue;
    seen.add(c.player);
    picked.push(c);
    if (picked.length >= legs) break;
  }

  const combinedDec = picked.reduce((s, l) => s * decimalPayout(l.odds), 1);
  const combinedProb = picked.reduce((s, l) => s * (l.fairProb / 100), 1) * 100;

  return NextResponse.json(
    {
      ok: true,
      sport,
      market,
      marketLabel: MARKET_LABEL[market] ?? market,
      legs: picked,
      combinedAmerican: decimalToAmerican(combinedDec),
      combinedDecimal: Math.round(combinedDec * 100) / 100,
      // Rough — assumes independence. Fine for a chat answer, not for a
      // published product line.
      estimatedHitPct: Math.round(combinedProb * 100) / 100,
      note: "Estimated hit rate assumes leg independence. HR parlays and other longshot markets are lottery tickets — size accordingly.",
    },
    { headers: EDGE_HEADERS },
  );
}
