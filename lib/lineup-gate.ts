// ──────────────────────────────────────────────────────────
// LINEUP-CONFIRMATION GATE
//
// Both the props board (/api/pinned-props) and the parlay
// (/api/parlay-today) must refuse to build a slate until confirmed lineups
// have had a chance to post. Confirmed lineups drop 2-4h before first pitch;
// building earlier prices against soft, lineup-blind numbers.
//
// This used to live only in pinned-props. parlay-today had NO gate at all,
// which meant on 2026-08-10 the parlay pinned two moneylines at 4:09 AM ET
// against a slate whose first pitch was 12h later — the exact bug the props
// gate was written to prevent, just on the wrong endpoint. Both endpoints
// now import isBeforeLineupWindow() here so the guard can't drift again.
//
// Returning null on any upstream failure is deliberate — the caller then
// keeps its normal behaviour rather than freezing on a flaky schedule fetch.
// ──────────────────────────────────────────────────────────

import { etDateString } from "@/lib/sports-date";

/** How many hours before first pitch we allow a board to build. Confirmed
 *  lineups post 2-4h out; 3h lands just inside the window for all sports. */
export const LINEUP_LEAD_HOURS = 3;

const firstPitchCache = new Map<string, { at: number; hour: number | null }>();
const CACHE_TTL_MS = 60 * 60 * 1000;

const ESPN_SCOREBOARD: Record<string, string> = {
  nba: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
  nfl: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
  nhl: "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard",
};

/**
 * ET hour of `day`'s earliest first-pitch, or null if it can't be determined.
 *
 * Keyed by SPORT AND DAY, not just DAY. Sharing the key across sports (the
 * original bug) let mlb/nba/nfl race on a single cache entry — whichever
 * resolved first won, and out-of-season sports resolved to null, poisoning
 * MLB. Each sport gets its own slot now.
 */
export async function getFirstPitchHourET(
  sport: string,
  day: string = etDateString(),
): Promise<number | null> {
  const cacheKey = `${sport}_${day}`;
  const hit = firstPitchCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.hour;

  const espnPath = ESPN_SCOREBOARD[sport];

  try {
    let times: number[] = [];

    if (sport === "mlb") {
      const r = await fetch(
        `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${day}`,
        { signal: AbortSignal.timeout(6000) },
      );
      if (!r.ok) return null;
      const d = await r.json();
      times = (d?.dates?.[0]?.games ?? [])
        .map((g: any) => new Date(g.gameDate).getTime())
        .filter((t: number) => Number.isFinite(t));
    } else if (espnPath) {
      const r = await fetch(`${espnPath}?dates=${day.replace(/-/g, "")}`, {
        signal: AbortSignal.timeout(6000),
      });
      if (!r.ok) return null;
      const d = await r.json();
      times = (d?.events ?? [])
        .map((e: any) =>
          new Date(e?.date ?? e?.competitions?.[0]?.date).getTime(),
        )
        .filter((t: number) => Number.isFinite(t));
    } else {
      // Unknown sport — refuse to build a schedule for it.
      return null;
    }

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

/** Current ET hour, 0-23. Extracted so callers can share the same value. */
export function currentHourET(): number {
  return Number(
    new Date().toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      hour12: false,
    }),
  );
}

/** Wall-clock ET time expressed as fractional hours since midnight
 *  (13.5 = 1:30pm). Used by checkLineupGate to handle first-pitch times that
 *  wrap through midnight — a raw hour compare `currentHourET() < -3` is
 *  always false, so an early-morning first pitch would skip the gate. */
function nowMinutesSinceMidnightET(): number {
  const parts = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const [h, m] = parts.split(":").map((s) => Number(s.trim()));
  return h * 60 + (Number.isFinite(m) ? m : 0);
}

export interface LineupGateResult {
  /** True if we should NOT build the board yet — lineups haven't confirmed. */
  waiting: boolean;
  /** Hour (ET, 0-23) after which building is allowed. */
  buildsAtHourET: number | null;
  /** Underlying first-pitch hour used to decide (for debugging / messages). */
  firstPitchHourET: number | null;
}

/**
 * Should this sport's board wait for lineups right now?
 *
 * `buildsAtHourET = firstPitchHourET - LINEUP_LEAD_HOURS`. If we can't
 * resolve first pitch (unknown sport, upstream failure) this returns
 * `waiting: false` — degrading to "build now" rather than freezing the
 * board forever on a schedule outage.
 *
 * Comparison in MINUTES not hours. Prior code did `currentHourET() < buildsAtHourET`
 * with both sides as 0-23 integers — but for a very early first pitch (12am/1am
 * ET, e.g. international series or SNF spilling past midnight), buildsAtHourET
 * goes negative (e.g. 1 - 3 = -2). `currentHourET() < -2` is ALWAYS false, so
 * the gate never fires and the board would build any time of day. Comparing in
 * absolute minutes handles the negative correctly.
 */
export async function checkLineupGate(
  sport: string,
  day: string = etDateString(),
): Promise<LineupGateResult> {
  const firstPitchHourET = await getFirstPitchHourET(sport, day);
  if (firstPitchHourET === null) {
    return { waiting: false, buildsAtHourET: null, firstPitchHourET: null };
  }
  const buildsAtHourET = firstPitchHourET - LINEUP_LEAD_HOURS;
  const buildsAtMinutes = buildsAtHourET * 60;
  const nowMinutes = nowMinutesSinceMidnightET();
  // Waiting only when both sides are on today's clock. If buildsAtMinutes is
  // negative it refers to yesterday's calendar day (a 12am-1am ET first pitch
  // whose lineup window opened at 9-10pm PREVIOUS day), so we're already past
  // it — not waiting.
  const waiting = buildsAtMinutes >= 0 && nowMinutes < buildsAtMinutes;
  return {
    waiting,
    buildsAtHourET,
    firstPitchHourET,
  };
}
