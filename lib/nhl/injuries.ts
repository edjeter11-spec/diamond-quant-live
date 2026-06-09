// ──────────────────────────────────────────────────────────
// NHL Injuries — ESPN free injury feed
// ──────────────────────────────────────────────────────────

export interface NHLInjuredPlayer {
  name: string;
  position: string;
  status: string;
  detail?: string;
}

export interface NHLInjuryReport {
  team: string;
  players: NHLInjuredPlayer[];
}

let CACHE: { ts: number; data: NHLInjuryReport[] } | null = null;
const CACHE_MS = 30 * 60 * 1000;

export async function fetchNHLInjuries(): Promise<NHLInjuryReport[]> {
  if (CACHE && Date.now() - CACHE.ts < CACHE_MS) return CACHE.data;

  try {
    const res = await fetch(
      "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries",
      { next: { revalidate: 1800 } },
    );
    if (!res.ok) return [];
    const data = await res.json();
    const reports: NHLInjuryReport[] = [];
    for (const team of data.injuries ?? []) {
      const players: NHLInjuredPlayer[] = [];
      for (const inj of team.injuries ?? []) {
        players.push({
          name: inj.athlete?.displayName ?? "",
          position: inj.athlete?.position?.abbreviation ?? "",
          status: inj.status ?? "Questionable",
          detail: inj.details?.detail ?? inj.shortComment ?? "",
        });
      }
      reports.push({ team: team.team?.abbreviation ?? "", players });
    }
    CACHE = { ts: Date.now(), data: reports };
    return reports;
  } catch {
    return [];
  }
}

export async function getNHLTeamInjuries(teamAbbrev: string): Promise<NHLInjuredPlayer[]> {
  const reports = await fetchNHLInjuries();
  return reports.find((r) => r.team.toUpperCase() === teamAbbrev.toUpperCase())?.players ?? [];
}

export async function isNHLPlayerInjured(playerName: string): Promise<NHLInjuredPlayer | null> {
  const reports = await fetchNHLInjuries();
  const lower = playerName.toLowerCase();
  for (const t of reports) for (const p of t.players) {
    if (p.name.toLowerCase() === lower) return p;
  }
  return null;
}

export function nhlInjuryImpact(status: string): { skipProjection: boolean; multiplier: number } {
  const s = status.toLowerCase();
  if (s.includes("out") || s.includes("ltir") || s.includes("ir")) return { skipProjection: true, multiplier: 0 };
  if (s.includes("doubtful")) return { skipProjection: true, multiplier: 0.4 };
  if (s.includes("day-to-day") || s.includes("questionable")) return { skipProjection: false, multiplier: 0.85 };
  return { skipProjection: false, multiplier: 1 };
}
