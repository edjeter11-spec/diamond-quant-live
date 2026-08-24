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

type Outcome = { name: string; price: number }; // decimal odds
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

  const apiKey = getApiKey();
  if (!apiKey)
    return NextResponse.json(
      { ok: false, error: "No Odds API key available" },
      { status: 500 },
    );

  const fetchOdds = async (params: string): Promise<Game[] | null> => {
    try {
      const r = await fetch(`${BASE}/?apiKey=${apiKey}&markets=h2h&${params}`, {
        signal: AbortSignal.timeout(15000),
        cache: "no-store",
      });
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

  for (const game of preGame) {
    const pin = game.bookmakers.find((b) => b.key === "pinnacle");
    const h2h = pin?.markets.find((m) => m.key === "h2h");
    const home = h2h?.outcomes.find((o) => o.name === game.home_team);
    const away = h2h?.outcomes.find((o) => o.name === game.away_team);
    if (!home || !away) continue;
    anchored++;

    const [fairHome, fairAway] = devig(1 / home.price, 1 / away.price);
    const fair: Record<string, number> = {
      [game.home_team]: fairHome,
      [game.away_team]: fairAway,
    };
    if (wantAll)
      anchors.push({
        gameId: game.id,
        commence: game.commence_time,
        game: `${game.away_team} @ ${game.home_team}`,
        fair: {
          [game.home_team]: Math.round(fairHome * 1000) / 10,
          [game.away_team]: Math.round(fairAway * 1000) / 10,
        },
      });

    const usGame = softById.get(game.id);
    if (!usGame) continue;

    // Track the best US price per side so the edge names a specific,
    // beatable number — "bet Cubs ML" without a book and price is useless.
    for (const side of [game.home_team, game.away_team]) {
      let best: { book: string; price: number } | null = null;
      for (const b of usGame.bookmakers) {
        const o = b.markets
          .find((m) => m.key === "h2h")
          ?.outcomes.find((x) => x.name === side);
        if (o && (!best || o.price > best.price))
          best = { book: b.key, price: o.price };
      }
      if (!best) continue;
      const ev = (fair[side] * best.price - 1) * 100;
      // Upper sanity bound, mirroring MAX_EV on the props board.
      //
      // A liquid MLB moneyline priced 8%+ better than Pinnacle's de-vigged
      // number does not happen — every instance during development was bad
      // data (in-play prices, a stale line, a mismatched game), never a real
      // edge. The pre-game filter above removes the known cause; this is the
      // backstop so the NEXT bad-data mode degrades to a short board instead
      // of a confident garbage pick at the top of it.
      if (ev > MAX_SANE_EV) {
        skippedInsane++;
        continue;
      }
      if (ev >= minEv) {
        edges.push({
          gameId: game.id,
          commence: game.commence_time,
          game: `${game.away_team} @ ${game.home_team}`,
          side,
          book: best.book,
          price: decToAmerican(best.price),
          decimalPrice: best.price,
          fairProb: Math.round(fair[side] * 1000) / 10,
          pinnaclePrice: decToAmerican(
            side === game.home_team ? home.price : away.price,
          ),
          evPct: Math.round(ev * 100) / 100,
        });
      }
    }
  }

  edges.sort((a, b) => b.evPct - a.evPct);
  return NextResponse.json({
    ok: true,
    sport,
    anchor: "pinnacle",
    devig: "power",
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
