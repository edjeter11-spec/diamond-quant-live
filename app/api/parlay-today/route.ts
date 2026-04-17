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
  const et = new Date(d.toLocaleString("en-US", { timeZone: "America/New_York" }));
  return `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, "0")}-${String(et.getDate()).padStart(2, "0")}`;
}

function etDateOf(iso: string): string {
  return etDateString(new Date(iso));
}

function scorePick(p: { confidence: string; evPercentage?: number }): number {
  const confScore = p.confidence === "HIGH" ? 3 : p.confidence === "MEDIUM" ? 2 : p.confidence === "LOW" ? 1 : 0;
  return confScore * 5 + (p.evPercentage ?? 0);
}

function toAmericanParlay(legs: ParlayLeg[]): number {
  const decimal = legs.reduce((acc, p) => {
    const dec = p.odds > 0 ? (p.odds / 100) + 1 : (100 / Math.abs(p.odds)) + 1;
    return acc * dec;
  }, 1);
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sport = (searchParams.get("sport") ?? "mlb").toLowerCase() as "nba" | "mlb";
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
    const baseUrl = `https://${process.env.VERCEL_URL || "diamond-quant-live.vercel.app"}`;
    const sportKey = isNBA ? "basketball_nba" : "baseball_mlb";

    // Fetch odds (contains evBets with confidence/EV)
    const oddsRes = await fetch(`${baseUrl}/api/odds?sport=${sportKey}`, { signal: AbortSignal.timeout(15000) });
    if (!oddsRes.ok) return NextResponse.json({ ok: false, error: "odds fetch failed", legs: [] });
    const oddsData = await oddsRes.json();
    const games = oddsData.games ?? [];

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
    const todayCandidates = candidates.filter(c => c.day === today);
    const targetDay = todayCandidates.length > 0
      ? today
      : [...new Set(candidates.map(c => c.day))].sort()[0] ?? today;
    const dayLabel = targetDay === today ? "Today" : "Tomorrow";

    let pool = candidates
      .filter(c => c.day === targetDay)
      .filter(c => c.confidence === "HIGH" || c.confidence === "MEDIUM" || c.evPercentage > 1)
      .sort((a, b) => scorePick(b) - scorePick(a));

    // Fetch NBA player props as additional mixed candidates
    const propCandidates: Candidate[] = [];
    if (isNBA) {
      const markets = [
        { key: "player_points", label: "Points" },
        { key: "player_rebounds", label: "Rebounds" },
        { key: "player_assists", label: "Assists" },
      ];
      await Promise.all(markets.map(async ({ key, label }) => {
        try {
          const r = await fetch(`${baseUrl}/api/players?sport=basketball_nba&market=${key}`, { signal: AbortSignal.timeout(8000) });
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
              confidence: topProb >= 65 ? "HIGH" : topProb >= 58 ? "MEDIUM" : "LOW",
              commenceTime: prop.gameTime,
              day: gameDay,
            });
          }
        } catch {}
      }));
      propCandidates.sort((a, b) => scorePick(b) - scorePick(a));
    }

    // Mixed-type builder: one per market when possible
    const legs: ParlayLeg[] = [];
    const usedGames = new Set<string>();
    const usedMarkets = new Set<string>();

    const tryAdd = (p: Candidate): boolean => {
      if (legs.length >= 3) return false;
      if (usedGames.has(p.game)) return false;
      const { day: _day, ...leg } = p;
      legs.push({ ...leg, dayLabel });
      usedGames.add(p.game);
      usedMarkets.add(p.market);
      return true;
    };

    const wantMarkets = ["moneyline", "spread", "total", "player_prop"];
    for (const mkt of wantMarkets) {
      if (legs.length >= 3) break;
      const src = mkt === "player_prop" ? propCandidates : pool;
      const best = src.find(p => p.market === mkt && !usedMarkets.has(p.market) && !usedGames.has(p.game));
      if (best) tryAdd(best);
    }

    const allCandidates = [...pool, ...propCandidates].sort((a, b) => scorePick(b) - scorePick(a));
    for (const c of allCandidates) {
      if (legs.length >= 3) break;
      tryAdd(c);
    }

    if (legs.length < 2) {
      return NextResponse.json({ ok: false, error: "not enough qualifying picks", legs: [] });
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
    return NextResponse.json({ ok: false, error: error.message, legs: [] }, { status: 500 });
  }
}
