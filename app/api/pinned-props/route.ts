import { NextRequest, NextResponse } from "next/server";
import { cloudGet, cloudSet } from "@/lib/supabase/client";
import { etDateString } from "@/lib/sports-date";

export const dynamic = "force-dynamic";

// ──────────────────────────────────────────────────────────
// PINNED PLAYER PROPS
//
// Player props used to be ranked in each visitor's browser from live odds, so
// two people loading the page seconds apart could see a different board — and
// a pick could vanish from under someone as lines moved. Props are a published
// position, not a live feed: everyone must see the same board.
//
// This mirrors the ranking that lived in TodayPropPicks and pins the result to
// Supabase under a per-day, per-window key, exactly like /api/parlay-today.
// The window rolls every REFRESH_HOURS so the board can pick up genuinely new
// value during the day, but within a window it is identical for every user.
// ──────────────────────────────────────────────────────────

const TARGET = 5; // pinned picks per day
const MAX_UNDERS = 2; // keep the board Over-weighted, as before
const REFRESH_HOURS = 3;

// Minimum true EV (%) for a prop to reach the board.
//
// Deliberately permissive. fairProb is currently the de-vigged market
// consensus, so EV here measures price against the market's own opinion — on a
// normal slate every prop lands negative (2026-07-30: 620 priced sides, best
// -0.3%, median -5.6%). A 0% floor would empty the board every day. Until a
// real projection model gives an independent probability, this floor's job is
// only to drop the worst-priced tail; ranking does the real work.
const MIN_EV = -8;

// Minimum win probability (%) for a prop to reach the board.
//
// Ranking purely on EV surfaces plus-money longshots — the best-priced play on
// 2026-07-30 was +290 at 25.6% to hit. That's correct on EV and still wrong for
// a daily board: five picks that lose three nights in four read as broken no
// matter how sound the pricing. This keeps the board to plays that are more
// likely than not, and EV ranks within that set.
const MIN_PROB = 50;

// At most this many picks from any single market.
//
// Without it the board fills with Hits props every day: the score is
// `fair - 50 + ev * 0.5`, dominated by raw probability, and Over 0.5 Hits is
// simply the highest-probability MLB market. Widening the market list wasn't
// enough on its own — Hits still swept all 5 slots. The cap forces a genuine
// spread while each market's slot is still won on merit.
const MAX_PER_MARKET = 2;

// Markets where an Under is meaningless/unbettable (you can't go under 0.5 HR
// in a way anyone prices as a pick) — force the Over side.
const OVER_ONLY_MARKETS = new Set(["batter_home_runs", "batter_stolen_bases"]);

const MARKET_LABEL: Record<string, string> = {
  pitcher_strikeouts: "Ks",
  batter_hits: "Hits",
  batter_total_bases: "Total Bases",
  batter_home_runs: "HR",
  batter_rbis: "RBIs",
  batter_runs_scored: "Runs",
  batter_stolen_bases: "Steals",
  pitcher_outs: "Outs",
  player_points: "Points",
  player_rebounds: "Rebounds",
  player_assists: "Assists",
};

const MLB_MARKETS = [
  "pitcher_strikeouts",
  "batter_hits",
  "batter_total_bases",
  "batter_home_runs",
  "batter_rbis",
  "batter_runs_scored",
];
const NBA_MARKETS = ["player_points", "player_rebounds", "player_assists"];

function americanImplied(odds: number): number {
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}

function americanToDecimal(odds: number): number {
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
}

interface PinnedProp {
  key: string;
  playerName: string;
  playerId?: string | number;
  team?: string;
  side: "over" | "under";
  line: number;
  market: string;
  odds: number;
  bookmaker: string;
  fairProb: number;
  evPercentage: number;
  score: number;
  label: string;
  usesBrain: boolean;
  projectedValue?: number;
}

interface PinnedBoard {
  sport: string;
  date: string;
  window: number;
  picks: PinnedProp[];
  generatedAt: string;
  // How many props we priced, and how many cleared MIN_EV. Lets the UI say
  // "nothing priced well today" instead of silently rendering a short board
  // that looks like a loading failure.
  considered?: number;
  qualified?: number;
}

function build(prop: any, side: "over" | "under"): PinnedProp | null {
  const best = side === "over" ? prop.bestOver : prop.bestUnder;
  if (!best?.price) return null;
  const marketFair =
    side === "over" ? (prop.fairOverProb ?? 50) : (prop.fairUnderProb ?? 50);
  const brainFair = side === "over" ? prop.brainOverProb : prop.brainUnderProb;
  const usesBrain = typeof brainFair === "number" && brainFair > 0;
  const fair = usesBrain ? brainFair : marketFair;
  // True expected value: EV = p * decimalPayout - 1.
  //
  // The old formula was `fair - implied` — a probability-space difference that
  // ignores what the payout is actually worth. Combined with the old score
  // (`fair - 50 + ev * 0.5`) it let raw probability outweigh price about 8.5:1,
  // so the board ranked by LIKELIHOOD, not edge. On 2026-07-30 that put the
  // worst-priced pick on the slate (-6.0% EV at -272) at the top. Ranking on
  // real EV is the same correction already applied in /api/parlay-today.
  const implied = americanImplied(best.price) * 100;
  const ev = ((fair / 100) * americanToDecimal(best.price) - 1) * 100;
  return {
    key: `${prop.market}-${prop.playerName}-${side}`,
    playerName: prop.playerName,
    playerId: prop.playerId,
    team: prop.team,
    side,
    line: prop.line,
    market: prop.market,
    odds: best.price,
    bookmaker: best.bookmaker,
    fairProb: Math.round(fair * 10) / 10,
    evPercentage: Math.round(ev * 10) / 10,
    // Rank on EV. The small probability term is a tie-breaker only (0.05/pt, so
    // a full 20-point probability gap moves score by 1.0) — enough to prefer the
    // likelier of two equally-priced plays without letting probability dominate
    // price the way it used to.
    score: ev + (fair - 50) * 0.05 + (usesBrain ? 0.5 : 0),
    label: MARKET_LABEL[prop.market] ?? prop.market,
    usesBrain,
    projectedValue: prop.brainProjectedValue,
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sport = (searchParams.get("sport") ?? "mlb").toLowerCase();
  const force = searchParams.get("force") === "true";
  const isNBA = sport === "nba";
  const today = etDateString();

  // Which refresh window are we in? Same board for everyone inside it.
  const hourET = Number(
    new Date().toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      hour12: false,
    }),
  );
  const windowIdx = Math.floor(hourET / REFRESH_HOURS);
  const cacheKey = `pinned_props_${sport}_${today}_w${windowIdx}`;

  if (!force) {
    const cached = await cloudGet<PinnedBoard | null>(cacheKey, null);
    if (cached?.picks?.length) {
      return NextResponse.json({ ok: true, ...cached, cached: true });
    }
  }

  try {
    const baseUrl =
      process.env.NODE_ENV === "development"
        ? req.nextUrl.origin
        : "https://diamond-quant-live.vercel.app";
    const sportKey = isNBA ? "basketball_nba" : "baseball_mlb";
    const markets = isNBA ? NBA_MARKETS : MLB_MARKETS;

    const overs: PinnedProp[] = [];
    const unders: PinnedProp[] = [];
    const seenPlayer = new Set<string>();
    let consideredCount = 0;

    const results = await Promise.all(
      markets.map(async (market) => {
        try {
          const r = await fetch(
            `${baseUrl}/api/players?sport=${sportKey}&market=${market}`,
            { signal: AbortSignal.timeout(10000) },
          );
          if (!r.ok) return [] as any[];
          const d = await r.json();
          return (d.props ?? []) as any[];
        } catch {
          return [] as any[];
        }
      }),
    );

    // Build candidates from EVERY market first, deduping by player only at
    // selection time (below). Deduping here — as this originally did — meant
    // whichever market happened to be processed first claimed most players,
    // and every later market's candidates were skipped as duplicates. Hits is
    // early in the list, so it swept all 5 slots and the per-market cap never
    // had a mixed pool to work with.
    for (const props of results) {
      for (const prop of props) {
        if (!prop.playerName) continue;
        // Never pin a prop for someone who's already ruled out.
        if (prop.injuryStatus === "Out" || prop.injuryStatus === "Doubtful")
          continue;

        const forceOver = OVER_ONLY_MARKETS.has(prop.market);
        const tryOver = build(prop, "over");
        const tryUnder = forceOver ? null : build(prop, "under");

        // Over wins ties within 3 points — same bias the board always had.
        const pickSide = forceOver
          ? "over"
          : tryOver && tryUnder
            ? tryOver.score >= tryUnder.score - 3
              ? "over"
              : "under"
            : tryOver
              ? "over"
              : "under";
        const winner = pickSide === "over" ? tryOver : tryUnder;
        if (!winner) continue;
        consideredCount++;
        if (pickSide === "over") overs.push(winner);
        else unders.push(winner);
      }
    }

    // Quality floor. A pick has to clear this on true EV to reach the board.
    //
    // Publishing five picks every day regardless of price is how the board ended
    // up averaging -5.3% EV — almost exactly the vig, which is the expected
    // result of ranking the market's own de-vigged opinion against the market's
    // own price. Fewer honest picks beat five bad ones, so a short board (or an
    // empty one) is a valid, truthful output.
    const qualified = (p: PinnedProp) =>
      p.evPercentage >= MIN_EV && p.fairProb >= MIN_PROB;
    const overs2 = overs.filter(qualified).sort((a, b) => b.score - a.score);
    const unders2 = unders.filter(qualified).sort((a, b) => b.score - a.score);
    overs.length = 0;
    overs.push(...overs2);
    unders.length = 0;
    unders.push(...unders2);

    // Fill the board respecting both the Under limit and the per-market cap.
    const picks: PinnedProp[] = [];
    const perMarket = new Map<string, number>();
    let underCount = 0;

    const tryTake = (p: PinnedProp, ignoreMarketCap = false): boolean => {
      if (picks.length >= TARGET) return false;
      // One pick per player, enforced here rather than at build time so a
      // player's best prop across ALL markets competes for the slot.
      if (seenPlayer.has(p.playerName)) return false;
      if (p.side === "under" && underCount >= MAX_UNDERS) return false;
      const used = perMarket.get(p.market) ?? 0;
      if (!ignoreMarketCap && used >= MAX_PER_MARKET) return false;
      picks.push(p);
      seenPlayer.add(p.playerName);
      perMarket.set(p.market, used + 1);
      if (p.side === "under") underCount++;
      return true;
    };

    // Overs first (board stays Over-weighted), then the strongest Unders.
    for (const p of overs) tryTake(p);
    for (const p of unders) tryTake(p);

    // If the cap left the board short — e.g. a thin slate where only one or
    // two markets have any props at all — backfill ignoring the market cap.
    // A full board of one market beats a half-empty board.
    //
    // Note this still only takes picks that cleared MIN_EV, so backfilling can
    // no longer pad the board with negative-EV plays just to reach five.
    if (picks.length < TARGET) {
      for (const p of [...overs, ...unders]) {
        if (picks.length >= TARGET) break;
        if (picks.some((x) => x.key === p.key)) continue;
        tryTake(p, true);
      }
    }

    const board: PinnedBoard = {
      sport,
      date: today,
      window: windowIdx,
      picks: picks.slice(0, TARGET),
      generatedAt: new Date().toISOString(),
      considered: consideredCount,
      qualified: overs.length + unders.length,
    };

    // Pin whenever we actually priced props, even if none qualified: "we looked
    // at 180 props and none cleared the bar" is a real answer for this window
    // and must stay stable for everyone. Only a slate we couldn't price at all
    // (considered === 0, i.e. upstream fetch failure) is left unpinned so the
    // next request retries.
    if (consideredCount > 0) await cloudSet(cacheKey, board);

    return NextResponse.json({ ok: true, ...board, cached: false });
  } catch (error: any) {
    console.error("pinned-props error:", error);
    return NextResponse.json({ ok: false, picks: [], error: error?.message });
  }
}
