import { NextRequest, NextResponse } from "next/server";
import { cloudGet, cloudSet } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface ParlayLeg {
  id: string;
  game: string;
  pick: string;
  market: string;
  odds: number;
  bookmaker: string;
  evPercentage: number;
  fairProb: number;
  /** This book's price beats the de-vigged consensus of the others — value
   *  that holds regardless of whether our projection is right. */
  beatsMarket?: boolean;
  confidence: string;
  commenceTime?: string;
  dayLabel?: string;
  /** Why this leg made the ticket — shown in the UI dropdown, same as props. */
  reasoning?: string[];
}

interface PinnedParlay {
  sport: "nba" | "mlb";
  date: string; // ET date: YYYY-MM-DD
  legs: ParlayLeg[];
  totalOdds: number;
  generatedAt: string;
  /** Every leg clears the vig. False = best-available, not a real edge. */
  hasPositiveEv?: boolean;
  lockedUntil: string;
  dayLabel: string; // "Today" or "Tomorrow" etc
  /** Legs formatted for paste into playbookbot.com's web input. */
  playbookText?: string;
}

// ET date (sports day). After midnight ET, counts as the next day.
function etDateString(d = new Date()): string {
  const et = new Date(
    d.toLocaleString("en-US", { timeZone: "America/New_York" }),
  );
  return `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, "0")}-${String(et.getDate()).padStart(2, "0")}`;
}

function etDateOf(iso: string): string {
  return etDateString(new Date(iso));
}

function scorePick(p: {
  confidence: string;
  evPercentage?: number;
  beatsMarket?: boolean;
}): number {
  const confScore =
    p.confidence === "HIGH"
      ? 3
      : p.confidence === "MEDIUM"
        ? 2
        : p.confidence === "LOW"
          ? 1
          : 0;
  // beatsMarket bonus: this leg's book is offering better than the de-vigged
  // consensus of the others. Weighted heavier here than on the props board
  // (2.0 vs 1.5) because parlay legs MULTIPLY — a leg taken at a below-market
  // price doesn't just cost its own edge, it drags the whole ticket, and the
  // props record (54.6% winners, -6.03u) is what losing on price looks like.
  return confScore * 5 + (p.evPercentage ?? 0) + (p.beatsMarket ? 2 : 0);
}

function formatAmerican(odds: number): string {
  return odds > 0 ? `+${odds}` : String(odds);
}

function americanToDecimalOdds(odds: number): number {
  return odds > 0 ? odds / 100 + 1 : 100 / Math.abs(odds) + 1;
}

function toAmericanParlay(legs: ParlayLeg[]): number {
  const decimal = legs.reduce(
    (acc, p) => acc * americanToDecimalOdds(p.odds),
    1,
  );
  return decimal >= 2
    ? Math.round((decimal - 1) * 100)
    : Math.round(-100 / (decimal - 1));
}

// "Parlay of the Day" is meant to be a simple, boostable 3-4 leg builder —
// short favorites/light dogs that compound to roughly -100 to +150, not a
// long-shot ticket. Filtering candidates to individually-reasonable prices
// up front (rather than picking the highest-EV leg regardless of price and
// letting the product multiply out to +700+) keeps the final number sane.
const MIN_LEG_ODDS = -260; // don't include heavy chalk that adds no payout
const MAX_LEG_ODDS = 180; // don't include a longshot that blows up the parlay
const TARGET_MAX_AMERICAN = 150;

// Prop legs get a higher price ceiling than game lines. A flat +180 cap meant
// every plus-money prop market (HR, steals, and most RBI/runs lines sit +200
// to +600) was filtered out before scoring, so no matter how the model priced
// them the parlay could only ever be built from Hits/Ks/Total Bases — which is
// exactly the "always Over 0.5 Hits" behaviour. The compounded-odds ceiling
// (TARGET_MAX_AMERICAN, enforced in tryAdd) still keeps the final ticket sane,
// so a single pricier leg can be included when it's genuinely the best value.
const MAX_PROP_LEG_ODDS = 400;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sport = (searchParams.get("sport") ?? "mlb").toLowerCase() as
    "nba" | "mlb";
  const force = searchParams.get("force") === "true";
  const isNBA = sport === "nba";
  const today = etDateString();
  const cacheKey = `parlay_today_${sport}_${today}`;

  // Return cached pinned parlay unless forced
  if (!force) {
    const cached = await cloudGet<PinnedParlay | null>(cacheKey, null);
    if (cached?.legs?.length) {
      return NextResponse.json({ ok: true, ...cached, cached: true });
    }
  }

  try {
    // Use the incoming request's own origin so local dev calls local dev
    // instead of reaching out to production over the real internet (that
    // was silently true before — every local /api/parlay-today request
    // was calling https://diamond-quant-live.vercel.app internally, which
    // hangs for minutes whenever prod is slow/cold/rate-limited).
    const baseUrl =
      process.env.NODE_ENV === "development"
        ? req.nextUrl.origin
        : "https://diamond-quant-live.vercel.app";
    const sportKey = isNBA ? "basketball_nba" : "baseball_mlb";

    // Fetch odds (contains evBets with confidence/EV). When the odds source
    // is empty (Odds API exhausted), we fall through to the player-prop
    // candidates below — a parlay built entirely from props is still a parlay.
    let games: any[] = [];
    try {
      const oddsRes = await fetch(`${baseUrl}/api/odds?sport=${sportKey}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (oddsRes.ok) {
        const oddsData = await oddsRes.json();
        games = oddsData.games ?? [];
      }
    } catch {}

    // Build candidate picks from evBets, carrying commenceTime for day filtering
    type Candidate = ParlayLeg & { day: string };
    const candidates: Candidate[] = [];
    for (const g of games) {
      const gameDay = g.commenceTime ? etDateOf(g.commenceTime) : today;
      for (const bet of g.evBets ?? []) {
        if (!bet.odds || bet.isSuspicious) continue;
        candidates.push({
          id: `${g.id}-${bet.pick}-${bet.bookmaker}`,
          game: bet.game || `${g.awayTeam} @ ${g.homeTeam}`,
          pick: bet.pick,
          market: bet.market,
          odds: bet.odds,
          bookmaker: bet.bookmaker,
          evPercentage: bet.evPercentage ?? 0,
          fairProb: bet.fairProb ?? 50,
          confidence: bet.confidence ?? "LOW",
          commenceTime: g.commenceTime,
          day: gameDay,
        });
      }
    }

    // Choose target day: today if any today games, else earliest future day
    const todayCandidates = candidates.filter((c) => c.day === today);
    const targetDay =
      todayCandidates.length > 0
        ? today
        : ([...new Set(candidates.map((c) => c.day))].sort()[0] ?? today);
    const dayLabel = targetDay === today ? "Today" : "Tomorrow";

    // ── Model-backed moneylines ──
    //
    // The game lines above come from evBets, whose fairProb is de-vigged
    // MARKET consensus — the market compared to itself. The three-model
    // engine (lib/bot/three-models.ts) produces an INDEPENDENT probability and
    // backtests at 62% accuracy / +5.5% skill across 2024 and 2025, roughly 7x
    // the prop model's edge. Those are the game lines worth a parlay slot.
    //
    // Deliberately additive: moneylines compete for slots on merit, they don't
    // displace props, and nothing about the two records is merged — the
    // moneyline model is still unproven forward (4 graded picks so far), so
    // its performance stays separately tracked in bot_picks until it earns
    // otherwise.
    try {
      const r = await fetch(`${baseUrl}/api/bot-analysis`, {
        signal: AbortSignal.timeout(15000),
      });
      if (r.ok) {
        const analyses = (await r.json())?.analyses ?? [];
        const { generateSmartPicks } = await import("@/lib/bot/smart-picks");
        for (const p of generateSmartPicks(analyses, 5000)) {
          // Only the confident ones. The backtest's edge concentrates hard in
          // the top band (81% correct at >=8pts of model edge); a coin-flip
          // moneyline in a 3-leg parlay is just a way to lose the other two.
          if (p.confidence === "LOW") continue;
          if (!p.odds || Math.abs(p.odds) > 250) continue;
          candidates.push({
            id: `ml-${p.gameId ?? p.game}-${p.pick}`,
            game: p.game,
            pick: p.pick,
            market: "moneyline",
            odds: p.odds,
            bookmaker: p.bookmaker ?? "",
            evPercentage: p.evPercentage ?? 0,
            fairProb: p.consensusProb ?? 50,
            confidence: p.confidence ?? "MEDIUM",
            commenceTime: undefined,
            day: today,
          } as Candidate);
        }
      }
    } catch {
      /* moneylines are a bonus — a failure here must not empty the parlay */
    }

    let pool = candidates
      .filter((c) => c.day === targetDay)
      .filter(
        (c) =>
          c.confidence === "HIGH" ||
          c.confidence === "MEDIUM" ||
          c.evPercentage > 1,
      )
      .sort((a, b) => scorePick(b) - scorePick(a));

    // Fetch player props as additional mixed candidates (NBA + MLB now).
    // When the odds-side games list is empty, props become the entire parlay.
    const propCandidates: Candidate[] = [];
    const markets = isNBA
      ? [
          { key: "player_points", label: "Points" },
          { key: "player_rebounds", label: "Rebounds" },
          { key: "player_assists", label: "Assists" },
        ]
      : [
          // Widened from 3 markets to the full MLB catalog. Previously only
          // Ks / Hits / Total Bases were even fetched, so "best value today"
          // could never be an RBI, run, steal or HR prop no matter how the
          // model priced it.
          { key: "pitcher_strikeouts", label: "Ks" },
          { key: "batter_hits", label: "Hits" },
          { key: "batter_total_bases", label: "Total Bases" },
          { key: "batter_home_runs", label: "HR" },
          { key: "batter_rbis", label: "RBIs" },
          { key: "batter_runs_scored", label: "Runs" },
          { key: "batter_stolen_bases", label: "Steals" },
          { key: "pitcher_outs", label: "Outs" },
        ];
    await Promise.all(
      markets.map(async ({ key, label }) => {
        try {
          const r = await fetch(
            `${baseUrl}/api/players?sport=${sportKey}&market=${key}`,
            { signal: AbortSignal.timeout(8000) },
          );
          if (!r.ok) return;
          const data = await r.json();
          for (const prop of data.props ?? []) {
            if (!prop.playerName || !prop.line) continue;
            const gameDay = prop.gameTime ? etDateOf(prop.gameTime) : today;
            if (gameDay !== targetDay) continue;
            const overProb = prop.fairOverProb ?? 50;
            const underProb = prop.fairUnderProb ?? 50;
            const favourOver = overProb >= underProb;
            const best = favourOver ? prop.bestOver : prop.bestUnder;
            if (!best?.price) continue;
            const topProb = Math.max(overProb, underProb);
            if (topProb < 55) continue;

            // REAL expected value, priced against what the book is offering.
            //
            // This used to be `(topProb - 50) * 2`, which is just a restatement
            // of the model's probability and ignores the price entirely. Under
            // that formula an 80%-likely Over 0.5 Hits at -250 always outranked
            // a 40%-likely HR at +450, even though the first is roughly break-
            // even and the second is a large edge. That single line is why the
            // parlay was almost always "Over 0.5 Hits".
            //
            // EV% = (p * decimalPayout - 1) * 100, using de-vigged fair prob.
            const decPayout = americanToDecimalOdds(best.price);
            const evPct = (topProb / 100) * decPayout - 1;
            const evPercentage = Math.round(evPct * 100 * 10) / 10;

            // Is the book we're taking actually off-market, or is this price
            // just the least-bad of a uniformly bad set?
            //
            // fairOverProb/fairUnderProb are the DE-VIGGED CONSENSUS across
            // books, so `evPct > 0` here means this specific book pays more
            // than the market's own fair price for the same outcome — value
            // that doesn't depend on any projection being right. When it's
            // <= 0, every book agrees the price is bad. Given the props
            // record is 54.6% winners at -6.03u, that distinction is the one
            // that was missing.
            const beatsMarket = evPct > 0;
            // NOT filtered to positive-EV only. Against real vigged MLB prop
            // prices, most days have nothing genuinely +EV — filtering to
            // ev > 0 left the parlay empty almost every day. Instead every
            // candidate is ranked by this honest number, so the best available
            // value wins regardless of market, and the response carries
            // `hasPositiveEv` so the UI can say plainly when the ticket is
            // "least bad" rather than a real edge.

            propCandidates.push({
              id: `prop-${key}-${prop.playerName}`,
              game: prop.playerName,
              pick: `${prop.playerName} ${favourOver ? "Over" : "Under"} ${prop.line} ${label}`,
              market: "player_prop",
              odds: best.price,
              bookmaker: best.bookmaker,
              evPercentage,
              beatsMarket,
              fairProb: topProb,
              // Confidence still tracks likelihood (how safe the leg is);
              // evPercentage tracks value. scorePick weighs both.
              confidence:
                topProb >= 65 ? "HIGH" : topProb >= 58 ? "MEDIUM" : "LOW",
              commenceTime: prop.gameTime,
              day: gameDay,
            });
          }
        } catch {}
      }),
    );
    propCandidates.sort((a, b) => scorePick(b) - scorePick(a));

    // Rank ALL candidates (game lines + props, any market) by real value —
    // no market-type quota. Previously this grabbed "one moneyline, one
    // spread, one total, one prop" regardless of which was actually the
    // best value, which is how a board full of real-book Unders turned
    // into a parlay that was *only* Unders (whichever total happened to
    // win the "total" slot), and multiplying 3 real-priced legs together
    // with no ceiling produced parlays like +753 under a "Parlay of the
    // Day" banner that's supposed to read as a simple, boostable ticket.
    const allCandidates = [...pool, ...propCandidates]
      .filter((c) => {
        if (c.odds < MIN_LEG_ODDS) return false;
        // Props may be priced higher than game lines — see MAX_PROP_LEG_ODDS.
        const ceiling =
          c.market === "player_prop" ? MAX_PROP_LEG_ODDS : MAX_LEG_ODDS;
        return c.odds <= ceiling;
      })
      .sort((a, b) => scorePick(b) - scorePick(a));

    const legs: ParlayLeg[] = [];
    const usedGames = new Set<string>();
    let runningDecimal = 1;

    const tryAdd = (p: Candidate): boolean => {
      if (legs.length >= 4) return false;
      if (usedGames.has(p.game)) return false;
      // Would this leg push the parlay's compounded odds past the target
      // ceiling? Skip it and keep looking for something that fits — unless
      // we don't have 3 legs yet, in which case take it anyway (having a
      // real 3-leg parlay beats an artificially short one).
      const nextDecimal = runningDecimal * americanToDecimalOdds(p.odds);
      const nextAmerican =
        nextDecimal >= 2
          ? Math.round((nextDecimal - 1) * 100)
          : Math.round(-100 / (nextDecimal - 1));
      // Odds ceiling, applied with a floor on leg count. Previously this only
      // kicked in at 3+ legs, so the first three could compound unchecked (a
      // +110 leg plus two others produced +341 against a +150 target). But
      // enforcing it strictly from leg 2 goes too far the other way: two chalky
      // -250/-200 props already reach +110, leaving no room for a third, and a
      // 2-leg "Parlay of the Day" isn't much of a parlay. So: allow a wider
      // ceiling until we have 3 legs, then hold the line.
      const ceiling =
        legs.length < 3 ? TARGET_MAX_AMERICAN * 2 : TARGET_MAX_AMERICAN;
      if (legs.length >= 2 && nextAmerican > ceiling) return false;

      const { day: _day, ...leg } = p;
      // Build the rationale from the numbers that actually got this leg
      // selected, so the dropdown reflects the real decision rather than
      // generic copy.
      const impliedProb =
        p.odds > 0
          ? (100 / (p.odds + 100)) * 100
          : (-p.odds / (-p.odds + 100)) * 100;
      const reasoning = [
        `Model puts this at ${p.fairProb.toFixed(1)}% to hit — the ${formatAmerican(p.odds)} price on ${p.bookmaker} implies ${impliedProb.toFixed(1)}%.`,
        p.evPercentage > 0
          ? `That's a genuine +${p.evPercentage.toFixed(1)}% edge — the model rates it more likely than the price does.`
          : `Priced at ${p.evPercentage.toFixed(1)}% against the vig — chosen for how often it hits, not for beating the price.`,
        p.market === "player_prop"
          ? "Player prop — projected from this player's form and the matchup."
          : "Game line — model output vs. the market consensus.",
        `Confidence: ${p.confidence} — how likely this leg is to land.`,
      ];
      legs.push({ ...leg, dayLabel, reasoning });
      usedGames.add(p.game);
      runningDecimal = nextDecimal;
      return true;
    };

    // Two passes. A single greedy pass over EV-sorted candidates would let one
    // plus-money leg consume the whole odds budget (a +110 leg alone leaves no
    // room under a +150 target), yielding a 2-leg "parlay". So: fill first from
    // minus-money legs — the ones that add probability without inflating the
    // price — then let plus-money legs use whatever budget is left.
    const minusMoney = allCandidates.filter((c) => c.odds < 0);
    const plusMoney = allCandidates.filter((c) => c.odds >= 0);

    for (const c of minusMoney) {
      if (legs.length >= 4) break;
      tryAdd(c);
    }
    for (const c of plusMoney) {
      if (legs.length >= 4) break;
      tryAdd(c);
    }

    // Landing on the chalkier side of -100 is fine — safer than target
    // beats a longshot. The per-leg MIN/MAX_LEG_ODDS filter plus the
    // running-total ceiling above are what keep the final number sane;
    // there's no floor enforcement beyond "use real candidates as they come."

    if (legs.length < 2) {
      // 200 with empty legs so the UI renders the "checking back later" empty
      // state instead of an error toast — happens nightly when slates are thin.
      return NextResponse.json({
        ok: true,
        legs: [],
        message: "Not enough qualifying picks yet",
      });
    }

    const result: PinnedParlay = {
      sport,
      date: targetDay,
      legs,
      totalOdds: toAmericanParlay(legs),
      generatedAt: new Date().toISOString(),
      lockedUntil: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
      dayLabel,
      // True only when EVERY leg beats the vig. Against real MLB prop prices
      // that's uncommon, so the UI uses this to avoid calling a break-even
      // ticket an "edge".
      hasPositiveEv: legs.length > 0 && legs.every((l) => l.evPercentage > 0),
      // Comma-separated legs in the exact shape playbookbot.com's web input
      // accepts, e.g. "Bryce Harper Over 0.5 Hits, Ben Rice Over 0.5 Hits".
      // Verified 2026-08-03: pasting this built a correct 3-leg slip with
      // BetMGM/FanDuel/Fanatics deep links.
      //
      // Their @Playbook Discord bot rejects the identical text ("please
      // provide a valid betslip input") — the website and the bot don't share
      // a parser — so this is the string a human pastes into the site rather
      // than something we can tag the bot with.
      playbookText: legs.map((l) => l.pick).join(", "),
    };

    await cloudSet(cacheKey, result);
    return NextResponse.json({ ok: true, ...result, cached: false });
  } catch (error: any) {
    console.error("parlay-today error:", error);
    return NextResponse.json({
      ok: true,
      legs: [],
      message: "Parlay temporarily unavailable",
    });
  }
}
