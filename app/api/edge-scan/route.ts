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

const BASE = "https://api.the-odds-api.com/v4/sports/baseball_mlb/odds";

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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  // Below ~1.5% the morning-vs-now line noise swamps the signal; default
  // conservative and let the admin page loosen it.
  const minEv = Number(searchParams.get("minEv") ?? 1.5);

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
  let anchored = 0;

  for (const game of sharp) {
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
    anchor: "pinnacle",
    devig: "power",
    minEv,
    gamesAnchored: anchored,
    edges,
    note:
      edges.length === 0
        ? "No US book currently beats Pinnacle's fair price by the threshold. Normal — edges appear and vanish in minutes; scan again near lineup-confirmation time."
        : "EV is vs Pinnacle's de-vigged price. Act fast — these close quickly.",
  });
}
