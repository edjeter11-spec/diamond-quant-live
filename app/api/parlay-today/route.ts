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
  confidence: string;
  commenceTime?: string;
  dayLabel?: string;
}

interface PinnedParlay {
  sport: "nba" | "mlb";
  date: string; // ET date: YYYY-MM-DD
  legs: ParlayLeg[];
  totalOdds: number;
  generatedAt: string;
  lockedUntil: string;
  dayLabel: string; // "Today" or "Tomorrow" etc
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

function scorePick(p: { confidence: string; evPercentage?: number }): number {
  const confScore =
    p.confidence === "HIGH"
      ? 3
      : p.confidence === "MEDIUM"
        ? 2
        : p.confidence === "LOW"
          ? 1
          : 0;
  return confScore * 5 + (p.evPercentage ?? 0);
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
          { key: "pitcher_strikeouts", label: "Ks" },
          { key: "batter_hits", label: "Hits" },
          { key: "batter_total_bases", label: "Total Bases" },
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
            propCandidates.push({
              id: `prop-${key}-${prop.playerName}`,
              game: prop.playerName,
              pick: `${prop.playerName} ${favourOver ? "Over" : "Under"} ${prop.line} ${label}`,
              market: "player_prop",
              odds: best.price,
              bookmaker: best.bookmaker,
              evPercentage: Math.round((topProb - 50) * 2 * 10) / 10,
              fairProb: topProb,
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
      .filter((c) => c.odds >= MIN_LEG_ODDS && c.odds <= MAX_LEG_ODDS)
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
      if (legs.length >= 3 && nextAmerican > TARGET_MAX_AMERICAN) return false;

      const { day: _day, ...leg } = p;
      legs.push({ ...leg, dayLabel });
      usedGames.add(p.game);
      runningDecimal = nextDecimal;
      return true;
    };

    for (const c of allCandidates) {
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
