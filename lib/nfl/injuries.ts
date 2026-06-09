// ──────────────────────────────────────────────────────────
// NFL Injury Reports — ESPN free API
// Practice status: Out (red), Doubtful, Questionable, Probable
// ──────────────────────────────────────────────────────────

export interface NFLInjuredPlayer {
  name: string;
  position: string;
  status: "Out" | "Doubtful" | "Questionable" | "Probable" | "IR" | string;
  detail?: string;
}

export interface NFLInjuryReport {
  team: string; // abbrev
  players: NFLInjuredPlayer[];
}

let CACHE: { ts: number; data: NFLInjuryReport[] } | null = null;
const CACHE_MS = 30 * 60 * 1000; // 30 min

export async function fetchNFLInjuries(): Promise<NFLInjuryReport[]> {
  if (CACHE && Date.now() - CACHE.ts < CACHE_MS) return CACHE.data;

  try {
    // ESPN has a free injury feed
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries`,
      { next: { revalidate: 1800 } },
    );
    if (!res.ok) return [];
    const data = await res.json();
    const reports: NFLInjuryReport[] = [];

    for (const team of data.injuries ?? []) {
      const teamAbbrev = team.team?.abbreviation ?? "";
      const players: NFLInjuredPlayer[] = [];
      for (const inj of team.injuries ?? []) {
        const athlete = inj.athlete ?? {};
        players.push({
          name: athlete.displayName ?? "",
          position: athlete.position?.abbreviation ?? "",
          status: inj.status ?? "Questionable",
          detail: inj.details?.detail ?? inj.shortComment ?? "",
        });
      }
      reports.push({ team: teamAbbrev, players });
    }

    CACHE = { ts: Date.now(), data: reports };
    return reports;
  } catch {
    return [];
  }
}

export async function isNFLPlayerInjured(playerName: string): Promise<NFLInjuredPlayer | null> {
  const reports = await fetchNFLInjuries();
  const lower = playerName.toLowerCase();
  for (const team of reports) {
    for (const p of team.players) {
      if (p.name.toLowerCase() === lower) return p;
    }
  }
  return null;
}

export async function getNFLTeamInjuries(teamAbbrev: string): Promise<NFLInjuredPlayer[]> {
  const reports = await fetchNFLInjuries();
  const team = reports.find((r) => r.team.toUpperCase() === teamAbbrev.toUpperCase());
  return team?.players ?? [];
}

// Convert injury status → projection impact (multiplier on the player's projection)
export function nflInjuryImpact(status: string): { skipProjection: boolean; multiplier: number } {
  const s = status.toLowerCase();
  if (s.includes("out") || s.includes("ir")) return { skipProjection: true, multiplier: 0 };
  if (s.includes("doubtful")) return { skipProjection: true, multiplier: 0.4 };
  if (s.includes("questionable")) return { skipProjection: false, multiplier: 0.85 };
  return { skipProjection: false, multiplier: 1 };
}
