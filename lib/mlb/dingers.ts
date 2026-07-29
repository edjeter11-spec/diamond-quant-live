// ──────────────────────────────────────────────────────────
// Dingers — daily HR-probability ranking for batters
//
// Composite model (simple weighted sum, explainable, no ML):
//   1. Handedness split   — HR rate vs the specific hand (L/R) of today's
//                            probable starter, CURRENT SEASON ONLY
//   2. Park + weather     — park-factors.ts HR factor combined with real-time
//                            weather via applyParkWeatherInteraction
//   3. Recency/trend      — last-10-games HR rate vs season HR rate
//   4. Batter fatigue     — day game after night game / games in last N days
//                            (reuses getTeamFatigue from weather-fatigue.ts)
//
// Small-sample honesty: any vs-handedness split built on <15 AB this season
// is flagged (smallSample: true) rather than presented with confidence.
// Current season only — deliberate scope tradeoff to keep API call volume
// sane (no multi-year game-log pulls).
// ──────────────────────────────────────────────────────────

import { fetchTodayGames, getTeamAbbrev } from "./stats-api";
import { fetchGameLog, fetchBatterSeasonStats } from "./player-stats";
import { getParkFactor } from "./park-factors";
import { getGameWeather, getTeamFatigue } from "./weather-fatigue";
import { devig, americanToDecimal } from "@/lib/model/kelly";

const MLB_API = "https://statsapi.mlb.com/api/v1";
const MIN_AB_FOR_SPLIT = 15; // below this, vs-hand split is flagged as a small sample

export interface DingerCandidate {
  playerId: number;
  playerName: string;
  team: string;
  teamAbbrev: string;
  opponent: string;
  opponentAbbrev: string;
  gameTime: string;
  venue: string;
  venueAbbrev: string;
  isHome: boolean;

  // Opposing starter
  pitcherName: string;
  pitcherHand: "L" | "R" | "?";

  // Handedness split (current season only)
  hrVsHand: number; // HR count vs that hand this season
  abVsHand: number; // AB vs that hand this season
  hrRateVsHand: number; // % — HR per AB vs that hand
  seasonHrRate: number; // % — overall season HR per AB
  smallSampleVsHand: boolean; // true if abVsHand < MIN_AB_FOR_SPLIT

  // Park + weather
  parkHrFactor: number; // e.g. 1.20 = +20%
  weatherHittingImpact: number; // -10 to +10, from applyParkWeatherInteraction path
  parkWeatherSummary: string;

  // Recency/trend
  last10HrRate: number; // % — HR per AB, last 10 games
  seasonHrRatePerGame: number; // HR per game, season

  // Fatigue
  fatigueScore: number; // 0-100 from getTeamFatigue
  fatigueNote: string;

  // Composite
  compositeScore: number; // 0-100, higher = more likely HR today
  reasoning: string[];

  // Real odds (optional — only when The Odds API has batter_home_runs posted)
  odds: {
    bookmaker: string;
    americanOdds: number;
    impliedProb: number;
    fairProb: number; // model's own fair probability, mapped from compositeScore
    evPct: number;
  } | null;
}

export interface DingersResult {
  candidates: DingerCandidate[];
  gamesAnalyzed: number;
  generatedAt: string;
  message?: string;
}

// ── Probable-starter handedness + venue join ──

interface GameContext {
  gamePk: number;
  gameTime: string;
  venue: string;
  venueAbbrev: string;
  home: {
    teamId: number;
    teamName: string;
    abbrev: string;
    pitcherId?: number;
    pitcherName?: string;
  };
  away: {
    teamId: number;
    teamName: string;
    abbrev: string;
    pitcherId?: number;
    pitcherName?: string;
  };
}

async function getTodayGameContexts(): Promise<GameContext[]> {
  const games = await fetchTodayGames();
  return games
    .filter(
      (g) =>
        g.teams?.home?.probablePitcher?.id ||
        g.teams?.away?.probablePitcher?.id,
    )
    .map((g) => ({
      gamePk: g.gamePk,
      gameTime: g.gameDate,
      venue: g.venue?.name ?? "",
      venueAbbrev: getTeamAbbrev(g.teams.home.team.name),
      home: {
        teamId: g.teams.home.team.id,
        teamName: g.teams.home.team.name,
        abbrev: getTeamAbbrev(g.teams.home.team.name),
        pitcherId: g.teams.home.probablePitcher?.id,
        pitcherName: g.teams.home.probablePitcher?.fullName,
      },
      away: {
        teamId: g.teams.away.team.id,
        teamName: g.teams.away.team.name,
        abbrev: getTeamAbbrev(g.teams.away.team.name),
        pitcherId: g.teams.away.probablePitcher?.id,
        pitcherName: g.teams.away.probablePitcher?.fullName,
      },
    }));
}

async function getPitcherHand(pitcherId: number): Promise<"L" | "R" | "?"> {
  try {
    const res = await fetch(`${MLB_API}/people/${pitcherId}`, {
      next: { revalidate: 86400 },
    });
    if (!res.ok) return "?";
    const data = await res.json();
    const code = data.people?.[0]?.pitchHand?.code;
    return code === "L" || code === "R" ? code : "?";
  } catch {
    return "?";
  }
}

// Heuristic active-batter pool: recent qualified hitters per team, via the
// season hitting leaderboard filtered to the two teams in play. Avoids a
// full lineup-projection system — "batters who are actually productive on
// this roster" is a reasonable v1 proxy for "who's starting".
async function getTeamHitters(
  teamId: number,
): Promise<Array<{ id: number; name: string }>> {
  try {
    const url = `${MLB_API}/teams/${teamId}/roster/active`;
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return [];
    const data = await res.json();
    const roster = data.roster ?? [];
    return roster
      .filter((r: any) => r.position?.abbreviation !== "P")
      .map((r: any) => ({ id: r.person?.id, name: r.person?.fullName }))
      .filter((p: any) => p.id && p.name);
  } catch {
    return [];
  }
}

// Fetch a batter's game log and join opposing-pitcher handedness per game,
// so we can compute HR rate vs L / vs R this season without a dedicated
// splits endpoint (MLB Stats API's hydrate=hydrations doesn't reliably expose
// vs-hand splits at the free tier, so we derive it ourselves from schedule
// lookups — cached at 1hr since it's the heaviest part of this pipeline).
const opponentHandCache = new Map<string, Promise<"L" | "R" | "?">>();

async function getStartingPitcherHandForGame(
  opponentTeamAbbrevGuess: string,
  gameDate: string,
  batterTeamId: number,
): Promise<"L" | "R" | "?"> {
  const key = `${gameDate}-${batterTeamId}`;
  if (opponentHandCache.has(key)) return opponentHandCache.get(key)!;

  const p = (async () => {
    try {
      const url = `${MLB_API}/schedule?sportId=1&teamId=${batterTeamId}&date=${gameDate}&hydrate=probablePitcher`;
      const res = await fetch(url, { next: { revalidate: 3600 } });
      if (!res.ok) return "?" as const;
      const data = await res.json();
      const game = data.dates?.[0]?.games?.[0];
      if (!game) return "?" as const;
      const isHome = game.teams?.home?.team?.id === batterTeamId;
      const oppPitcher = isHome
        ? game.teams?.away?.probablePitcher
        : game.teams?.home?.probablePitcher;
      if (!oppPitcher?.id) return "?" as const;
      return getPitcherHand(oppPitcher.id);
    } catch {
      return "?" as const;
    }
  })();
  opponentHandCache.set(key, p);
  return p;
}

async function computeHrVsHand(
  batterId: number,
  batterTeamId: number,
  todaysPitcherHand: "L" | "R" | "?",
): Promise<{ hr: number; ab: number }> {
  if (todaysPitcherHand === "?") return { hr: 0, ab: 0 };
  const log = await fetchGameLog(batterId, false);
  // fetchGameLog returns up to last 15 games — current-season only by
  // construction (stats=gameLog&season=<current year>). For a full-season
  // vs-hand split we re-fetch the full-season log via a wider window.
  const fullSeasonLog = await fetchFullSeasonGameLog(batterId);
  const source: Array<{
    date: string;
    opponent: string;
    atBats?: number;
    homeRuns?: number;
  }> = fullSeasonLog.length > 0 ? fullSeasonLog : log;

  let hr = 0;
  let ab = 0;
  // Limit the per-game opponent-hand lookups — this is the expensive part.
  // Cap at 40 games/batter; a full season is ~140 games but recent-heavy
  // sampling is fine for a "vs hand this year" signal at v1.
  const capped = source.slice(-40);
  await Promise.all(
    capped.map(async (g) => {
      const hand = await getStartingPitcherHandForGame(
        g.opponent,
        g.date,
        batterTeamId,
      );
      if (hand === todaysPitcherHand) {
        hr += g.homeRuns ?? 0;
        ab += g.atBats ?? 0;
      }
    }),
  );
  return { hr, ab };
}

async function fetchFullSeasonGameLog(playerId: number) {
  try {
    const year = new Date().getFullYear();
    const url = `${MLB_API}/people/${playerId}/stats?stats=gameLog&season=${year}&group=hitting`;
    const res = await fetch(url, { next: { revalidate: 1800 } });
    if (!res.ok) return [];
    const data = await res.json();
    const splits = data.stats?.[0]?.splits ?? [];
    return splits.map((s: any) => ({
      date: s.date ?? "",
      opponent: s.opponent?.name ?? "",
      atBats: parseInt(s.stat?.atBats) || 0,
      homeRuns: parseInt(s.stat?.homeRuns) || 0,
    }));
  } catch {
    return [];
  }
}

function scoreCandidate(input: {
  hrRateVsHand: number;
  seasonHrRate: number;
  smallSample: boolean;
  parkHrFactor: number;
  weatherHittingImpact: number;
  last10HrRate: number;
  fatigueScore: number;
}): number {
  const {
    hrRateVsHand,
    seasonHrRate,
    smallSample,
    parkHrFactor,
    weatherHittingImpact,
    last10HrRate,
    fatigueScore,
  } = input;

  // Base rate: blend season rate with vs-hand rate. Small samples get
  // heavily downweighted toward the season rate rather than trusted at face
  // value (sample-size honesty).
  const handWeight = smallSample ? 0.15 : 0.45;
  const baseRate = seasonHrRate * (1 - handWeight) + hrRateVsHand * handWeight;

  // Recency: last-10 rate nudges the base rate (capped influence)
  const recencyAdj = (last10HrRate - seasonHrRate) * 0.3;

  // Park + weather: multiplicative-ish bump expressed as % of base rate
  const parkAdj = (parkHrFactor - 1.0) * 100 * 0.5; // e.g. +20% park -> +10
  const weatherAdj = weatherHittingImpact * 0.4; // -10..+10 -> -4..+4

  // Fatigue: high fatigue slightly suppresses (tired legs, less power) —
  // small effect, this is a real but soft signal
  const fatigueAdj = -(fatigueScore / 100) * 3;

  const raw = baseRate + recencyAdj + parkAdj + weatherAdj + fatigueAdj;
  return Math.max(0, Math.min(100, Math.round(raw * 10) / 10));
}

function buildReasoning(c: {
  playerName: string;
  hrVsHand: number;
  abVsHand: number;
  hrRateVsHand: number;
  seasonHrRate: number;
  smallSampleVsHand: boolean;
  pitcherHand: "L" | "R" | "?";
  pitcherName: string;
  venue: string;
  parkHrFactor: number;
  weatherHittingImpact: number;
  parkWeatherSummary: string;
  last10HrRate: number;
  fatigueScore: number;
  fatigueNote: string;
}): string[] {
  const out: string[] = [];
  const handLabel =
    c.pitcherHand === "L"
      ? "LHP"
      : c.pitcherHand === "R"
        ? "RHP"
        : "unknown-hand";

  if (c.pitcherHand !== "?" && c.abVsHand > 0) {
    const sampleNote = c.smallSampleVsHand
      ? ` (small sample — under ${MIN_AB_FOR_SPLIT} AB, weighted lightly)`
      : "";
    out.push(
      `${c.hrVsHand} HR in ${c.abVsHand} AB vs ${handLabel} this season (${c.hrRateVsHand.toFixed(1)}%)${
        c.hrRateVsHand > c.seasonHrRate
          ? ` — above his ${c.seasonHrRate.toFixed(1)}% season rate`
          : ` — below his ${c.seasonHrRate.toFixed(1)}% season rate`
      }${sampleNote}`,
    );
  } else {
    out.push(
      `Facing ${c.pitcherName || "TBD"} (${handLabel}) — no vs-hand at-bats logged yet this season`,
    );
  }

  if (Math.abs(c.parkHrFactor - 1.0) >= 0.03) {
    const pct = Math.round((c.parkHrFactor - 1.0) * 100);
    out.push(
      `${c.venue || "Today's park"}: ${pct > 0 ? "+" : ""}${pct}% HR park factor`,
    );
  }
  if (c.parkWeatherSummary) out.push(c.parkWeatherSummary);

  if (c.last10HrRate > c.seasonHrRate + 1) {
    out.push(
      `Trending up — ${c.last10HrRate.toFixed(1)}% HR rate over last 10 games vs ${c.seasonHrRate.toFixed(1)}% season rate`,
    );
  } else if (c.last10HrRate < c.seasonHrRate - 1) {
    out.push(
      `Cooling off — ${c.last10HrRate.toFixed(1)}% HR rate over last 10 games vs ${c.seasonHrRate.toFixed(1)}% season rate`,
    );
  }

  // Fatigue is surfaced as its own dedicated UI block (not duplicated here)
  // when fatigueScore > 40 — see DingersTab.tsx.

  return out.slice(0, 5);
}

// ── Main entry point ──

export async function getDailyDingers(
  sport: "mlb" = "mlb",
): Promise<DingersResult> {
  const now = new Date().toISOString();
  if (sport !== "mlb") {
    return {
      candidates: [],
      gamesAnalyzed: 0,
      generatedAt: now,
      message: "Dingers is MLB-only",
    };
  }

  let contexts: GameContext[] = [];
  try {
    contexts = await getTodayGameContexts();
  } catch {
    return {
      candidates: [],
      gamesAnalyzed: 0,
      generatedAt: now,
      message: "Couldn't load today's MLB slate",
    };
  }

  if (contexts.length === 0) {
    return {
      candidates: [],
      gamesAnalyzed: 0,
      generatedAt: now,
      message: "No MLB games with probable starters posted yet today",
    };
  }

  // Cap games analyzed to bound total API call volume (heavy per-batter joins)
  const capped = contexts.slice(0, 8);

  const candidates: DingerCandidate[] = [];

  await Promise.all(
    capped.map(async (game) => {
      const [homeHand, awayHand, weather, homeFatigue, awayFatigue] =
        await Promise.all([
          game.away.pitcherId
            ? getPitcherHand(game.away.pitcherId)
            : Promise.resolve("?" as const),
          game.home.pitcherId
            ? getPitcherHand(game.home.pitcherId)
            : Promise.resolve("?" as const),
          getGameWeather(game.venueAbbrev),
          getTeamFatigue(game.home.teamName),
          getTeamFatigue(game.away.teamName),
        ]);

      const park = getParkFactor(game.venueAbbrev);

      // Home batters face the away pitcher; away batters face the home pitcher
      const sides: Array<{
        teamId: number;
        teamName: string;
        abbrev: string;
        oppAbbrev: string;
        oppTeamName: string;
        isHome: boolean;
        facingHand: "L" | "R" | "?";
        facingPitcherName: string;
        fatigue: Awaited<ReturnType<typeof getTeamFatigue>>;
      }> = [
        {
          teamId: game.home.teamId,
          teamName: game.home.teamName,
          abbrev: game.home.abbrev,
          oppAbbrev: game.away.abbrev,
          oppTeamName: game.away.teamName,
          isHome: true,
          facingHand: homeHand,
          facingPitcherName: game.away.pitcherName ?? "TBD",
          fatigue: homeFatigue,
        },
        {
          teamId: game.away.teamId,
          teamName: game.away.teamName,
          abbrev: game.away.abbrev,
          oppAbbrev: game.home.abbrev,
          oppTeamName: game.home.teamName,
          isHome: false,
          facingHand: awayHand,
          facingPitcherName: game.home.pitcherName ?? "TBD",
          fatigue: awayFatigue,
        },
      ];

      for (const side of sides) {
        const hitters = await getTeamHitters(side.teamId);
        // Cap hitters analyzed per team to keep call volume sane — take a
        // reasonable slice; the roster endpoint doesn't rank by usage so
        // this is a heuristic, not a real lineup projection.
        const cappedHitters = hitters.slice(0, 9);

        await Promise.all(
          cappedHitters.map(async (hitter) => {
            try {
              const [seasonStats, recentLog] = await Promise.all([
                fetchBatterSeasonStats(hitter.id),
                fetchGameLog(hitter.id, false),
              ]);
              if (!seasonStats) return;

              const seasonAB = parseInt(seasonStats.atBats) || 0;
              const seasonHR = parseInt(seasonStats.homeRuns) || 0;
              const gamesPlayed = parseInt(seasonStats.gamesPlayed) || 0;
              if (seasonAB < 20 || gamesPlayed < 5) return; // not enough season sample to be worth ranking

              const seasonHrRate =
                seasonAB > 0 ? (seasonHR / seasonAB) * 100 : 0;
              const seasonHrRatePerGame =
                gamesPlayed > 0 ? seasonHR / gamesPlayed : 0;

              const last10 = recentLog.slice(-10);
              const last10AB = last10.reduce((s, g) => s + (g.atBats ?? 0), 0);
              const last10HR = last10.reduce(
                (s, g) => s + (g.homeRuns ?? 0),
                0,
              );
              const last10HrRate =
                last10AB > 0 ? (last10HR / last10AB) * 100 : seasonHrRate;

              const { hr: hrVsHand, ab: abVsHand } = await computeHrVsHand(
                hitter.id,
                side.teamId,
                side.facingHand,
              );
              const hrRateVsHand =
                abVsHand > 0 ? (hrVsHand / abVsHand) * 100 : seasonHrRate;
              const smallSampleVsHand = abVsHand < MIN_AB_FOR_SPLIT;

              const parkWeatherSummary = weather?.summary ?? "";
              const weatherHittingImpact = weather?.hittingImpact ?? 0;
              const fatigueScore = side.fatigue?.fatigueScore ?? 0;
              const fatigueNote = side.fatigue?.summary ?? "";

              const compositeScore = scoreCandidate({
                hrRateVsHand,
                seasonHrRate,
                smallSample: smallSampleVsHand,
                parkHrFactor: park.hr,
                weatherHittingImpact,
                last10HrRate,
                fatigueScore,
              });

              const reasoning = buildReasoning({
                playerName: hitter.name,
                hrVsHand,
                abVsHand,
                hrRateVsHand,
                seasonHrRate,
                smallSampleVsHand,
                pitcherHand: side.facingHand,
                pitcherName: side.facingPitcherName,
                venue: game.venue,
                parkHrFactor: park.hr,
                weatherHittingImpact,
                parkWeatherSummary,
                last10HrRate,
                fatigueScore,
                fatigueNote,
              });

              candidates.push({
                playerId: hitter.id,
                playerName: hitter.name,
                team: side.teamName,
                teamAbbrev: side.abbrev,
                opponent: side.oppTeamName,
                opponentAbbrev: side.oppAbbrev,
                gameTime: game.gameTime,
                venue: game.venue,
                venueAbbrev: game.venueAbbrev,
                isHome: side.isHome,
                pitcherName: side.facingPitcherName,
                pitcherHand: side.facingHand,
                hrVsHand,
                abVsHand,
                hrRateVsHand: Math.round(hrRateVsHand * 10) / 10,
                seasonHrRate: Math.round(seasonHrRate * 10) / 10,
                smallSampleVsHand,
                parkHrFactor: park.hr,
                weatherHittingImpact,
                parkWeatherSummary,
                last10HrRate: Math.round(last10HrRate * 10) / 10,
                seasonHrRatePerGame:
                  Math.round(seasonHrRatePerGame * 100) / 100,
                fatigueScore,
                fatigueNote,
                compositeScore,
                reasoning,
                odds: null, // joined in with real odds by the API route
              });
            } catch {
              // skip this hitter — don't let one bad lookup kill the batch
            }
          }),
        );
      }
    }),
  );

  candidates.sort((a, b) => b.compositeScore - a.compositeScore);

  return {
    candidates: candidates.slice(0, 40),
    gamesAnalyzed: capped.length,
    generatedAt: now,
  };
}

// Attach real batter_home_runs odds/EV from /api/players props by matching
// on player name. Kept separate from getDailyDingers so the odds source
// (client-facing route) stays swappable without touching the ranking model.
export function attachOdds(
  candidates: DingerCandidate[],
  props: Array<{
    playerName: string;
    bestOver?: { bookmaker: string; price: number };
    bestUnder?: { bookmaker: string; price: number };
    fairOverProb?: number;
  }>,
): DingerCandidate[] {
  const byName = new Map(
    props.map((p) => [p.playerName.toLowerCase().trim(), p]),
  );
  return candidates.map((c) => {
    const prop = byName.get(c.playerName.toLowerCase().trim());
    if (!prop?.bestOver || !Number.isFinite(prop.bestOver.price)) return c;

    const marketOdds = prop.bestOver.price;
    const impliedProb =
      prop.fairOverProb !== undefined
        ? prop.fairOverProb / 100
        : prop.bestUnder && Number.isFinite(prop.bestUnder.price)
          ? devig(marketOdds, prop.bestUnder.price).prob1
          : 1 / americanToDecimal(marketOdds);

    const fairProb = Math.min(0.95, Math.max(0.01, c.compositeScore / 100));
    const dec = americanToDecimal(marketOdds);
    const evPct = Math.round((fairProb * dec - 1) * 1000) / 10;

    return {
      ...c,
      odds: {
        bookmaker: prop.bestOver.bookmaker,
        americanOdds: marketOdds,
        impliedProb: Math.round(impliedProb * 1000) / 10,
        fairProb: Math.round(fairProb * 1000) / 10,
        evPct,
      },
    };
  });
}
