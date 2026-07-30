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
}

function build(prop: any, side: "over" | "under"): PinnedProp | null {
  const best = side === "over" ? prop.bestOver : prop.bestUnder;
  if (!best?.price) return null;
  const marketFair =
    side === "over" ? (prop.fairOverProb ?? 50) : (prop.fairUnderProb ?? 50);
  const brainFair = side === "over" ? prop.brainOverProb : prop.brainUnderProb;
  const usesBrain = typeof brainFair === "number" && brainFair > 0;
  const fair = usesBrain ? brainFair : marketFair;
  const implied = americanImplied(best.price) * 100;
  const ev = fair - implied;
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
    score: fair - 50 + ev * 0.5 + (usesBrain ? 0.5 : 0),
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
        if (pickSide === "over") overs.push(winner);
        else unders.push(winner);
      }
    }

    overs.sort((a, b) => b.score - a.score);
    unders.sort((a, b) => b.score - a.score);

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
    };

    // Only pin a board that actually has picks — caching an empty one would
    // freeze the panel blank for the rest of the window.
    if (board.picks.length > 0) await cloudSet(cacheKey, board);

    return NextResponse.json({ ok: true, ...board, cached: false });
  } catch (error: any) {
    console.error("pinned-props error:", error);
    return NextResponse.json({ ok: false, picks: [], error: error?.message });
  }
}
