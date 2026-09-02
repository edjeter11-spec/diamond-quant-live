// ──────────────────────────────────────────────────────────
// ADMIN BEST BOARD — every pick source, one ranked list. Admin-only.
//
// The public board deliberately shows 3 picks (TARGET=3 in pinned-props:
// short honest board beats a padded one). This is the other side of that
// coin: the ADMIN needs to see everything the models liked today — the
// full prop pool above the quality floor, the sharp-anchor moneylines,
// the model's game picks, and today's published board/parlay — in one
// table sorted by edge, to eyeball what the public board left off.
//
// Read-only aggregation. Nothing here publishes, stores, or grades.
// ──────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/supabase/server-auth";
import { isBullpenPitcherProp } from "@/lib/prop-filters";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface BoardRow {
  /** Where this candidate came from. */
  source: "published" | "parlay" | "sharp-ml" | "model-game" | "prop-pool";
  pick: string;
  game: string;
  market: string;
  line: number | null;
  side: string | null;
  odds: number | null;
  bookmaker: string | null;
  /** 0-100. Model/consensus probability the pick hits. */
  fairProb: number | null;
  /** True EV %, when computable. Rows sort by this. */
  evPct: number | null;
  note?: string;
}

function decPayout(american: number): number {
  return american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
}

const MARKET_LABEL: Record<string, string> = {
  pitcher_strikeouts: "Ks",
  batter_hits: "Hits",
  batter_total_bases: "TB",
  batter_home_runs: "HR",
  batter_rbis: "RBIs",
  batter_runs_scored: "Runs",
  moneyline: "ML",
};

// The full MLB market sweep for the prop pool. Six markets ≈ 6 internal
// fetches — /api/players serves them from its own edge/server cache, so
// this is cheap after the first hit of the day.
const POOL_MARKETS = [
  "pitcher_strikeouts",
  "batter_hits",
  "batter_total_bases",
  "batter_home_runs",
  "batter_rbis",
  "batter_runs_scored",
];

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user)
    return NextResponse.json(
      { ok: false, error: "Auth required" },
      { status: 401 },
    );
  if (!user.isAdmin)
    return NextResponse.json(
      { ok: false, error: "Admin only" },
      { status: 403 },
    );

  const origin = req.nextUrl.origin;
  const rows: BoardRow[] = [];
  const sourceStatus: Record<string, string> = {};

  const j = (r: Response) => (r.ok ? r.json() : Promise.resolve(null));
  const get = (path: string, headers?: Record<string, string>) =>
    fetch(`${origin}${path}`, {
      headers,
      signal: AbortSignal.timeout(20000),
    }).then(j, () => null);

  // Everything in parallel; one dead source must not blank the board.
  const [pinned, parlay, edges, analysis, ...pools] = await Promise.all([
    // Full board, not the free-gated 2 — the cron-secret bypass in
    // pinned-props is exactly for trusted internal readers like this.
    get(`/api/pinned-props?sport=mlb`, {
      "x-cron-secret": process.env.CRON_SECRET ?? "",
    }),
    get(`/api/parlay-today?sport=mlb`),
    get(`/api/edge-scan?minEv=1`),
    get(`/api/bot-analysis`),
    ...POOL_MARKETS.map((m) => get(`/api/players?sport=mlb&market=${m}`)),
  ]);

  // ── 1. Today's published board ──
  if (pinned?.picks?.length) {
    sourceStatus.published = `${pinned.picks.length} picks`;
    for (const p of pinned.picks) {
      rows.push({
        source: "published",
        pick:
          p.market === "moneyline"
            ? `${p.playerName} ML`
            : `${p.playerName} ${p.side === "over" ? "Over" : "Under"} ${p.line} ${MARKET_LABEL[p.market] ?? p.market}`,
        game: p.team ?? "",
        market: p.market,
        line: p.market === "moneyline" ? null : (p.line ?? null),
        side: p.market === "moneyline" ? null : (p.side ?? null),
        odds: p.odds ?? null,
        bookmaker: p.bookmaker ?? null,
        fairProb: p.fairProb ?? null,
        evPct: p.evPercentage ?? null,
        note: "on the public board",
      });
    }
  } else {
    sourceStatus.published = pinned?.notYet
      ? `waiting (builds ${pinned.buildsAtHourET}:00 ET)`
      : "empty";
  }

  // ── 2. Parlay legs ──
  if (parlay?.legs?.length) {
    sourceStatus.parlay = `${parlay.legs.length} legs`;
    for (const l of parlay.legs) {
      rows.push({
        source: "parlay",
        pick: l.pick,
        game: l.game ?? "",
        market: l.market ?? "parlay-leg",
        line: null,
        side: null,
        odds: l.odds ?? null,
        bookmaker: l.bookmaker ?? null,
        fairProb: l.fairProb ?? null,
        evPct: l.evPercentage ?? null,
        note: "parlay of the day",
      });
    }
  } else {
    sourceStatus.parlay = parlay?.notYet ? "waiting on lineups" : "empty";
  }

  // ── 3. Sharp-anchor moneylines ──
  if (edges?.edges?.length) {
    sourceStatus["sharp-ml"] = `${edges.edges.length} edges`;
    for (const e of edges.edges) {
      rows.push({
        source: "sharp-ml",
        pick: e.label ?? `${e.side} ML`,
        game: e.game ?? "",
        market: e.market ?? "moneyline",
        line: e.point ?? null,
        side: null,
        odds: e.price ?? null,
        bookmaker: e.book ?? null,
        fairProb: e.fairProb ?? null,
        evPct: e.evPct ?? null,
        note: `Pinnacle ${e.pinnaclePrice > 0 ? "+" : ""}${e.pinnaclePrice}`,
      });
    }
  } else {
    sourceStatus["sharp-ml"] = "no edges vs Pinnacle right now";
  }

  // ── 4. Model game picks (LOCKS/LONGSHOTS source) ──
  const modelPicks = (analysis?.analyses ?? []).flatMap((g: any) =>
    (g.picks ?? []).map((p: any) => ({ ...p, _game: g })),
  );
  if (modelPicks.length) {
    sourceStatus["model-game"] = `${modelPicks.length} picks`;
    for (const p of modelPicks) {
      rows.push({
        source: "model-game",
        pick: p.pick,
        game: `${p._game.awayTeam} @ ${p._game.homeTeam}`,
        market: p.market ?? "game",
        line: null,
        side: null,
        odds: p.odds ?? null,
        bookmaker: p.bookmaker ?? null,
        fairProb:
          typeof p.confidencePct === "number"
            ? p.confidencePct
            : (p.fairProb ?? null),
        evPct: p.evPercentage ?? null,
        note: p.confidence ? `model: ${p.confidence}` : undefined,
      });
    }
  } else {
    sourceStatus["model-game"] = "no analyses";
  }

  // ── 5. Full prop pool — every candidate above a loose floor ──
  // Same EV math as pinned-props/parlay-builder: fair × payout − 1, on the
  // side the consensus prefers. Loose floor (-4% EV, 52% prob) so the admin
  // sees the NEAR-misses too — that's the whole point of this view.
  let poolCount = 0;
  for (let i = 0; i < POOL_MARKETS.length; i++) {
    const market = POOL_MARKETS[i];
    const props: any[] = pools[i]?.props ?? [];
    for (const p of props) {
      if (!p.playerName || !Number.isFinite(Number(p.line))) continue;
      if (isBullpenPitcherProp(market, Number(p.line))) continue;
      const overP = Number(p.fairOverProb ?? 0);
      const underP = Number(p.fairUnderProb ?? 0);
      const goOver = overP >= underP;
      const best = goOver ? p.bestOver : p.bestUnder;
      const fair = goOver ? overP : underP;
      if (!best?.price || !Number.isFinite(fair)) continue;
      const ev = ((fair / 100) * decPayout(Number(best.price)) - 1) * 100;
      if (ev < -4 || fair < 52) continue;
      poolCount++;
      rows.push({
        source: "prop-pool",
        pick: `${p.playerName} ${goOver ? "Over" : "Under"} ${p.line} ${MARKET_LABEL[market] ?? market}`,
        game: p.team ?? "",
        market,
        line: Number(p.line),
        side: goOver ? "over" : "under",
        odds: Number(best.price),
        bookmaker: best.bookmaker ?? null,
        fairProb: fair,
        evPct: Math.round(ev * 10) / 10,
      });
    }
  }
  sourceStatus["prop-pool"] = `${poolCount} candidates above floor`;

  // Dedupe: a pick already on the public board also appears in the pool —
  // keep the published row (it carries the "on the public board" note) and
  // drop the pool duplicate.
  const seen = new Set<string>();
  const deduped: BoardRow[] = [];
  const keyOf = (r: BoardRow) => r.pick.toLowerCase().replace(/\s+/g, " ");
  for (const r of rows.filter((r) => r.source !== "prop-pool")) {
    seen.add(keyOf(r));
    deduped.push(r);
  }
  for (const r of rows.filter((r) => r.source === "prop-pool")) {
    if (seen.has(keyOf(r))) continue;
    seen.add(keyOf(r));
    deduped.push(r);
  }

  // Rank by EV desc; rows with no EV sink to the bottom (still shown).
  deduped.sort((a, b) => (b.evPct ?? -999) - (a.evPct ?? -999));

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    total: deduped.length,
    sources: sourceStatus,
    rows: deduped.slice(0, 80),
  });
}
