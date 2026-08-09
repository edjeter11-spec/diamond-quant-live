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
// Was 2, to keep the board Over-weighted for readability. That cap made sense
// when fairProb was market devig and the sides were interchangeable noise; it
// actively hurts now. On 2026-08-04, 24 of 28 qualifying sides were UNDERS and
// the cap plus the over-bias tiebreak below reduced a 28-candidate slate to a
// 2-pick board. Let the model pick the side it actually likes.
const MAX_UNDERS = 3;
const REFRESH_HOURS = 3;

// How long before the day's first game the board is allowed to build.
//
// Confirmed lineups post 2-4h out, and prop prices sharpen through the day,
// so building earlier than this prices against soft, lineup-blind numbers.
// 3h lands just inside the lineup window for all three sports.
const LINEUP_LEAD_HOURS = 3;

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
// -3.5, tightened from -5 (which was itself relaxed from -2 when fairProb
// became the projection shrunk 75% toward consensus — see W_BRAIN).
//
// -5 was chosen to keep the board from emptying, and it worked — by
// publishing plays we ourselves priced as losers. On 2026-08-07 it put a
// -3.1% and a -4.8% prop on the board while the sharp-anchor scanner had
// three POSITIVE-EV moneylines available (now added above). "EV ≈ -vig is
// normal" is true and is exactly the point: paying full vig with no edge is
// a losing bet, and a short honest board beats a padded losing one.
const MIN_EV = -3.5;

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
  player_pass_yds: "Pass Yds",
  player_pass_tds: "Pass TDs",
  player_rush_yds: "Rush Yds",
  player_receptions: "Receptions",
  player_reception_yds: "Rec Yds",
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
// Attempt-count markets (player_pass_attempts, player_rush_attempts) are
// deliberately left off this public board. They're live on The Odds API and
// nfl-prop-projector.ts already prices them, but "Over 24.5 Pass Attempts" is
// a worse read for a casual visitor than yards/TDs/receptions — a curation
// choice, not a gap.
const NFL_MARKETS = [
  "player_pass_yds",
  "player_pass_tds",
  "player_rush_yds",
  "player_receptions",
  "player_reception_yds",
];

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

/** ESPN scoreboard paths for the sports that aren't MLB. */
const ESPN_SCOREBOARD: Record<string, string> = {
  nba: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
  nfl: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
};

async function getFirstPitchHourET(sport: string): Promise<number | null> {
  const day = etDateString();
  // Keyed by SPORT AND DAY. Keying on the day alone made all three sports
  // share one entry, and cron publishes mlb/nba/nfl in parallel — so whichever
  // resolved first won the cache for the others. Out of basketball/football
  // season NBA and NFL have no games, cache hour:null, and MLB then read that
  // null and skipped its lineup gate entirely: the board pinned at the 4am
  // tick for a 12pm first pitch, ~8h before any lineup was confirmed. That is
  // why picks were published at 4:15am despite the gate being correct.
  const cacheKey = `${sport}_${day}`;
  const hit = firstPitchCache.get(cacheKey);
  // Cache for an hour — a schedule doesn't move, and this runs on every
  // board request.
  if (hit && Date.now() - hit.at < 3_600_000) return hit.hour;

  // NBA / NFL via ESPN. Without this the function returned null for every
  // non-MLB sport, which meant those boards had NO earliest-build floor and
  // NO pre-game lock: the 3h window kept rolling after tip-off, so picks
  // could change mid-game (site diverging from what Discord published), and
  // once games were live /api/players returned no pre-match props at all —
  // so the evening window pinned an EMPTY board.
  if (sport === "nba" || sport === "nfl") {
    try {
      const url = `${ESPN_SCOREBOARD[sport]}?dates=${day.replace(/-/g, "")}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) return null;
      const d = await r.json();
      const times = (d?.events ?? [])
        .map((e: any) =>
          new Date(e?.date ?? e?.competitions?.[0]?.date).getTime(),
        )
        .filter((t: number) => Number.isFinite(t));
      if (!times.length) {
        firstPitchCache.set(cacheKey, { at: Date.now(), hour: null });
        return null;
      }
      const hour = Number(
        new Date(Math.min(...times)).toLocaleString("en-US", {
          timeZone: "America/New_York",
          hour: "2-digit",
          hour12: false,
        }),
      );
      const out = Number.isFinite(hour) ? hour : null;
      firstPitchCache.set(cacheKey, { at: Date.now(), hour: out });
      return out;
    } catch {
      return null;
    }
  }

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
      firstPitchCache.set(cacheKey, { at: Date.now(), hour: null });
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
    firstPitchCache.set(cacheKey, { at: Date.now(), hour: out });
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
  /** EV of this same price against the de-vigged BOOK CONSENSUS rather than
   *  our projection — i.e. is the price off-market, independent of our model? */
  marketEv: number;
  /** marketEv > 0. Model-independent evidence of value. */
  beatsMarket: boolean;
  score: number;
  label: string;
  usesBrain: boolean;
  projectedValue?: number;
  /** Graded outcome, joined in from manual_picks at read time (the pinned
   *  board blob itself is never rewritten). Undefined = not graded yet. */
  result?: string;
  profitUnits?: number | null;
}

/**
 * Attach graded outcomes to a pinned board's picks.
 *
 * The board is pinned to a cloud blob and never rewritten, while grading
 * happens entirely in `manual_picks` (see /api/post-results). Nothing joined
 * the two, so a graded pick still rendered as ungraded on the site long after
 * its recap posted to Discord.
 *
 * The join key is publish-daily's exact pick_text format:
 *   `${playerName} ${Over|Under} ${line} ${MARKET_LABEL[market]}`
 * reconstructed here from the same MARKET_LABEL map, so it's an exact-string
 * match. A pick with no matching row (or one still ungraded) keeps
 * `result: undefined` and renders as pending, exactly as before.
 */
async function attachResults(
  board: PinnedBoard,
  sport: string,
): Promise<PinnedBoard> {
  try {
    const { supabaseAdmin } = await import("@/lib/supabase/server-auth");
    if (!supabaseAdmin) return board;
    const { data } = await supabaseAdmin
      .from("manual_picks")
      .select("pick_text,result,profit_units")
      .eq("sport", sport)
      .eq("slate_date", board.date)
      .eq("status", "published")
      .not("result", "is", null);
    if (!data?.length) return board;
    const byText = new Map(
      data.map((r: any) => [String(r.pick_text).trim(), r]),
    );
    return {
      ...board,
      picks: board.picks.map((p) => {
        const key =
          `${p.playerName} ${p.side === "over" ? "Over" : "Under"} ` +
          `${p.line} ${MARKET_LABEL[p.market] ?? p.market}`;
        const hit = byText.get(key.trim());
        return hit
          ? { ...p, result: hit.result, profitUnits: hit.profit_units }
          : p;
      }),
    };
  } catch {
    // Grading display is additive — never let it break the board itself.
    return board;
  }
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

  // Shrink the projection toward market consensus instead of trusting it raw.
  //
  // Evidence, both markets, same verdict:
  //  - Moneylines: 434 priced picks, best market-blend weight for the model
  //    was w=0.20 (scripts/refit-calibration.mts).
  //  - Props: the graded record realized ≈ -4.6% EV — almost exactly where
  //    CONSENSUS priced those picks (-6.5%), nowhere near the +10% the raw
  //    projection claimed.
  // The projection still adds player-specific information the market prices
  // lazily (that's the 25%), but the market carries the number. This is what
  // stops the board displaying 10% edges that don't exist.
  const W_BRAIN = 0.25;
  const fair = usesBrain
    ? W_BRAIN * brainFair + (1 - W_BRAIN) * marketFair
    : marketFair;
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

  // Price-vs-market check — the lesson from the moneyline backtest, applied
  // to props.
  //
  // That backtest showed our model's probability, on its own, is not evidence
  // of value: it ran 6-13 points hot, and picks where the model "found edge"
  // by disagreeing with the market lost money in every bucket. The props
  // record says the same thing from the other direction — 54.6% winners but
  // -6.03u, i.e. right players, wrong prices.
  //
  // marketEv re-prices the same bet using the DE-VIGGED CONSENSUS of the books
  // instead of our projection. It answers: is this price off-market, or does
  // it only look good because our model says so?
  //
  //   marketEv > 0  → the book we're taking is offering better than the rest
  //                   of the market. Real, model-independent value.
  //   marketEv < 0  → every book agrees this price is bad, and the only thing
  //                   claiming +EV is us.
  //
  // Kept as a field rather than a hard filter: MIN_EV still governs what makes
  // the board, and `score` now demotes model-only picks instead of banning
  // them. A hard cut here would empty the board on days when no book is off
  // consensus, which is most days.
  const marketEv =
    ((marketFair / 100) * americanToDecimal(best.price) - 1) * 100;
  const beatsMarket = marketEv > 0;

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
    marketEv: Math.round(marketEv * 10) / 10,
    beatsMarket,
    // Rank on EV. The small probability term is a tie-breaker only (0.05/pt, so
    // a full 20-point probability gap moves score by 1.0) — enough to prefer the
    // likelier of two equally-priced plays without letting probability dominate
    // price the way it used to.
    //
    // The +1.5 for beating consensus is the biggest non-EV term by design: a
    // price that's off-market is evidence from outside our model, and the
    // backtest was unambiguous that outside evidence is worth more than our
    // own confidence. It's a thumb on the scale, not a veto — enough to break
    // ties toward genuinely off-market prices and push model-only picks down
    // the board.
    score:
      ev + (fair - 50) * 0.05 + (usesBrain ? 0.5 : 0) + (beatsMarket ? 1.5 : 0),
    label: MARKET_LABEL[prop.market] ?? prop.market,
    usesBrain,
    projectedValue: prop.brainProjectedValue,
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sport = (searchParams.get("sport") ?? "mlb").toLowerCase();
  const force = searchParams.get("force") === "true";
  // Only these three have a props pipeline. Without this guard an unknown
  // sport fell through the isNBA/isNFL ternaries to baseball_mlb and got an
  // MLB board back under its own name — /api/pinned-props?sport=nhl was
  // already returning MLB's build hour. Refuse rather than mislabel.
  if (!["mlb", "nba", "nfl"].includes(sport)) {
    return NextResponse.json({
      ok: true,
      sport,
      date: etDateString(),
      picks: [],
      locked: 0,
      considered: 0,
      qualified: 0,
      message: `No player props pipeline for ${sport.toUpperCase()}.`,
    });
  }
  const isNBA = sport === "nba";
  const isNFL = sport === "nfl";
  const today = etDateString();

  // Resolved server-side from user_profiles. An unauthenticated or free user
  // gets a truncated board — the withheld picks are never serialised, so
  // there's nothing to recover from the network tab.
  const viewer = await getUserFromRequest(req);
  // The internal publish-daily fetch carries the cron secret and no user, so
  // it would otherwise be treated as a free viewer and receive only
  // FREE_PICKS. That meant Discord posted — and grading logged — just 2 of a
  // 3-pick board, and premium site users' third pick showed "pending"
  // forever with no row to grade. The cron secret is a full-board bypass:
  // it's the SERVER building the canonical board, not a user viewing it.
  const cronSecret =
    req.headers.get("x-cron-secret") === process.env.CRON_SECRET;
  const isPremium = cronSecret || !!viewer?.isPremium;

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
  // getFirstPitchHourET now covers all three sports (MLB via statsapi,
  // NBA/NFL via ESPN). It returns null only when the schedule fetch FAILS or
  // the sport has no games today — see the null branch below, which must not
  // fork the day's board.
  const firstPitchHourET = await getFirstPitchHourET(
    isNBA ? "nba" : isNFL ? "nfl" : "mlb",
  );
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

    // Don't BUILD the board before lineups have had a chance to confirm.
    //
    // Confirmed lineups post 2-4h before first pitch, and prop consensus
    // sharpens through the day as money and information hit the market — a
    // board built at 7am for a 7pm slate is pricing against a soft,
    // lineup-blind number.
    //
    // This used to clamp `windowIdx` to floor((fp-3)/REFRESH). That was a
    // NO-OP: floor((fp-3)/3) === floor(fp/3)-1 === lockedWindow for every
    // first-pitch hour, so it only renamed the cache key while the board
    // still pinned at the first request of the day. The gate has to be on
    // the CLOCK, not the window index.
    //
    // Returning an unpinned empty board (rather than pinning an early one)
    // is what makes "picks are chosen shortly before games start" true:
    // nothing is written to the blob, so no early board can be published or
    // cached. Callers already render the empty state.
    const buildFromHourET = firstPitchHourET - LINEUP_LEAD_HOURS;
    if (hourET < buildFromHourET) {
      return NextResponse.json({
        ok: true,
        sport,
        date: today,
        picks: [],
        locked: 0,
        isPremium,
        considered: 0,
        qualified: 0,
        notYet: true,
        buildsAtHourET: buildFromHourET,
        message: `Board builds around ${buildFromHourET}:00 ET, once lineups are confirmed.`,
      });
    }
  }
  // v2: bumped when MLB projections landed. A board pinned by the previous
  // deploy was built from market-devig probabilities, so without this bump it
  // would stay frozen for the rest of the window and the model's picks would
  // never appear.
  const cacheKey = `pinned_props_v4_${sport}_${today}_w${windowIdx}`;

  if (!force) {
    const cached = await cloudGet<PinnedBoard | null>(cacheKey, null);
    if (cached?.picks?.length) {
      const withResults = await attachResults(cached, sport);
      return NextResponse.json({
        ok: true,
        ...gate(withResults, isPremium),
        cached: true,
      });
    }
  }

  try {
    const baseUrl =
      process.env.NODE_ENV === "development"
        ? req.nextUrl.origin
        : "https://diamond-quant-live.vercel.app";
    const sportKey = isNBA
      ? "basketball_nba"
      : isNFL
        ? "americanfootball_nfl"
        : "baseball_mlb";
    const markets = isNBA ? NBA_MARKETS : isNFL ? NFL_MARKETS : MLB_MARKETS;

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

        // Take whichever side actually scores better.
        //
        // This used to spot the Over a 3-point handicap, from when fairProb was
        // market devig and the two sides were interchangeable noise — a
        // cosmetic preference for a board that reads as "overs". With a real
        // projection behind it that handicap discards genuinely better picks:
        // on 2026-08-04 it took an Over at +0.3% EV over an Under the model
        // liked more, and combined with MAX_UNDERS left a 28-candidate slate
        // producing 2 picks.
        const pickSide = forceOver
          ? "over"
          : tryOver && tryUnder
            ? tryOver.score >= tryUnder.score
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

    // ── Sharp-anchor moneylines (MLB) ──
    //
    // The props board can only ever be as good as the prop market, and on a
    // normal day that market is efficient: every candidate prices at roughly
    // -vig, so the "best" board is a set of -3% to -5% EV plays. On
    // 2026-08-07 the entire 124-prop pool topped out at -2.5% while
    // /api/edge-scan simultaneously found three genuinely POSITIVE-EV
    // moneylines against Pinnacle's de-vigged fair price. Publishing the
    // negative-EV props and ignoring the positive-EV moneylines was strictly
    // the wrong call.
    //
    // These are the only picks in the app with a mathematically grounded
    // edge (no in-house model involved — see the 449-pick backtest that put
    // the moneyline model at -7.69% ROI), so they belong at the TOP of the
    // board, not as filler. Failures are swallowed: a board of props alone
    // is the previous behaviour, which is an acceptable fallback.
    if (!isNBA && !isNFL) {
      try {
        const r = await fetch(`${baseUrl}/api/edge-scan?minEv=0.5`, {
          signal: AbortSignal.timeout(15000),
        });
        if (r.ok) {
          const d = await r.json();
          for (const e of (d.edges ?? []).slice(0, 2)) {
            picks.unshift({
              key: `ml-${e.gameId}-${e.side}`,
              // The TEAM, not a player. Consumers must branch on
              // market === "moneyline" before rendering this as a player prop
              // — publish-daily and TodayPropPicks already do. `side`/`line`
              // are structurally meaningless here and exist only because the
              // PinnedProp shape requires them; nothing may render them.
              playerName: e.side,
              team: e.game,
              side: "over",
              line: 0,
              market: "moneyline",
              odds: e.price,
              bookmaker: e.book,
              fairProb: e.fairProb,
              evPercentage: e.evPct,
              // vs Pinnacle's de-vigged price, which IS the market check.
              marketEv: e.evPct,
              beatsMarket: true,
              score: 100 + e.evPct, // always outranks a -EV prop
              label: "Moneyline",
              usesBrain: false,
            });
          }
        }
      } catch {
        /* props-only board is a fine fallback */
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

    // Log each newly-pinned pick for CLV grading — the real accuracy metric.
    // marketFair at post time is the entry price; /api/cron snapshots the
    // SAME player+market+line's consensus again right before first pitch as
    // the closer. If our picks consistently beat the close, the board has
    // real predictive value independent of win/loss (which needs ~1000 picks
    // to resolve instead of ~50). Only logs on the FIRST time a pick is
    // pinned (new cacheKey write), so re-fetches of an already-built window
    // don't duplicate entries.
    if (consideredCount > 0 && board.picks.length > 0) {
      try {
        const clvLog = (await cloudGet<any[]>("props_clv_log", [])) ?? [];
        const existingIds = new Set(clvLog.map((e) => e.id));
        for (const p of board.picks) {
          // Props only. The sharp-anchor moneylines on this board have no
          // player/line, and the closer pass resolves entries by re-fetching
          // /api/players?market=<market> — which has no "moneyline" market and
          // can never match them. Logged moneylines therefore stayed pending
          // forever, and every cron tick re-fetched a market for them,
          // burning Odds API calls for a closer that cannot exist.
          // Moneyline CLV is already captured by its own block in cron.
          if (p.market === "moneyline" || !p.playerName || p.line == null)
            continue;
          const id = `${today}|${p.key}`;
          if (existingIds.has(id)) continue;
          clvLog.push({
            id,
            postedAt: new Date().toISOString(),
            playerName: p.playerName,
            market: p.market,
            side: p.side,
            line: p.line,
            entryFairProb: p.fairProb,
            entryOdds: p.odds,
            entryBook: p.bookmaker,
          });
        }
        await cloudSet("props_clv_log", clvLog.slice(-500));
      } catch {
        // CLV logging is bookkeeping — never let it break the board response.
      }
    }

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
