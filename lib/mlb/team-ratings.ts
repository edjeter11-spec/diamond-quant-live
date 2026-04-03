// ──────────────────────────────────────────────────────────
// Convert MLB Stats API data into our TeamStats format
// for the quantitative engine
// ──────────────────────────────────────────────────────────

import type { TeamStats, PitcherStats, GameState } from "@/lib/model/types";
import { getTeamAbbrev } from "./stats-api";

const MLB_API = "https://statsapi.mlb.com/api/v1";

// Fetch and build TeamStats for a game's teams
export async function buildTeamStats(
  teamName: string,
  teamId?: number
): Promise<TeamStats> {
  // Default stats if API fails
  const defaults: TeamStats = {
    name: teamName,
    abbrev: getTeamAbbrev(teamName),
    pitching: 50,
    hitting: 50,
    bullpen: 50,
    defense: 50,
    baserunning: 50,
    recentForm: 0.5,
    homeAway: 50,
  };

  if (!teamId) return defaults;

  try {
    const year = new Date().getFullYear();
    const url = `${MLB_API}/teams/${teamId}/stats?stats=season&season=${year}&group=hitting,pitching,fielding`;
    const res = await fetch(url, { next: { revalidate: 600 } });
    if (!res.ok) return defaults;

    const data = await res.json();
    const stats = data.stats ?? [];

    // Parse hitting stats
    const hittingGroup = stats.find((s: any) => s.group?.displayName === "hitting");
    const hittingSplit = hittingGroup?.splits?.[0]?.stat;

    // Parse pitching stats
    const pitchingGroup = stats.find((s: any) => s.group?.displayName === "pitching");
    const pitchingSplit = pitchingGroup?.splits?.[0]?.stat;

    // Parse fielding stats
    const fieldingGroup = stats.find((s: any) => s.group?.displayName === "fielding");
    const fieldingSplit = fieldingGroup?.splits?.[0]?.stat;

    if (!hittingSplit && !pitchingSplit) return defaults;

    // Convert raw stats to 0-100 ratings
    const hitting = hittingSplit ? rateHitting(hittingSplit) : 50;
    const pitching = pitchingSplit ? ratePitching(pitchingSplit) : 50;
    const bullpen = pitchingSplit ? rateBullpen(pitchingSplit) : 50;
    const defense = fieldingSplit ? rateDefense(fieldingSplit) : 50;
    const baserunning = hittingSplit ? rateBaserunning(hittingSplit) : 50;

    return {
      name: teamName,
      abbrev: getTeamAbbrev(teamName),
      pitching,
      hitting,
      bullpen,
      defense,
      baserunning,
      recentForm: 0.5, // would need game log for this
      homeAway: 50,
    };
  } catch {
    return defaults;
  }
}

// Rate hitting on 0-100 scale
function rateHitting(stat: any): number {
  const ops = parseFloat(stat.ops) || 0.700;
  // League avg OPS ~.720, range typically .600-.850
  const normalized = Math.min(Math.max((ops - 0.600) / 0.250, 0), 1);
  return Math.round(normalized * 100);
}

// Rate pitching on 0-100 scale (lower ERA = higher rating)
function ratePitching(stat: any): number {
  const era = parseFloat(stat.era) || 4.00;
  // League avg ERA ~4.00, range typically 2.50-5.50
  const normalized = Math.min(Math.max(1 - (era - 2.50) / 3.00, 0), 1);
  return Math.round(normalized * 100);
}

// Rate bullpen (use WHIP as proxy)
function rateBullpen(stat: any): number {
  const whip = parseFloat(stat.whip) || 1.30;
  // League avg WHIP ~1.25, range 1.00-1.60
  const normalized = Math.min(Math.max(1 - (whip - 1.00) / 0.60, 0), 1);
  return Math.round(normalized * 100);
}

// Rate defense
function rateDefense(stat: any): number {
  const fpct = parseFloat(stat.fielding) || 0.983;
  // Range typically .975-.990
  const normalized = Math.min(Math.max((fpct - 0.975) / 0.015, 0), 1);
  return Math.round(normalized * 100);
}

// Rate baserunning (stolen bases as proxy)
function rateBaserunning(stat: any): number {
  const sb = parseInt(stat.stolenBases) || 0;
  const gamesPlayed = parseInt(stat.gamesPlayed) || 1;
  const sbPerGame = sb / gamesPlayed;
  // League avg ~0.5 SB/game
  const normalized = Math.min(sbPerGame / 1.0, 1);
  return Math.round(normalized * 100);
}

// Build a default PitcherStats when we don't have detailed data
export function buildDefaultPitcher(name: string, team: string): PitcherStats {
  return {
    name: name || "TBD",
    team,
    era: 4.00,
    whip: 1.25,
    k9: 8.5,
    bb9: 3.0,
    fip: 4.00,
    velocity: 93,
    spinRate: 2200,
    pitchCount: 0,
    fatigueIndex: 0,
    handedness: "R",
  };
}

// Build GameState from MLB API live data
export function buildGameState(
  scoreData: any,
  homePitcherName: string,
  awayPitcherName: string
): GameState {
  return {
    inning: scoreData?.inning ?? 0,
    halfInning: (scoreData?.inningHalf ?? "top") as "top" | "bottom",
    outs: scoreData?.outs ?? 0,
    runners: { first: false, second: false, third: false },
    homeScore: scoreData?.homeScore ?? 0,
    visitorScore: scoreData?.awayScore ?? 0,
    homePitcher: buildDefaultPitcher(homePitcherName, "home"),
    visitorPitcher: buildDefaultPitcher(awayPitcherName, "away"),
    isLive: scoreData?.status === "live",
  };
}
