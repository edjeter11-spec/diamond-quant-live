// ──────────────────────────────────────────────────────────
// MLB Injury Report — ESPN public feed
//
// Mirrors lib/nba/injuries.ts against ESPN's MLB endpoint. Free, no key,
// one request for all 30 clubs (~275 players in-season).
//
// This is deliberately SEPARATE from lib/mlb/team-injuries.ts, which hits the
// MLB Stats API per-team to compute an injury edge for the model. That one is
// IL-only and skips pitchers; this one is the human-facing feed and keeps
// everyone, including day-to-day guys — the exact cases that move a line.
// ──────────────────────────────────────────────────────────

export interface InjuredPlayer {
  name: string;
  position?: string;
  status: string;
  /** ESPN's short blurb, e.g. "Soroka (glute) threw a bullpen session Monday" */
  detail?: string;
  date?: string;
}

export interface InjuryReport {
  team: string;
  teamAbbrev: string;
  players: InjuredPlayer[];
}

// ESPN full club name → the abbreviations used elsewhere in the app.
const ESPN_TEAM_ABBREV: Record<string, string> = {
  "Arizona Diamondbacks": "ARI",
  "Atlanta Braves": "ATL",
  "Baltimore Orioles": "BAL",
  "Boston Red Sox": "BOS",
  "Chicago Cubs": "CHC",
  "Chicago White Sox": "CWS",
  "Cincinnati Reds": "CIN",
  "Cleveland Guardians": "CLE",
  "Colorado Rockies": "COL",
  "Detroit Tigers": "DET",
  "Houston Astros": "HOU",
  "Kansas City Royals": "KC",
  "Los Angeles Angels": "LAA",
  "Los Angeles Dodgers": "LAD",
  "Miami Marlins": "MIA",
  "Milwaukee Brewers": "MIL",
  "Minnesota Twins": "MIN",
  "New York Mets": "NYM",
  "New York Yankees": "NYY",
  Athletics: "ATH",
  "Oakland Athletics": "ATH",
  "Philadelphia Phillies": "PHI",
  "Pittsburgh Pirates": "PIT",
  "San Diego Padres": "SD",
  "San Francisco Giants": "SF",
  "Seattle Mariners": "SEA",
  "St. Louis Cardinals": "STL",
  "Tampa Bay Rays": "TB",
  "Texas Rangers": "TEX",
  "Toronto Blue Jays": "TOR",
  "Washington Nationals": "WSH",
};

let cachedInjuries: { data: InjuryReport[]; ts: number } | null = null;

/**
 * Normalize ESPN's MLB status strings.
 *
 * MLB differs from NBA here: statuses are mostly IL stints ("15-Day-IL",
 * "60-Day-IL", "7-Day-IL") rather than game-time tags. Those all mean the
 * player is unavailable, so they collapse to "Out"; day-to-day is the only
 * genuinely uncertain case and is kept distinct.
 */
function normalizeStatus(raw: string): string {
  const s = (raw ?? "").toLowerCase();
  if (s.includes("day-to-day") || s.includes("day to day")) return "Day-To-Day";
  if (s.includes("il") || s.includes("out") || s.includes("suspension"))
    return "Out";
  if (s.includes("doubtful")) return "Doubtful";
  if (s.includes("questionable")) return "Questionable";
  if (s.includes("probable")) return "Probable";
  return raw || "Unknown";
}

/** Fetch every club's injury report. Cached 30 min in-process. */
export async function fetchMLBInjuries(): Promise<InjuryReport[]> {
  if (cachedInjuries && Date.now() - cachedInjuries.ts < 30 * 60 * 1000) {
    return cachedInjuries.data;
  }

  try {
    const res = await fetch(
      "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/injuries",
      { signal: AbortSignal.timeout(8000) },
    );
    // Serve stale rather than empty — a blank injury panel reads as
    // "nobody is hurt", which is worse than slightly old data.
    if (!res.ok) return cachedInjuries?.data ?? [];

    const data = await res.json();
    const reports: InjuryReport[] = [];

    for (const team of data.injuries ?? []) {
      const teamName: string = team.displayName ?? "";
      const players: InjuredPlayer[] = [];

      for (const inj of team.injuries ?? []) {
        const name = inj.athlete?.displayName;
        if (!name) continue;
        players.push({
          name,
          position: inj.athlete?.position?.abbreviation,
          status: normalizeStatus(inj.status),
          detail: inj.shortComment ?? inj.longComment ?? undefined,
          date: inj.date,
        });
      }

      if (players.length > 0) {
        reports.push({
          team: teamName,
          teamAbbrev: ESPN_TEAM_ABBREV[teamName] ?? "",
          players,
        });
      }
    }

    cachedInjuries = { data: reports, ts: Date.now() };
    return reports;
  } catch {
    return cachedInjuries?.data ?? [];
  }
}
