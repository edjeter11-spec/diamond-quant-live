import { NextRequest, NextResponse } from "next/server";
import { cloudGet, cloudSet } from "@/lib/supabase/client";
import { etDateString } from "@/lib/sports-date";
import { getUserFromRequest } from "@/lib/supabase/server-auth";

/**
 * Truncate the board for non-subscribers and report what was withheld, so the
 * UI can show an accurate "N more picks" prompt without ever receiving them.
 */
function gate<T extends { picks: any[] }>(
  board: T,
  isPremium: boolean,
): T & { locked: number; isPremium: boolean } {
  if (isPremium) return { ...board, locked: 0, isPremium: true };
  const total = board.picks.length;
  return {
    ...board,
    picks: board.picks.slice(0, FREE_PICKS),
    locked: Math.max(0, total - FREE_PICKS),
    isPremium: false,
  };
}

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

// 3, not 5.
//
// The 7-day props record was 54.6% and STILL -6.03 units — winning more than
// half and losing money, because slots 4 and 5 were being filled with whatever
// cleared a -8% floor rather than with plays worth publishing. Fewer picks at
// better prices is the fix; a short board is a feature, not a gap.
const TARGET = 3; // pinned picks per day

// How many picks a non-subscriber receives. The rest are never serialised
// into the response.
//
// This was previously enforced only in the browser — `picks.slice(0, 5)` in
// TodayPropPicks — while the API sent the full board to everyone. The locked
// picks were one devtools Network tab away, so the paid tier gated nothing.
// Truncating here is the only version of this that actually holds.
const FREE_PICKS = 2;
const MAX_UNDERS = 2; // keep the board Over-weighted, as before
const REFRESH_HOURS = 3;

// Minimum true EV (%) for a prop to reach the board.
//
// Was -8, set back when fairProb was de-vigged MARKET consensus — comparing
// the market to itself, which is negative by construction, so a permissive
// floor was the only way to have a board at all.
//
// That reason is gone: props now carry an independent projection, so EV is a
// real comparison and a negative number means we genuinely think the price is
// bad. Publishing those was the mechanism behind 54.6% wins and -6.03 units.
//
// -2 rather than 0: at -110 the vig is ~4.5%, so demanding strictly positive
// EV against our own model would empty the board most nights and pretend to a
// precision the model doesn't have (+0.77% skill, not +10%). This clears the
// genuinely bad prices without inventing certainty.
const MIN_EV = -2;

// Minimum win probability (%) for a prop to reach the board.
//
// Ranking purely on EV surfaces plus-money longshots — the best-priced play on
// 2026-07-30 was +290 at 25.6% to hit. That's correct on EV and still wrong for
// a daily board: five picks that lose three nights in four read as broken no
// matter how sound the pricing. This keeps the board to plays that are more
// likely than not, and EV ranks within that set.
const MIN_PROB = 50;

// Maximum believable EV. Anything above this is the MODEL being wrong, not the
// market — books price mainstream MLB props tightly, and a genuine 20%+ edge
// on a liquid market essentially does not exist. Every time this fired during
// development it was a bug: first the binomial inflating RBI probabilities
// (+48.3% on CJ Abrams), then a 14-game rookie sample (+21.8%). Publishing
// those would be the most damaging thing this board could do, so they are
// dropped rather than shown. If this rejects everything, the honest output is
// a short board.
const MAX_EV = 15;

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

/**
 * ET hour of today's earliest first pitch, or null if we can't determine it.
 *
 * Read from the free MLB Stats API rather than hardcoded, because slates vary
 * a lot — a 1:05pm getaway day and a 10:10pm West Coast opener need different
 * lock times, and a hardcoded 6pm would either freeze an afternoon board
 * hours late or an evening board hours early.
 *
 * Returning null on any failure is deliberate: the caller then keeps its
 * normal rolling window, so a flaky upstream degrades to today's behaviour
 * instead of freezing the board at whatever window happened to be current.
 */
const firstPitchCache = new Map<string, { at: number; hour: number | null }>();

async function getFirstPitchHourET(sport: string): Promise<number | null> {
  if (sport !== "mlb") return null;
  const day = etDateString();
  const hit = firstPitchCache.get(day);
  // Cache for an hour — a schedule doesn't move, and this runs on every
  // board request.
  if (hit && Date.now() - hit.at < 3_600_000) return hit.hour;

  try {
    const r = await fetch(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${day}`,
      { signal: AbortSignal.timeout(6000) },
    );
    if (!r.ok) return null;
    const d = await r.json();
    const games = d?.dates?.[0]?.games ?? [];
    const times = games
      .map((g: any) => new Date(g.gameDate).getTime())
      .filter((t: number) => Number.isFinite(t));
    if (!times.length) {
      firstPitchCache.set(day, { at: Date.now(), hour: null });
      return null;
    }
    const earliest = new Date(Math.min(...times));
    const hour = Number(
      earliest.toLocaleString("en-US", {
        timeZone: "America/New_York",
        hour: "2-digit",
        hour12: false,
      }),
    );
    const out = Number.isFinite(hour) ? hour : null;
    firstPitchCache.set(day, { at: Date.now(), hour: out });
    return out;
  } catch {
    return null;
  }
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

  // Resolved server-side from user_profiles. An unauthenticated or free user
  // gets a truncated board — the withheld picks are never serialised, so
  // there's nothing to recover from the network tab.
  const viewer = await getUserFromRequest(req);
  const isPremium = !!viewer?.isPremium;

  // Which refresh window are we in? Same board for everyone inside it.
  const hourET = Number(
    new Date().toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      hour12: false,
    }),
  );
  // Stop rebuilding once the slate is underway.
  //
  // The window rolls every 3 hours so the board can pick up genuinely better
  // value during the morning. But with a 6:40pm first pitch, the 9pm roll was
  // rebuilding against a slate already half-played: it would swap in picks for
  // games nobody can bet, and those picks still get logged and graded. A
  // published position has to stop moving when the games start.
  //
  // Freezing at the last pre-game window means the board a reader saw before
  // first pitch is the board that gets graded — which is also the only version
  // of a track record that means anything.
  let windowIdx = Math.floor(hourET / REFRESH_HOURS);
  const firstPitchHourET = await getFirstPitchHourET(isNBA ? "nba" : "mlb");
  if (firstPitchHourET !== null) {
    // The last window that ENDS at or before first pitch — the last one lying
    // entirely in pre-game time.
    //
    // The -1 matters. floor(fp / REFRESH) is the window CONTAINING first
    // pitch: for a 6:40pm start that's window 6 (18:00-20:59), so locking to
    // it would still rebuild at 6pm, 7pm and 8pm, after the games began.
    // Stepping back one window guarantees the board stops moving before any
    // game starts, at every slate time from a noon getaway day to a 10pm West
    // Coast opener (verified across 11:00-22:00 first pitches).
    const lockedWindow = Math.floor(firstPitchHourET / REFRESH_HOURS) - 1;
    if (windowIdx > lockedWindow) windowIdx = Math.max(0, lockedWindow);
  }
  // v2: bumped when MLB projections landed. A board pinned by the previous
  // deploy was built from market-devig probabilities, so without this bump it
  // would stay frozen for the rest of the window and the model's picks would
  // never appear.
  const cacheKey = `pinned_props_v4_${sport}_${today}_w${windowIdx}`;

  if (!force) {
    const cached = await cloudGet<PinnedBoard | null>(cacheKey, null);
    if (cached?.picks?.length) {
      return NextResponse.json({
        ok: true,
        ...gate(cached, isPremium),
        cached: true,
      });
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
      p.evPercentage >= MIN_EV &&
      p.evPercentage <= MAX_EV &&
      p.fairProb >= MIN_PROB;
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

    return NextResponse.json({
      ok: true,
      ...gate(board, isPremium),
      cached: false,
    });
  } catch (error: any) {
    console.error("pinned-props error:", error);
    return NextResponse.json({ ok: false, picks: [], error: error?.message });
  }
}
