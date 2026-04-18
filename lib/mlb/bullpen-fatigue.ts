// ──────────────────────────────────────────────────────────
// Bullpen Fatigue — last 3 days' reliever usage per team
//
// Sharpies know: a closer who threw 22 pitches yesterday isn't
// the same closer today. Markets price this slowly. We can exploit
// it by detecting tired bullpens and adjusting our edges.
// ──────────────────────────────────────────────────────────

import { getCached, setCache } from "@/lib/odds/server-cache";

const MLB_API = "https://statsapi.mlb.com/api/v1";

// MLB Stats API team IDs (duplicated from logos.ts to avoid importing client code)
const MLB_TEAM_ID: Record<string, number> = {
  ARI: 109, ATL: 144, BAL: 110, BOS: 111, CHC: 112, CWS: 145, CIN: 113,
  CLE: 114, COL: 115, DET: 116, HOU: 117, KC: 118, LAA: 108, LAD: 119,
  MIA: 146, MIL: 158, MIN: 142, NYM: 121, NYY: 147, OAK: 133, PHI: 143,
  PIT: 134, SD: 135, SF: 137, SEA: 136, STL: 138, TB: 139, TEX: 140,
  TOR: 141, WSH: 120,
};

export function getTeamIdByAbbrev(abbrev: string): number | null {
  return MLB_TEAM_ID[(abbrev || "").toUpperCase()] ?? null;
}

export interface BullpenFatigue {
  teamAbbrev: string;
  tired: boolean;
  tiredRelievers: Array<{ name: string; appearances: number; pitches: number }>;
  score: number; // 0–10, higher = more fatigued
  summary: string; // one-line human-readable
}

const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours — recompute a few times per day

// Fetch last N days of games for a team id
async function fetchRecentGames(teamId: number, days: number = 3): Promise<number[]> {
  const end = new Date();
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - days);
  const isoEnd = end.toISOString().split("T")[0];
  const isoStart = start.toISOString().split("T")[0];
  try {
    const res = await fetch(
      `${MLB_API}/schedule?sportId=1&teamId=${teamId}&startDate=${isoStart}&endDate=${isoEnd}`,
      { next: { revalidate: 3600 } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const gamePks: number[] = [];
    for (const d of data.dates ?? []) {
      for (const g of d.games ?? []) {
        if (g.status?.statusCode === "F" || g.status?.statusCode === "O") {
          gamePks.push(g.gamePk);
        }
      }
    }
    return gamePks;
  } catch {
    return [];
  }
}

// For each game, pull the boxscore and identify relievers (non-starters)
// that pitched, with pitch counts.
async function fetchReliefUsage(gamePk: number, teamId: number): Promise<Array<{ name: string; pitches: number }>> {
  try {
    const res = await fetch(`${MLB_API}/game/${gamePk}/boxscore`, { next: { revalidate: 3600 } });
    if (!res.ok) return [];
    const data = await res.json();
    const isHome = data.teams?.home?.team?.id === teamId;
    const teamData = isHome ? data.teams?.home : data.teams?.away;
    const pitcherIds: number[] = teamData?.pitchers ?? [];
    const players = teamData?.players ?? {};

    const usage: Array<{ name: string; pitches: number }> = [];
    // First pitcher in pitcherIds is the starter — skip
    for (let i = 1; i < pitcherIds.length; i++) {
      const pid = pitcherIds[i];
      const p = players[`ID${pid}`];
      if (!p) continue;
      const stats = p.stats?.pitching ?? {};
      const pitches = Number(stats.numberOfPitches ?? stats.pitchesThrown ?? 0);
      if (pitches <= 0) continue;
      usage.push({
        name: p.person?.fullName ?? `#${pid}`,
        pitches,
      });
    }
    return usage;
  } catch {
    return [];
  }
}

/**
 * Compute bullpen fatigue for a team given their MLB team id.
 * "Tired" = any reliever with 2+ appearances OR 25+ pitches thrown in last 3 days.
 */
export async function getBullpenFatigue(teamId: number, teamAbbrev: string): Promise<BullpenFatigue> {
  const cacheKey = `bullpen_${teamId}`;
  const cached = getCached(cacheKey, CACHE_TTL) as BullpenFatigue | null;
  if (cached) return cached;

  const gamePks = await fetchRecentGames(teamId, 3);
  if (gamePks.length === 0) {
    const fresh: BullpenFatigue = {
      teamAbbrev, tired: false, tiredRelievers: [], score: 0,
      summary: `${teamAbbrev} bullpen: insufficient recent-game data`,
    };
    setCache(cacheKey, fresh);
    return fresh;
  }

  // Aggregate by pitcher name across games
  const byPitcher = new Map<string, { appearances: number; pitches: number }>();
  for (const pk of gamePks) {
    const usage = await fetchReliefUsage(pk, teamId);
    for (const u of usage) {
      const prev = byPitcher.get(u.name) ?? { appearances: 0, pitches: 0 };
      prev.appearances++;
      prev.pitches += u.pitches;
      byPitcher.set(u.name, prev);
    }
  }

  // Threshold: 2+ appearances OR 25+ pitches total in window = tired
  const tiredRelievers: BullpenFatigue["tiredRelievers"] = [];
  for (const [name, u] of byPitcher) {
    if (u.appearances >= 2 || u.pitches >= 25) {
      tiredRelievers.push({ name, ...u });
    }
  }

  // Score: rough 0-10 proxy for market-vs-our-read edge magnitude
  // 1 tired reliever ≈ 2 points; 3+ tired ≈ 6+ points
  const score = Math.min(10, tiredRelievers.length * 2 + Math.floor(
    tiredRelievers.reduce((s, r) => s + Math.max(0, r.pitches - 25), 0) / 15
  ));

  const summary = tiredRelievers.length === 0
    ? `${teamAbbrev} bullpen is fresh — no relievers over threshold`
    : `${teamAbbrev} bullpen tired: ${tiredRelievers.length} reliever${tiredRelievers.length !== 1 ? "s" : ""} over threshold (${tiredRelievers.map(r => `${r.name.split(" ").pop()} ${r.pitches}p`).join(", ")})`;

  const result: BullpenFatigue = {
    teamAbbrev,
    tired: tiredRelievers.length >= 2 || score >= 5,
    tiredRelievers,
    score,
    summary,
  };
  setCache(cacheKey, result);
  return result;
}
