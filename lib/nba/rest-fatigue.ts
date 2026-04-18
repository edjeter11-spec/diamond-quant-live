// ──────────────────────────────────────────────────────────
// NBA Rest & Back-to-Back Fatigue
//
// Historical NBA splits:
//   Teams on 2+ days rest:   ~52% cover rate
//   Teams on 1 day rest:     ~50% (par)
//   Teams on 0 days (B2B):   ~47% — meaningful edge
//   3-in-4 nights:           ~45% — huge fade spot
//   4th road game / 5 days:  ~44%
//
// Sportsbooks account for B2B but typically under-price
// multi-game stretches. We over-weight fatigue to exploit this.
// ──────────────────────────────────────────────────────────

import { getCached, setCache } from "@/lib/odds/server-cache";

export interface RestState {
  teamAbbrev: string;
  daysRest: number;              // days since last game (0 = back-to-back)
  gamesInLast4Nights: number;    // window count
  isB2B: boolean;                // shortcut for daysRest === 0
  is3In4: boolean;                // 3 games in last 4 nights including tonight
  fatigueScore: number;          // 0-10, higher = more fatigued
  summary: string;
}

const CACHE_TTL = 2 * 60 * 60 * 1000; // 2h — schedule doesn't change often

function yyyymmdd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

async function fetchScoreboard(date: string): Promise<any[]> {
  try {
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${date}`,
      { next: { revalidate: 3600 } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.events ?? [];
  } catch { return []; }
}

// Does this ESPN event contain a game played by a team with this abbrev?
function teamPlayedInEvent(event: any, abbrev: string): boolean {
  const competitors = event.competitions?.[0]?.competitors ?? [];
  return competitors.some((c: any) =>
    (c.team?.abbreviation ?? "").toUpperCase() === abbrev.toUpperCase()
  );
}

function isGameCompleted(event: any): boolean {
  const name = event.competitions?.[0]?.status?.type?.name ?? "";
  return name === "STATUS_FINAL";
}

/**
 * Compute rest/fatigue state for a team for tonight.
 * Looks back up to 4 days for prior games.
 */
export async function getRestState(abbrev: string): Promise<RestState> {
  const cacheKey = `nba_rest_${abbrev}`;
  const cached = getCached(cacheKey, CACHE_TTL) as RestState | null;
  if (cached) return cached;

  // Pull scoreboards for last 4 days (including today for context only)
  const today = new Date();
  const daysChecked: { offset: number; events: any[] }[] = [];
  for (let i = 1; i <= 4; i++) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - i);
    const events = await fetchScoreboard(yyyymmdd(d));
    daysChecked.push({ offset: i, events });
  }

  // Earliest day the team played → daysRest = that offset
  let daysRest = 5; // default if no games found in window
  let gamesInLast4Nights = 0;
  for (const { offset, events } of daysChecked) {
    const played = events.some((e: any) => teamPlayedInEvent(e, abbrev) && isGameCompleted(e));
    if (played) {
      gamesInLast4Nights++;
      if (daysRest === 5) daysRest = offset; // first (most recent) game found
    }
  }

  const isB2B = daysRest === 1; // played yesterday
  // 3-in-4 means 3 games in the last 4 nights including tonight (so 2 in the prior 4 nights)
  const is3In4 = gamesInLast4Nights >= 3;

  // Fatigue score 0-10
  let fatigueScore = 0;
  if (isB2B) fatigueScore += 5;
  if (is3In4) fatigueScore += 4;
  if (daysRest >= 3) fatigueScore = Math.max(0, fatigueScore - 3); // rested bonus offsets prior burden
  fatigueScore = Math.min(10, fatigueScore);

  // Summary
  let summary: string;
  if (isB2B && is3In4) summary = `${abbrev} in 3-in-4 AND on B2B — major fade spot`;
  else if (is3In4) summary = `${abbrev} playing 3rd game in 4 nights — legs are tired`;
  else if (isB2B) summary = `${abbrev} on 2nd night of back-to-back`;
  else if (daysRest >= 3) summary = `${abbrev} rested (${daysRest}+ days since last game)`;
  else summary = `${abbrev} on normal rest (${daysRest} day${daysRest !== 1 ? "s" : ""})`;

  const result: RestState = {
    teamAbbrev: abbrev,
    daysRest,
    gamesInLast4Nights,
    isB2B,
    is3In4,
    fatigueScore,
    summary,
  };

  setCache(cacheKey, result);
  return result;
}

/**
 * Compute the "rest edge" in net points for tonight's game from both sides.
 * Positive = home team favored by the fatigue gap.
 * Typical range: -3 to +3 in extreme cases (B2B vs rested), usually ±1.
 */
export function computeRestEdge(home: RestState, away: RestState): { edge: number; factors: string[] } {
  let edge = 0;
  const factors: string[] = [];

  // B2B = -1.5 pts; 3-in-4 = -1.0 pts; rested advantage = +0.5
  if (home.isB2B) { edge -= 1.5; factors.push(home.summary); }
  if (away.isB2B) { edge += 1.5; factors.push(away.summary); }
  if (home.is3In4) { edge -= 1.0; factors.push(`${home.teamAbbrev} 3-in-4 — legs`); }
  if (away.is3In4) { edge += 1.0; factors.push(`${away.teamAbbrev} 3-in-4 — legs`); }
  if (home.daysRest >= 3 && away.daysRest <= 1) { edge += 0.5; factors.push(`${home.teamAbbrev} rested vs tired ${away.teamAbbrev}`); }
  if (away.daysRest >= 3 && home.daysRest <= 1) { edge -= 0.5; factors.push(`${away.teamAbbrev} rested vs tired ${home.teamAbbrev}`); }

  return { edge, factors };
}
