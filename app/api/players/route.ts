import { NextResponse } from "next/server";
import { fetchPlayerProps, parsePlayerProps } from "@/lib/odds/the-odds-api";
import { devig } from "@/lib/model/kelly";
import { getApiKey } from "@/lib/odds/api-keys";
import { getCached, setCache, CACHE_TTL } from "@/lib/odds/server-cache";
import { searchNBAPlayer } from "@/lib/nba/player-stats";
import { isPlayerInjured } from "@/lib/nba/injuries";
import { loadNbaPropBrainFromCloud } from "@/lib/bot/nba-prop-brain";
import { projectProp } from "@/lib/bot/nba-prop-projector";
import { cloudGet, cloudSet } from "@/lib/supabase/client";
import { teamNameToAbbrev } from "@/lib/logos";

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

// Global CDN cache so every user hits the same warm response at the edge.
// First hit of the day primes; everyone after is instant.
const CDN_CACHE = "public, s-maxage=300, stale-while-revalidate=1800";

function todayKey() {
  return new Date().toISOString().split("T")[0];
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const market = searchParams.get("market") || "pitcher_strikeouts";
  let sport = searchParams.get("sport") || "baseball_mlb";
  // Normalize sport strings: "nba" → "basketball_nba"
  if (sport === "nba") sport = "basketball_nba";

  // Check server cache (keyed by sport + market)
  const cacheKey = `props_v5_${sport}_${market}`;
  const cached = getCached(cacheKey, CACHE_TTL.PROPS);
  if (cached) {
    return NextResponse.json(cached, { headers: { "Cache-Control": CDN_CACHE } });
  }

  // Cold server cache — check Supabase snapshot next (shared across serverless
  // instances, persists across deploys). Lets a newly-spun Vercel region serve
  // instantly instead of hitting the Odds API cold.
  const snapshotKey = `props_snap_${sport}_${market}_${todayKey()}`;
  try {
    const snapshot = await cloudGet<any>(snapshotKey, null);
    if (snapshot && Array.isArray(snapshot.props) && snapshot.props.length > 0) {
      setCache(cacheKey, snapshot); // warm the server cache too
      return NextResponse.json(snapshot, { headers: { "Cache-Control": CDN_CACHE } });
    }
  } catch {}

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

      // Rolling window: games starting in the next 28 hours OR that started
      // within the last 4 hours (still live / recently final). Handles every
      // hour of the day — late-night, early morning, day games — without
      // the calendar-day edge cases the old 4AM ET window had.
      const now = Date.now();
      const pool = (allEvents as any[]).filter((e: any) => {
        const t = new Date(e.commence_time).getTime();
        return t >= now - 4 * 60 * 60 * 1000 && t <= now + 28 * 60 * 60 * 1000;
      });
      events = pool
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

    // Fetch props for all games in parallel. If the combined main+alt call
    // is rejected (some sports/events don't support alt markets), retry with
    // the main market alone so the board stays populated.
    const propGames = (events as any[]).slice(0, 5);
    const perGameResults = await Promise.all(
      propGames.map(async (game: any) => {
        const attempt = async (mkt: string) => {
          const data = await fetchPlayerProps(apiKey, game.id, mkt, sport);
          const props = parsePlayerProps(data);
          for (const prop of props) {
            prop.team = `${game.away_team} @ ${game.home_team}`;
            (prop as any).gameTime = game.commence_time;
          }
          return props;
        };
        try {
          const primary = await attempt(marketsParam);
          if (primary.length > 0) return primary;
          // No props parsed — try main-only in case alt was rejected silently
          if (alt) {
            try { return await attempt(market); } catch {}
          }
          return primary;
        } catch {
          if (alt) {
            try { return await attempt(market); } catch {}
          }
          return [];
        }
      }),
    );
    const allProps: any[] = perGameResults.flat();

    let grouped = groupByPlayer(allProps);

    // FALLBACK — when books haven't posted yet but games exist, synthesize
    // "Brain projection" picks from the NBA player index + season stats so
    // the board never goes dark 5h before tip-off.
    if (grouped.length === 0 && sport === "basketball_nba" && events.length > 0 && market.startsWith("player_")) {
      try {
        grouped = await synthesizeNbaBrainPicks(market, events);
      } catch (e) {
        console.error(`NBA synthesis failed for ${market}:`, e instanceof Error ? e.message : e);
      }
    }

    // Augment NBA props with:
    //   - playerId (for headshots)
    //   - injuryStatus (filter out OUT/DOUBTFUL)
    //   - brain projection (probability/side/confidence from the trained brain,
    //     not the market devig — surfaces brain's value on the Board)
    if (sport === "basketball_nba" && grouped.length > 0) {
      try {
        // Load the brain once for the whole batch
        const brain = await loadNbaPropBrainFromCloud().catch(() => null);
        const weights = brain?.weights;

        // Cap augmentation to top 30 — enough for the full props page while
        // keeping cold-cache latency bounded (all lookups run in parallel).
        const augmentTargets = grouped.slice(0, 30);

        // Deduplicate player names to avoid N+1 queries (60 calls → one per unique name)
        const uniquePlayerNames = [...new Set(augmentTargets.map((g: any) => g.playerName))];
        const playerCache = new Map();
        const injuryCache = new Map();

        // Batch lookup all unique players
        await Promise.all([
          Promise.all(
            uniquePlayerNames.map(name =>
              searchNBAPlayer(name)
                .then(p => playerCache.set(name, p))
                .catch(() => playerCache.set(name, null))
            )
          ),
          Promise.all(
            uniquePlayerNames.map(name =>
              isPlayerInjured(name)
                .then(inj => injuryCache.set(name, inj))
                .catch(() => injuryCache.set(name, null))
            )
          ),
        ]);

        // Now augment using cached results
        await Promise.all(
          augmentTargets.map(async (g: any) => {
            try {
              const p = playerCache.get(g.playerName);
              const injury = injuryCache.get(g.playerName);
              if (p?.id) g.playerId = p.id;
              if (injury) {
                g.injuryStatus = injury.status;
                g.injuryNote = injury.shortComment;
              }

              // Brain projection — only runs when we have real stats for the
              // relevant market. Zero-stat fallbacks produced nonsense (line
              // 25 vs 0 ppg = 99% under) which the client filter dropped.
              const relevantStat = g.market === "player_points" ? p?.ppg
                : g.market === "player_rebounds" ? p?.rpg
                : g.market === "player_assists" ? p?.apg
                : 0;
              if (weights && p && Number(relevantStat) > 0) {
                const stats = { ppg: p.ppg ?? 0, rpg: p.rpg ?? 0, apg: p.apg ?? 0 };
                // Determine if player's team is home from prop.team ("Away @ Home")
                const teamStr: string = g.team ?? "";
                const atIdx = teamStr.indexOf(" @ ");
                const homeTeam = atIdx >= 0 ? teamStr.slice(atIdx + 3) : "";
                const isHome = p?.teamAbbrev
                  ? homeTeam.toLowerCase().includes(p.teamAbbrev.toLowerCase())
                  : false;

                const projection = projectProp(
                  stats,
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
            } catch (e) {
              console.error(`Failed to augment ${g.playerName}:`, e instanceof Error ? e.message : e);
            }
          })
        );
      } catch (e) {
        console.error("NBA prop augmentation failed:", e instanceof Error ? e.message : e);
      }
    }

    // Strip heavy per-book arrays from the default response — they balloon
    // payload 3-4x (110KB → 25KB) and mobile doesn't need them for the Board.
    // Callers that want full book coverage pass ?full=1.
    const wantsFull = searchParams.get("full") === "1";
    const slim = wantsFull
      ? grouped
      : grouped.map((g: any) => ({
          playerName: g.playerName,
          playerId: g.playerId,
          team: g.team,
          market: g.market,
          line: g.line,
          gameTime: g.gameTime,
          bestOver: g.bestOver,
          bestUnder: g.bestUnder,
          fairOverProb: g.fairOverProb,
          fairUnderProb: g.fairUnderProb,
          brainSide: g.brainSide,
          brainOverProb: g.brainOverProb,
          brainUnderProb: g.brainUnderProb,
          brainConfidence: g.brainConfidence,
          brainProjectedValue: g.brainProjectedValue,
          injuryStatus: g.injuryStatus,
          bestAlt: g.bestAlt,
          isSynthesized: g.isSynthesized,
        }));

    const response = {
      props: slim,
      markets: PROP_MARKETS,
      events: events.map((g: any) => ({ id: g.id, game: `${g.away_team} @ ${g.home_team}` })),
      message: slim.length === 0 ? "No props available yet for this market" : undefined,
    };

    if (slim.length > 0) {
      setCache(cacheKey, response);
      // Persist to Supabase so any serverless cold start or new region can
      // serve the same picks instantly. Fire-and-forget.
      cloudSet(snapshotKey, response).catch(() => {});
    }
    return NextResponse.json(response, { headers: { "Cache-Control": CDN_CACHE } });
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

// Build projected picks when no books have posted props yet.
// Uses the NBA player index to find each team's top contributors,
// runs them through the brain with the season avg as the implied line.
async function synthesizeNbaBrainPicks(market: string, games: any[]): Promise<any[]> {
  const statKey = market === "player_points" ? "ppg"
    : market === "player_rebounds" ? "rpg"
    : market === "player_assists" ? "apg" : "ppg";

  // Pull the shared NBA player index
  const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://diamond-quant-live.vercel.app";
  const idxRes = await fetch(`${base}/api/nba-player-index`, { next: { revalidate: 3600 } });
  if (!idxRes.ok) return [];
  const idxData = await idxRes.json();
  const allPlayers: any[] = idxData.players ?? [];

  // Normalize team names in events → abbreviations
  const abbrevsInGames = new Set<string>();
  for (const g of games) {
    const home = teamNameToAbbrev(g.home_team ?? "", "nba");
    const away = teamNameToAbbrev(g.away_team ?? "", "nba");
    if (home) abbrevsInGames.add(home);
    if (away) abbrevsInGames.add(away);
  }
  if (abbrevsInGames.size === 0) return [];

  // Enrich player entries with season stats (search each — cached)
  const candidateNames: string[] = allPlayers
    .filter((p) => abbrevsInGames.has((p.teamAbbrev ?? "").toUpperCase()))
    .map((p) => `${p.firstName} ${p.lastName}`)
    .slice(0, 60); // cap lookup count

  const enriched = await Promise.all(
    candidateNames.map((n) => searchNBAPlayer(n).catch(() => null)),
  );
  const withStats = enriched
    .filter((p): p is NonNullable<typeof p> => !!p && Number((p as any)[statKey]) > 0)
    .map((p: any) => ({
      ...p,
      stat: Number(p[statKey]),
    }))
    .sort((a, b) => b.stat - a.stat);

  // Take top 3 per team
  const perTeam = new Map<string, number>();
  const chosen = [] as typeof withStats;
  for (const p of withStats) {
    const tm = (p.teamAbbrev ?? "").toUpperCase();
    const c = perTeam.get(tm) ?? 0;
    if (c >= 3) continue;
    perTeam.set(tm, c + 1);
    chosen.push(p);
    if (chosen.length >= 12) break;
  }

  // Load brain for projections
  const brain = await loadNbaPropBrainFromCloud().catch(() => null);
  const weights = brain?.weights;

  // For each player, match to the game they're in and build a projected pick
  return chosen.map((p: any) => {
    const game = games.find((g) => {
      const home = teamNameToAbbrev(g.home_team ?? "", "nba");
      const away = teamNameToAbbrev(g.away_team ?? "", "nba");
      return home === p.teamAbbrev || away === p.teamAbbrev;
    });
    const line = Math.round(p.stat * 2) / 2 - 0.5; // season avg minus a half-step for Over lean
    const stats = { ppg: p.ppg ?? 0, rpg: p.rpg ?? 0, apg: p.apg ?? 0 };
    let brainOverProb = 60, brainUnderProb = 40, brainSide: "over" | "under" = "over", brainConfidence = 60, brainProjectedValue = p.stat;
    if (weights) {
      const proj = projectProp(stats, market, line, weights, { isHome: false, isB2B: false, leagueAvgTotal: 224 });
      const pct = proj.probability * 100;
      brainSide = proj.side;
      brainOverProb = proj.side === "over" ? pct : 100 - pct;
      brainUnderProb = proj.side === "under" ? pct : 100 - pct;
      brainConfidence = proj.confidence;
      brainProjectedValue = proj.projectedValue;
    }
    return {
      playerName: `${p.firstName} ${p.lastName}`,
      playerId: p.id,
      team: game ? `${game.away_team} @ ${game.home_team}` : "",
      market,
      line,
      gameTime: game?.commence_time,
      bestOver: { bookmaker: "Projected", price: -110 },
      bestUnder: { bookmaker: "Projected", price: -110 },
      fairOverProb: 50,
      fairUnderProb: 50,
      altLines: [],
      bestAlt: null,
      brainSide,
      brainOverProb,
      brainUnderProb,
      brainConfidence,
      brainProjectedValue,
      isSynthesized: true,
    };
  });
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
