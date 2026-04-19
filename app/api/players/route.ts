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

const BASE_URL = "https://api.the-odds-api.com/v4";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const market = searchParams.get("market") || "pitcher_strikeouts";
  const sport = searchParams.get("sport") || "baseball_mlb";

  // Check server cache (keyed by sport + market)
  const cacheKey = `props_${sport}_${market}`;
  const cached = getCached(cacheKey, CACHE_TTL.PROPS);
  if (cached) return NextResponse.json(cached);

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

      // Prioritize FUTURE games (where props are most likely posted)
      // Sort by commence time, take upcoming games first
      const now = Date.now();
      events = allEvents
        .filter((e: any) => {
          const gameTime = new Date(e.commence_time).getTime();
          // Future games up to 36hrs out, or games started within last 2hrs
          return gameTime > now - 2 * 60 * 60 * 1000 && gameTime < now + 36 * 60 * 60 * 1000;
        })
        .sort((a: any, b: any) => {
          // Soonest games first — they're most likely to have props posted
          return new Date(a.commence_time).getTime() - new Date(b.commence_time).getTime();
        })
        .slice(0, 5)
        .map((e: any) => ({ id: e.id, away_team: e.away_team, home_team: e.home_team, commence_time: e.commence_time }));

      setCache(eventsCacheKey, events);
    }

    const allProps: any[] = [];

    // Fetch props for each game — stop early if we already have enough
    for (const game of events) {
      try {
        const data = await fetchPlayerProps(apiKey, game.id, market, sport);
        const props = parsePlayerProps(data);
        for (const prop of props) {
          prop.team = `${game.away_team} @ ${game.home_team}`;
          (prop as any).gameTime = game.commence_time;
        }
        allProps.push(...props);
      } catch {
        // Game may not have props for this market
      }
      // If we have enough props, stop fetching more games
      if (allProps.length >= 10) break;
    }

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

        await Promise.all(
          grouped.map(async (g: any) => {
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
    return NextResponse.json(response);
  } catch (error) {
    console.error("Props API error:", error);
    const stale = getCached(cacheKey, CACHE_TTL.PROPS * 5);
    if (stale) return NextResponse.json(stale);
    return NextResponse.json({ props: [], markets: PROP_MARKETS, error: "Failed to fetch props" });
  }
}

function groupByPlayer(props: ReturnType<typeof parsePlayerProps>) {
  const grouped = new Map<string, typeof props>();
  for (const prop of props) {
    const key = `${prop.playerName}-${prop.market}`;
    const existing = grouped.get(key) || [];
    existing.push(prop);
    grouped.set(key, existing);
  }

  return Array.from(grouped.entries()).map(([_key, lines]) => {
    const bestOver = lines.reduce((best, l) => l.overPrice > best.overPrice ? l : best, lines[0]);
    const bestUnder = lines.reduce((best, l) => l.underPrice > best.underPrice ? l : best, lines[0]);
    const { prob1: fairOverProb } = devig(bestOver.overPrice, bestUnder.underPrice);

    return {
      playerName: lines[0].playerName,
      line: lines[0].line,
      market: lines[0].market,
      team: lines[0].team,
      gameTime: (lines[0] as any).gameTime ?? null,
      books: lines.map((l) => ({ bookmaker: l.bookmaker, overPrice: l.overPrice, underPrice: l.underPrice })),
      bestOver: { bookmaker: bestOver.bookmaker, price: bestOver.overPrice },
      bestUnder: { bookmaker: bestUnder.bookmaker, price: bestUnder.underPrice },
      fairOverProb: Math.round(fairOverProb * 10000) / 100,
      fairUnderProb: Math.round((1 - fairOverProb) * 10000) / 100,
    };
  });
}
