import { NextRequest, NextResponse } from "next/server";
import { getApiKey } from "@/lib/odds/api-keys";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// ──────────────────────────────────────────────────────────
// SHARP-ANCHOR EDGE SCANNER
//
// The one retail betting strategy with a real, documented edge — and it needs
// no model at all. Pinnacle is the sharpest book in the world: low vig, high
// limits, welcomes winners, and its closing line is the industry's benchmark
// for "true" probability. The play:
//
//   1. De-vig Pinnacle's two-way moneyline  → fair probability
//   2. For every US book price on the same side, compute
//        EV = fairProb × decimalPayout − 1
//   3. Positive EV = that soft book is offering better than Pinnacle's
//      fair price. Bet it.
//
// Why this exists instead of trusting the in-house model: the 449-pick priced
// backtest showed the model carries almost nothing beyond the market (best
// blend weight 0.20, calibration 6-13 points hot). The market is the best
// predictor we have access to — so use the SHARPEST market as the truth
// source, and monetise the difference between it and the slow US books.
//
// The 2-3% edges this finds are real but small; they get eaten instantly by
// taking a worse price. That's why bestBook/bestPrice are surfaced per edge —
// the specific book at the specific number IS the pick.
//
// Cost: 2 Odds API credits per scan (one eu region call, one us). Admin-only
// surface — this powers /admin/bot and the Discord alert path, not the
// public board.
// ──────────────────────────────────────────────────────────

// Sport-parameterized (2026-08-24, NFL-season prep). This scanner is the
// only CLV-proven +EV source in the app, and it was hardcoded to MLB —
// meaning the NFL launch would have had zero sharp-anchor coverage even
// though Pinnacle prices NFL more heavily than any other US sport.
// Unknown sports 400 rather than silently scanning baseball.
const SPORT_KEYS: Record<string, string> = {
  mlb: "baseball_mlb",
  nfl: "americanfootball_nfl",
  nba: "basketball_nba",
  nhl: "icehockey_nhl",
};
const baseFor = (sportKey: string) =>
  `https://api.the-odds-api.com/v4/sports/${sportKey}/odds`;

// Books whose lag we monetise. Wider than the 3-book display list on purpose:
// an off-market price at ANY legal US book is actionable here, because the
// scanner's whole job is finding outliers — the opposite trade-off from the
// consensus feed, which trimmed to 3 books to cut payload.
const US_BOOKS = [
  "draftkings",
  "fanduel",
  "betmgm",
  "williamhill_us",
  "betrivers",
  "espnbet",
  "hardrockbet",
  "fanatics",
];

type Outcome = { name: string; price: number; point?: number }; // decimal odds

// Odds API market key → the name every consumer of this scanner uses
// (manual_picks.market, the board, the bot). Spreads and totals were added
// 2026-09-02 for the NFL season: the sharp-anchor method is market-agnostic
// (de-vig Pinnacle's two-way price, compare US books at the SAME number),
// and for football the spread and total ARE the market — a moneyline-only
// scan would have ignored two-thirds of Pinnacle's NFL pricing. A point
// mismatch (Pinnacle -3.5, DK -3) is never compared: different numbers are
// different bets and can't be priced against each other without a push
// chart, so the scan simply skips that book for that side.
const MARKET_NAME: Record<string, "moneyline" | "spread" | "total"> = {
  h2h: "moneyline",
  spreads: "spread",
  totals: "total",
};
const ALL_MARKETS = Object.keys(MARKET_NAME);

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
function edgeLabel(market: string, side: string, point?: number) {
  if (market === "spread" && typeof point === "number")
    return `${side} ${signed(point)}`;
  if (market === "total" && typeof point === "number")
    return `${side} ${point}`;
  return `${side} ML`;
}
type Game = {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Array<{
    key: string;
    markets: Array<{ key: string; outcomes: Outcome[] }>;
  }>;
};

const decToAmerican = (d: number) =>
  d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));

/** Power de-vig: solve ra^k + rb^k = 1. Chosen over proportional because
 *  proportional overstates favorites, and overstating the favorite's fair
 *  prob manufactures fake EV on chalk — the exact failure mode the model
 *  backtest died of. Power is the conservative choice for an edge scanner. */
function devig(pa: number, pb: number): [number, number] {
  let lo = 0.5,
    hi = 3.0;
  for (let i = 0; i < 60; i++) {
    const k = (lo + hi) / 2;
    if (Math.pow(pa, k) + Math.pow(pb, k) > 1) lo = k;
    else hi = k;
  }
  const k = (lo + hi) / 2;
  return [Math.pow(pa, k), Math.pow(pb, k)];
}

/** Largest believable moneyline edge vs Pinnacle's de-vigged price (%). */
const MAX_SANE_EV = 8;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  // Below ~1.5% the morning-vs-now line noise swamps the signal; default
  // conservative and let the admin page loosen it.
  const minEv = Number(searchParams.get("minEv") ?? 1.5);
  // all=1 → also return Pinnacle's fair prob for EVERY anchored game, not
  // just the ones with an edge. The CLV tracker needs this: a closing price
  // is captured for alerts whose edge has since evaporated, which is exactly
  // the case that must be recorded honestly rather than dropped.
  const wantAll = searchParams.get("all") === "1";

  const sport = (searchParams.get("sport") ?? "mlb").toLowerCase();
  const sportKey = SPORT_KEYS[sport];
  if (!sportKey)
    return NextResponse.json(
      {
        ok: false,
        error: `sport must be one of ${Object.keys(SPORT_KEYS).join(", ")}`,
      },
      { status: 400 },
    );
  const BASE = baseFor(sportKey);

  // markets=h2h restricts to moneylines (cheaper: Odds API bills per
  // market per region). Default scans all three.
  const marketsParam = (searchParams.get("markets") ?? ALL_MARKETS.join(","))
    .split(",")
    .map((m) => m.trim())
    .filter((m) => m in MARKET_NAME);
  const marketKeys = marketsParam.length ? marketsParam : ["h2h"];

  const apiKey = getApiKey();
  if (!apiKey)
    return NextResponse.json(
      { ok: false, error: "No Odds API key available" },
      { status: 500 },
    );

  const fetchOdds = async (params: string): Promise<Game[] | null> => {
    try {
      const r = await fetch(
        `${BASE}/?apiKey=${apiKey}&markets=${marketKeys.join(",")}&${params}`,
        {
          signal: AbortSignal.timeout(15000),
          cache: "no-store",
        },
      );
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    }
  };

  // Two calls, parallel: the sharp anchor and the soft targets.
  const [sharp, soft] = await Promise.all([
    fetchOdds("regions=eu&bookmakers=pinnacle"),
    fetchOdds(`regions=us&bookmakers=${US_BOOKS.join(",")}`),
  ]);
  if (!sharp || !soft)
    return NextResponse.json(
      { ok: false, error: "Odds fetch failed" },
      { status: 502 },
    );

  const softById = new Map(soft.map((g) => [g.id, g]));
  const edges: any[] = [];
  const anchors: any[] = [];
  let anchored = 0;
  let skippedStarted = 0;
  let skippedInsane = 0;

  // Only games that have NOT started.
  //
  // There was no time filter here at all, and that produced fake edges large
  // enough to poison the whole board. Once a game is underway US books post
  // IN-PLAY prices while this still de-vigs Pinnacle's number for the same
  // game id, so a team losing 5-0 shows a huge "edge":
  //
  //   Yankees  US +1000 vs Pinnacle +260  -> "+164.3% EV"
  //   Red Sox  US  +525 vs Pinnacle +298  -> "+36.3% EV"
  //
  // Nothing is being beaten there — the two prices describe different game
  // states. Real MLB moneyline edges are ~1-3%; anything near these numbers
  // is definitionally a bug. These were ranked score = 100 + evPct, so they
  // went straight to the TOP of the published board.
  //
  // 5-minute buffer: commence_time from the odds feed drifts a minute or two
  // from the official first pitch, and a line in the final minutes before a
  // start is already unreliable.
  const cutoff = Date.now() + 5 * 60 * 1000;
  const preGame = sharp.filter((g) => {
    const t = Date.parse(g.commence_time);
    if (!Number.isFinite(t)) return false; // unknown start time — don't guess
    if (t <= cutoff) {
      skippedStarted++;
      return false;
    }
    return true;
  });

  // Same point or nothing. `undefined === undefined` covers moneylines.
  const samePoint = (a?: number, b?: number) =>
    (a == null && b == null) || (a != null && b != null && a === b);

  for (const game of preGame) {
    const pin = game.bookmakers.find((b) => b.key === "pinnacle");
    if (!pin) continue;
    const usGame = softById.get(game.id);
    const gameLabel = `${game.away_team} @ ${game.home_team}`;
    let gameAnchored = false;

    for (const mk of marketKeys) {
      const market = MARKET_NAME[mk];
      const pinMarket = pin.markets.find((m) => m.key === mk);
      // Pinnacle posts one main line per market; a two-way pair is the unit
      // of de-vigging. Anything without exactly two priced sides is skipped
      // — a partial or alt-line payload can't be de-vigged honestly.
      const pair = pinMarket?.outcomes?.filter((o) => o.price > 1) ?? [];
      if (pair.length !== 2) continue;
      const [a, b] = pair;
      // For h2h the sides must be the two teams; for spreads/totals the two
      // outcomes are complementary by construction (±point / Over-Under).
      if (
        mk === "h2h" &&
        !(
          [a.name, b.name].includes(game.home_team) &&
          [a.name, b.name].includes(game.away_team)
        )
      )
        continue;
      gameAnchored = true;

      const [fairA, fairB] = devig(1 / a.price, 1 / b.price);
      const fairBy = new Map<string, number>([
        [a.name, fairA],
        [b.name, fairB],
      ]);
      const pinPriceBy = new Map<string, number>([
        [a.name, a.price],
        [b.name, b.price],
      ]);
      // CLV anchors stay moneyline-only: the close-capture matcher keys on
      // team name, and a scoreboard mixing market types would be unreadable.
      if (wantAll && mk === "h2h")
        anchors.push({
          gameId: game.id,
          commence: game.commence_time,
          game: gameLabel,
          fair: {
            [a.name]: Math.round(fairA * 1000) / 10,
            [b.name]: Math.round(fairB * 1000) / 10,
          },
        });
      if (!usGame) continue;

      // Track the best US price per side so the edge names a specific,
      // beatable number — "bet Cubs ML" without a book and price is useless.
      for (const side of [a, b]) {
        let best: { book: string; price: number } | null = null;
        for (const bk of usGame.bookmakers) {
          const o = bk.markets
            .find((m) => m.key === mk)
            ?.outcomes.find(
              (x) => x.name === side.name && samePoint(x.point, side.point),
            );
          if (o && (!best || o.price > best.price))
            best = { book: bk.key, price: o.price };
        }
        if (!best) continue;
        const fair = fairBy.get(side.name)!;
        const ev = (fair * best.price - 1) * 100;
        // Upper sanity bound, mirroring MAX_EV on the props board.
        //
        // A liquid moneyline priced 8%+ better than Pinnacle's de-vigged
        // number does not happen — every instance during development was
        // bad data (in-play prices, a stale line, a mismatched game), never
        // a real edge. The pre-game filter above removes the known cause;
        // this is the backstop so the NEXT bad-data mode degrades to a
        // short board instead of a confident garbage pick at the top of it.
        if (ev > MAX_SANE_EV) {
          skippedInsane++;
          continue;
        }
        if (ev >= minEv) {
          edges.push({
            gameId: game.id,
            commence: game.commence_time,
            game: gameLabel,
            market,
            side: side.name,
            point: side.point ?? null,
            label: edgeLabel(market, side.name, side.point),
            book: best.book,
            price: decToAmerican(best.price),
            decimalPrice: best.price,
            fairProb: Math.round(fair * 1000) / 10,
            pinnaclePrice: decToAmerican(pinPriceBy.get(side.name)!),
            evPct: Math.round(ev * 100) / 100,
          });
        }
      }
    }
    if (gameAnchored) anchored++;
  }

  edges.sort((a, b) => b.evPct - a.evPct);
  return NextResponse.json({
    ok: true,
    sport,
    anchor: "pinnacle",
    devig: "power",
    markets: marketKeys.map((k) => MARKET_NAME[k]),
    minEv,
    gamesAnchored: anchored,
    // Surfaced, not swallowed: a sudden jump in either counter is the signal
    // that the upstream feed has gone wrong again.
    skippedInPlay: skippedStarted,
    skippedImplausible: skippedInsane,
    edges,
    ...(wantAll ? { anchors } : {}),
    note:
      edges.length === 0
        ? "No US book currently beats Pinnacle's fair price by the threshold. Normal — edges appear and vanish in minutes; scan again near lineup-confirmation time."
        : "EV is vs Pinnacle's de-vigged price. Act fast — these close quickly.",
  });
}
