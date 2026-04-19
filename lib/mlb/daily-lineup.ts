// ──────────────────────────────────────────────────────────
// MLB Daily Lineup Scraper
//
// Team injuries catch season-long IL absences. Daily scratches are
// different — a star "resting" or fighting flu gets pulled 2-3h
// pre-game. Markets update in 20-30min but our model beats them by
// reading the confirmed lineup directly from MLB Stats API.
//
// Endpoint: /game/{gamePk}/boxscore returns teams.{home,away}.batters
// (array of personIds in batting order) + players dict. If the array
// is empty or missing, lineup isn't posted yet — stay silent.
// ──────────────────────────────────────────────────────────

import { getCached, setCache } from "@/lib/odds/server-cache";

const MLB_API = "https://statsapi.mlb.com/api/v1";
const CACHE_TTL = 20 * 60 * 1000; // 20min — lineups rarely change once posted

export interface ScratchedPlayer {
  name: string;
  position: string;
  ops?: number;
  gamesPlayed?: number;
  impactful: boolean;  // OPS >= .750 + games >= 30
}

export interface DailyLineupReport {
  gamePk: number;
  teamAbbrev: string;
  lineupPosted: boolean;
  confirmedStarters: string[]; // names in batting order
  scratches: ScratchedPlayer[]; // regulars NOT in tonight's lineup
  impactfulScratches: number;
  summary: string;
}

async function fetchBoxscoreBatters(gamePk: number, which: "home" | "away"): Promise<{
  batterIds: number[];
  players: Record<string, any>;
} | null> {
  try {
    const res = await fetch(
      `${MLB_API}/game/${gamePk}/boxscore`,
      { next: { revalidate: 1200 } } // 20min
    );
    if (!res.ok) return null;
    const data = await res.json();
    const team = data.teams?.[which];
    if (!team) return null;
    const batters: number[] = team.batters ?? [];
    // `batters` includes bench too; the actual starting 9 are in `battingOrder`
    // which is the first 9 entries of `batters` OR a separate field
    // — use batters[0..8] as the confirmed starters if present
    const startingIds = batters.slice(0, 9);
    return {
      batterIds: startingIds,
      players: team.players ?? {},
    };
  } catch { return null; }
}

async function fetchTeamSeasonRegulars(teamId: number, season?: number): Promise<Array<{
  id: number; name: string; position: string; ops: number; gamesPlayed: number;
}>> {
  const year = season ?? new Date().getFullYear();
  const url = `${MLB_API}/teams/${teamId}/roster?rosterType=active&hydrate=person(stats(type=season,season=${year},group=hitting))`;
  try {
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.roster ?? []).map((row: any) => {
      const person = row.person ?? {};
      const splits = person.stats?.[0]?.splits ?? [];
      const stat = splits[0]?.stat ?? {};
      const ops = parseFloat(stat.ops ?? "");
      const g = typeof stat.gamesPlayed === "number" ? stat.gamesPlayed : parseInt(stat.gamesPlayed ?? "0", 10) || 0;
      return {
        id: person.id,
        name: person.fullName ?? "",
        position: row.position?.abbreviation ?? "",
        ops: Number.isFinite(ops) ? ops : 0,
        gamesPlayed: g,
      };
    }).filter((p: any) => p.position !== "P" && p.position !== "TWP"); // position players only
  } catch { return []; }
}

/**
 * Compare tonight's confirmed lineup to the team's regulars list.
 * Returns scratches (regulars not starting tonight) + impact count.
 */
export async function getDailyLineup(
  gamePk: number,
  teamId: number,
  teamAbbrev: string,
  which: "home" | "away"
): Promise<DailyLineupReport> {
  const cacheKey = `mlb_lineup_${gamePk}_${which}`;
  const cached = getCached(cacheKey, CACHE_TTL) as DailyLineupReport | null;
  if (cached) return cached;

  const empty: DailyLineupReport = {
    gamePk, teamAbbrev, lineupPosted: false,
    confirmedStarters: [], scratches: [], impactfulScratches: 0,
    summary: `${teamAbbrev} lineup not yet posted`,
  };

  const boxscore = await fetchBoxscoreBatters(gamePk, which);
  if (!boxscore || boxscore.batterIds.length < 7) {
    // Lineup not posted (or too-early box score stub)
    setCache(cacheKey, empty);
    return empty;
  }

  const regulars = await fetchTeamSeasonRegulars(teamId);
  if (regulars.length === 0) {
    setCache(cacheKey, { ...empty, lineupPosted: true, summary: `${teamAbbrev} lineup posted (no regular-stats context)` });
    return empty;
  }

  const startingIdSet = new Set(boxscore.batterIds);
  const confirmedStarters: string[] = [];
  for (const id of boxscore.batterIds) {
    const p = boxscore.players[`ID${id}`];
    if (p?.person?.fullName) confirmedStarters.push(p.person.fullName);
  }

  // Scratches = impact regulars on active roster but NOT in starting 9
  const scratches: ScratchedPlayer[] = [];
  let impactfulScratches = 0;
  for (const reg of regulars) {
    if (startingIdSet.has(reg.id)) continue;
    if (reg.gamesPlayed < 20) continue; // bench guy, not a scratch
    const impactful = reg.ops >= 0.750 && reg.gamesPlayed >= 30;
    scratches.push({
      name: reg.name,
      position: reg.position,
      ops: reg.ops,
      gamesPlayed: reg.gamesPlayed,
      impactful,
    });
    if (impactful) impactfulScratches++;
  }
  scratches.sort((a, b) => (b.ops ?? 0) - (a.ops ?? 0));

  const summary = impactfulScratches === 0
    ? `${teamAbbrev} starting regulars — healthy lineup`
    : `${teamAbbrev} scratched ${impactfulScratches} impact hitter${impactfulScratches !== 1 ? "s" : ""}: ${scratches.filter(s => s.impactful).slice(0, 3).map(s => `${s.name.split(" ").pop()} (${(s.ops ?? 0).toFixed(3)})`).join(", ")}`;

  const result: DailyLineupReport = {
    gamePk, teamAbbrev,
    lineupPosted: true,
    confirmedStarters,
    scratches,
    impactfulScratches,
    summary,
  };

  setCache(cacheKey, result);
  return result;
}

/** Edge in runs from daily scratches. Larger than season IL weight because
 * scratches are last-minute (market hasn't fully adjusted yet). */
export function computeLineupEdge(report: DailyLineupReport): number {
  if (!report.lineupPosted) return 0;
  // 0.40 runs per impactful scratch, capped at 1.6 (4+ absences)
  return Math.min(1.6, report.impactfulScratches * 0.40);
}
