import { NextResponse } from "next/server";
import { fetchPlayerProps, parsePlayerProps } from "@/lib/odds/the-odds-api";
import { devig } from "@/lib/model/kelly";
import { getApiKey } from "@/lib/odds/api-keys";
import { getCached, setCache, CACHE_TTL } from "@/lib/odds/server-cache";

export const revalidate = 120;

const PROP_MARKETS = [
  "pitcher_strikeouts",
  "batter_hits",
  "batter_total_bases",
  "batter_home_runs",
  "batter_rbis",
  "batter_runs_scored",
  "batter_stolen_bases",
  "pitcher_outs",
];

// Markets that have alternate-line variants on The Odds API.
// Requesting both gives 5-10x more line options per player.
const ALT_MARKETS: Record<string, string> = {
  pitcher_strikeouts: "pitcher_strikeouts_alternate",
  batter_hits: "batter_hits_alternate",
  batter_total_bases: "batter_total_bases_alternate",
  batter_home_runs: "batter_home_runs_alternate",
  batter_rbis: "batter_rbis_alternate",
  pitcher_outs: "pitcher_outs_alternate",
  player_points: "player_points_alternate",
  player_rebounds: "player_rebounds_alternate",
  player_assists: "player_assists_alternate",
  player_threes: "player_threes_alternate",
};

const BASE_URL = "https://api.the-odds-api.com/v4";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const market = searchParams.get("market") || "pitcher_strikeouts";
  const sport = searchParams.get("sport") || "baseball_mlb";

  // Check server cache (keyed by sport + market)
  const cacheKey = `props_${sport}_${market}`;
  const cached = getCached(cacheKey, CACHE_TTL.PROPS);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=600" },
    });
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return NextResponse.json({ props: [], markets: PROP_MARKETS, error: "No API keys available" });
  }

  try {
    // Fetch event list for the right sport
    const eventsCacheKey = `${sport}_events_props`;
    let events = getCached(eventsCacheKey, CACHE_TTL.EVENTS);

    if (!events) {
      const eventsRes = await fetch(
        `${BASE_URL}/sports/${sport}/events?apiKey=${apiKey}`,
        { next: { revalidate: 300 } }
      );
      if (!eventsRes.ok) throw new Error(`Events API error: ${eventsRes.status}`);
      const allEvents = await eventsRes.json();

      // Only include games happening TODAY (sports day = 4 AM ET → 4 AM ET next day).
      // This filter applies to both NBA and MLB props.
      const { start: dayStart, end: dayEnd } = getSportsDayWindowET();
      events = allEvents
        .filter((e: any) => {
          const gameTime = new Date(e.commence_time).getTime();
          return gameTime >= dayStart && gameTime < dayEnd;
        })
        .sort((a: any, b: any) => {
          // Soonest games first — they're most likely to have props posted
          return new Date(a.commence_time).getTime() - new Date(b.commence_time).getTime();
        })
        .slice(0, 5)
        .map((e: any) => ({ id: e.id, away_team: e.away_team, home_team: e.home_team, commence_time: e.commence_time }));

      setCache(eventsCacheKey, events);
    }

    // Request main + alternate markets together so we get 5-10 lines per player
    const alt = ALT_MARKETS[market];
    const marketsParam = alt ? `${market},${alt}` : market;

    // Fetch props for all games in parallel — sequential loop was the mobile
    // bottleneck (5 games × ~500ms = 2.5s cold-cache). 3 games is plenty for
    // the Board card and keeps the request tight.
    const propGames = (events as any[]).slice(0, 3);
    const perGameResults = await Promise.all(
      propGames.map(async (game: any) => {
        try {
          const data = await fetchPlayerProps(apiKey, game.id, marketsParam, sport);
          const props = parsePlayerProps(data);
          for (const prop of props) {
            prop.team = `${game.away_team} @ ${game.home_team}`;
            (prop as any).gameTime = game.commence_time;
          }
          return props;
        } catch {
          return [];
        }
      }),
    );
    const allProps: any[] = perGameResults.flat();

    const grouped = groupByPlayer(allProps);

    // Augment NBA props with:
    //   - playerId (for headshots)
    //   - injuryStatus (filter out OUT/DOUBTFUL)
    //   - brain projection (probability/side/confidence from the trained brain,
    //     not the market devig — surfaces brain's value on the Board)
    if (sport === "basketball_nba" && grouped.length > 0) {
      try {
        const { searchNBAPlayer } = await import("@/lib/nba/player-stats");
        const { isPlayerInjured } = await import("@/lib/nba/injuries");
        const { loadNbaPropBrainFromCloud } = await import("@/lib/bot/nba-prop-brain");
        const { projectProp } = await import("@/lib/bot/nba-prop-projector");

        // Load the brain once for the whole batch
        const brain = await loadNbaPropBrainFromCloud().catch(() => null);
        const weights = brain?.weights;

        // Cap augmentation to the top 15 groups — each triggers NBA CDN
        // lookups that add latency. Users only see ~8 picks anyway.
        const augmentTargets = grouped.slice(0, 15);
        await Promise.all(
          augmentTargets.map(async (g: any) => {
            try {
              const [p, injury] = await Promise.all([
                searchNBAPlayer(g.playerName).catch(() => null),
                isPlayerInjured(g.playerName).catch(() => null),
              ]);
              if (p?.id) g.playerId = p.id;
              if (injury) {
                g.injuryStatus = injury.status;
                g.injuryNote = injury.shortComment;
              }

              // Brain projection — runs only if we have stats + weights
              if (p && weights) {
                // Determine if player's team is home from prop.team ("Away @ Home")
                const teamStr: string = g.team ?? "";
                const atIdx = teamStr.indexOf(" @ ");
                const homeTeam = atIdx >= 0 ? teamStr.slice(atIdx + 3) : "";
                const isHome = homeTeam.toLowerCase().includes((p.teamAbbrev ?? "").toLowerCase()) ||
                               homeTeam.toLowerCase().includes((p.lastName ?? "").toLowerCase() ? "__disabled__" : "__disabled__");

                const projection = projectProp(
                  { ppg: p.ppg, rpg: p.rpg, apg: p.apg },
                  g.market,
                  g.line,
                  weights,
                  { isHome, isB2B: false, leagueAvgTotal: 224 },
                );
                g.brainSide = projection.side;
                // Store both sides as percentages (0-100) so the UI can compare
                // against fairOverProb/fairUnderProb which are also 0-100.
                const probPct = projection.probability * 100;
                g.brainOverProb = projection.side === "over" ? probPct : 100 - probPct;
                g.brainUnderProb = projection.side === "under" ? probPct : 100 - probPct;
                g.brainConfidence = projection.confidence;
                g.brainProjectedValue = projection.projectedValue;
              }
            } catch {}
          })
        );
      } catch {}
    }

    const response = {
      props: grouped,
      markets: PROP_MARKETS,
      events: events.map((g: any) => ({ id: g.id, game: `${g.away_team} @ ${g.home_team}` })),
      message: grouped.length === 0 ? "No props available yet for this market" : undefined,
    };

    if (grouped.length > 0) {
      setCache(cacheKey, response);
    }
    return NextResponse.json(response, {
      headers: {
        // Vercel edge CDN: fresh for 60s, serve stale up to 10min while re-fetching
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=600",
      },
    });
  } catch (error) {
    console.error("Props API error:", error);
    const stale = getCached(cacheKey, CACHE_TTL.PROPS * 5);
    if (stale) return NextResponse.json(stale);
    return NextResponse.json({ props: [], markets: PROP_MARKETS, error: "Failed to fetch props" });
  }
}

function americanToDecimal(odds: number): number {
  return odds > 0 ? odds / 100 + 1 : 100 / Math.abs(odds) + 1;
}

// Returns [start, end) UTC ms for the current "sports day" in ET:
// 4 AM ET today → 4 AM ET tomorrow. Handles EST/EDT via Intl.
function getSportsDayWindowET(): { start: number; end: number } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const etYear = Number(get("year"));
  const etMonth = Number(get("month"));
  const etDay = Number(get("day"));
  const etHour = Number(get("hour"));

  // If it's before 4 AM ET, the sports day started yesterday at 4 AM ET.
  const anchor = new Date(Date.UTC(etYear, etMonth - 1, etDay, 4, 0, 0));
  if (etHour < 4) anchor.setUTCDate(anchor.getUTCDate() - 1);

  // Convert that ET-wall-clock anchor (4 AM on anchor date) to real UTC ms
  // by computing ET offset for that instant.
  const offsetMin = getEtOffsetMinutes(anchor);
  const startMs = anchor.getTime() + offsetMin * 60 * 1000;
  const endMs = startMs + 24 * 60 * 60 * 1000;
  return { start: startMs, end: endMs };
}

function getEtOffsetMinutes(d: Date): number {
  // Offset (in minutes) you ADD to an ET wall-clock Date(.UTC(...)) to get real UTC ms.
  // e.g. EDT = UTC-4 → offset = +240; EST = UTC-5 → offset = +300.
  const tzFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
  });
  const parts = tzFmt.formatToParts(d);
  const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-5";
  const m = tz.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
  if (!m) return 300;
  const hours = Number(m[1]);
  const mins = Number(m[2] ?? "0");
  return -(hours * 60 + Math.sign(hours) * mins);
}

function groupByPlayer(props: ReturnType<typeof parsePlayerProps>) {
  // Group by player+market+line so each distinct alt line is its own bucket
  const byLine = new Map<string, typeof props>();
  for (const prop of props) {
    const key = `${prop.playerName}-${prop.market}-${prop.line}`;
    const bucket = byLine.get(key) || [];
    bucket.push(prop);
    byLine.set(key, bucket);
  }

  // Aggregate each distinct line into a single "lineRow"
  interface LineRow {
    playerName: string;
    market: string;
    team: string;
    gameTime: any;
    line: number;
    books: Array<{ bookmaker: string; overPrice: number; underPrice: number }>;
    bestOver: { bookmaker: string; price: number };
    bestUnder: { bookmaker: string; price: number };
    fairOverProb: number;
    fairUnderProb: number;
  }

  const lineRows: LineRow[] = [];
  for (const lines of byLine.values()) {
    const bestOver = lines.reduce((best, l) => (l.overPrice > best.overPrice ? l : best), lines[0]);
    const bestUnder = lines.reduce((best, l) => (l.underPrice > best.underPrice ? l : best), lines[0]);
    const { prob1: fairOverProb } = devig(bestOver.overPrice, bestUnder.underPrice);

    lineRows.push({
      playerName: lines[0].playerName,
      market: lines[0].market,
      team: lines[0].team,
      gameTime: (lines[0] as any).gameTime ?? null,
      line: lines[0].line,
      books: lines.map((l) => ({ bookmaker: l.bookmaker, overPrice: l.overPrice, underPrice: l.underPrice })),
      bestOver: { bookmaker: bestOver.bookmaker, price: bestOver.overPrice },
      bestUnder: { bookmaker: bestUnder.bookmaker, price: bestUnder.underPrice },
      fairOverProb: Math.round(fairOverProb * 10000) / 100,
      fairUnderProb: Math.round((1 - fairOverProb) * 10000) / 100,
    });
  }

  // Now collapse per player+market. Pick the line with the most book coverage
  // as the "main" display row, and attach all alt lines as siblings.
  const byPlayer = new Map<string, LineRow[]>();
  for (const row of lineRows) {
    const key = `${row.playerName}-${row.market}`;
    const existing = byPlayer.get(key) || [];
    existing.push(row);
    byPlayer.set(key, existing);
  }

  return Array.from(byPlayer.values()).map((rows) => {
    // Main line = the one with the most books (consensus line)
    rows.sort((a, b) => b.books.length - a.books.length || a.line - b.line);
    const main = rows[0];
    const alts = rows.slice(1).sort((a, b) => a.line - b.line);

    // Best-EV alt: highest edge (fair prob vs implied) across over/under on alts
    let bestAltEdge = 0;
    let bestAlt: { line: number; side: "over" | "under"; price: number; bookmaker: string; fairProb: number; edgePct: number } | null = null;
    for (const alt of alts) {
      const overImplied = 1 / americanToDecimal(alt.bestOver.price);
      const underImplied = 1 / americanToDecimal(alt.bestUnder.price);
      const overEdge = alt.fairOverProb / 100 - overImplied;
      const underEdge = alt.fairUnderProb / 100 - underImplied;
      if (overEdge > bestAltEdge) {
        bestAltEdge = overEdge;
        bestAlt = { line: alt.line, side: "over", price: alt.bestOver.price, bookmaker: alt.bestOver.bookmaker, fairProb: alt.fairOverProb, edgePct: Math.round(overEdge * 10000) / 100 };
      }
      if (underEdge > bestAltEdge) {
        bestAltEdge = underEdge;
        bestAlt = { line: alt.line, side: "under", price: alt.bestUnder.price, bookmaker: alt.bestUnder.bookmaker, fairProb: alt.fairUnderProb, edgePct: Math.round(underEdge * 10000) / 100 };
      }
    }

    return {
      ...main,
      altLines: alts.map((a) => ({
        line: a.line,
        bestOver: a.bestOver,
        bestUnder: a.bestUnder,
        fairOverProb: a.fairOverProb,
        fairUnderProb: a.fairUnderProb,
      })),
      bestAlt, // null when main is the best available
    };
  });
}
