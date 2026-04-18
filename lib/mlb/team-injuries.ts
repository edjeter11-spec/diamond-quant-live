// ──────────────────────────────────────────────────────────
// MLB Team Injuries — key hitters out → offensive hit
//
// When a cleanup hitter or 3-hole is on the IL, the team's
// expected runs drop ~0.3-0.5 per absence. Markets adjust
// eventually; we want to catch it faster.
// ──────────────────────────────────────────────────────────

import { getCached, setCache } from "@/lib/odds/server-cache";

const MLB_API = "https://statsapi.mlb.com/api/v1";
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6h

export interface InjuredHitter {
  name: string;
  position: string;
  statusCode: string;
  status: string;  // "Injured List 10-Day" etc.
  ops?: number;    // Season OPS (from stats hydrate)
  impactful: boolean; // OPS >= 0.750 AND plays regularly
}

export interface TeamInjuryReport {
  teamAbbrev: string;
  totalOnIL: number;
  impactfulOut: number;  // number of key hitters on the IL
  keyPlayers: InjuredHitter[];
  summary: string;
}

/** Fetch the team's full roster (includes IL) + hydrate season hitting stats. */
async function fetchFullRoster(teamId: number, season?: number): Promise<any[]> {
  const year = season ?? new Date().getFullYear();
  const url = `${MLB_API}/teams/${teamId}/roster?rosterType=fullRoster&hydrate=person(stats(type=season,season=${year},group=hitting))`;
  try {
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return [];
    const data = await res.json();
    return data.roster ?? [];
  } catch {
    return [];
  }
}

function parseOps(rosterRow: any): number | undefined {
  const person = rosterRow.person;
  const splits = person?.stats?.[0]?.splits ?? [];
  const stat = splits[0]?.stat;
  if (!stat) return undefined;
  const ops = parseFloat(stat.ops ?? "");
  return Number.isFinite(ops) && ops > 0 ? ops : undefined;
}

function parseGamesPlayed(rosterRow: any): number {
  const splits = rosterRow.person?.stats?.[0]?.splits ?? [];
  const g = splits[0]?.stat?.gamesPlayed;
  return typeof g === "number" ? g : parseInt(g ?? "0", 10) || 0;
}

export async function getTeamInjuries(teamId: number, teamAbbrev: string): Promise<TeamInjuryReport> {
  const cacheKey = `mlb_injuries_${teamId}`;
  const cached = getCached(cacheKey, CACHE_TTL) as TeamInjuryReport | null;
  if (cached) return cached;

  const roster = await fetchFullRoster(teamId);

  const keyPlayers: InjuredHitter[] = [];
  let totalOnIL = 0;
  let impactfulOut = 0;

  for (const row of roster) {
    const statusCode = row.status?.code ?? "";
    const statusDesc = row.status?.description ?? "";
    // Check for IL status codes (IL10/IL15/IL60) or "Restricted" / "DL"
    const onIL = /^(IL|DL|RM|BRV|SU|FME|D7)/i.test(statusCode);
    if (!onIL) continue;

    totalOnIL++;
    const position = row.position?.abbreviation ?? "";
    // Only care about position players for offensive impact
    if (position === "P" || position === "TWP") continue;

    const ops = parseOps(row);
    const games = parseGamesPlayed(row);
    const impactful = (ops ?? 0) >= 0.750 && games >= 30;

    keyPlayers.push({
      name: row.person?.fullName ?? "",
      position,
      statusCode,
      status: statusDesc,
      ops,
      impactful,
    });
    if (impactful) impactfulOut++;
  }

  // Rank key players OPS-desc so summary shows the most important first
  keyPlayers.sort((a, b) => (b.ops ?? 0) - (a.ops ?? 0));

  const summary = impactfulOut === 0
    ? `${teamAbbrev} lineup mostly healthy`
    : `${teamAbbrev} missing ${impactfulOut} impact hitter${impactfulOut !== 1 ? "s" : ""}: ${keyPlayers.filter(k => k.impactful).slice(0, 3).map(k => `${k.name.split(" ").pop()} (${(k.ops ?? 0).toFixed(3)} OPS)`).join(", ")}`;

  const result: TeamInjuryReport = {
    teamAbbrev,
    totalOnIL,
    impactfulOut,
    keyPlayers,
    summary,
  };

  setCache(cacheKey, result);
  return result;
}

/** Edge in runs based on IL impact. Positive = favors pitcher (offense weakened). */
export function computeInjuryEdge(report: TeamInjuryReport): number {
  // 0.35 runs per impactful hitter out, capped at 1.4 (4 key absences)
  return Math.min(1.4, report.impactfulOut * 0.35);
}
