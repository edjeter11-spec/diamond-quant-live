// ──────────────────────────────────────────────────────────
// NBA INJURY FEED — ESPN free API
// Fetches current injuries for all NBA teams
// Brain uses this to adjust prop projections (out = void, GTD = reduce)
// ──────────────────────────────────────────────────────────

export interface InjuryReport {
  team: string;           // "Atlanta Hawks"
  teamAbbrev: string;     // "ATL"
  players: InjuredPlayer[];
}

export interface InjuredPlayer {
  name: string;           // "Trae Young"
  status: "Out" | "Day-To-Day" | "Questionable" | "Probable" | "Doubtful";
  shortComment: string;   // "Young (ankle) is questionable for Monday's game"
  date: string;           // last updated
}

// ESPN NBA team name → abbreviation (for matching)
const ESPN_TEAM_ABBREV: Record<string, string> = {
  "Atlanta Hawks": "ATL", "Boston Celtics": "BOS", "Brooklyn Nets": "BKN",
  "Charlotte Hornets": "CHA", "Chicago Bulls": "CHI", "Cleveland Cavaliers": "CLE",
  "Dallas Mavericks": "DAL", "Denver Nuggets": "DEN", "Detroit Pistons": "DET",
  "Golden State Warriors": "GSW", "Houston Rockets": "HOU", "Indiana Pacers": "IND",
  "LA Clippers": "LAC", "Los Angeles Clippers": "LAC", "Los Angeles Lakers": "LAL",
  "Memphis Grizzlies": "MEM", "Miami Heat": "MIA", "Milwaukee Bucks": "MIL",
  "Minnesota Timberwolves": "MIN", "New Orleans Pelicans": "NOP", "New York Knicks": "NYK",
  "Oklahoma City Thunder": "OKC", "Orlando Magic": "ORL", "Philadelphia 76ers": "PHI",
  "Phoenix Suns": "PHX", "Portland Trail Blazers": "POR", "Sacramento Kings": "SAC",
  "San Antonio Spurs": "SAS", "Toronto Raptors": "TOR", "Utah Jazz": "UTA",
  "Washington Wizards": "WAS",
};

let cachedInjuries: { data: InjuryReport[]; ts: number } | null = null;

// ── Fetch injuries from ESPN (cached 30 min) ──
export async function fetchNBAInjuries(): Promise<InjuryReport[]> {
  // Return cache if fresh
  if (cachedInjuries && Date.now() - cachedInjuries.ts < 30 * 60 * 1000) {
    return cachedInjuries.data;
  }

  try {
    const res = await fetch("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries");
    if (!res.ok) return cachedInjuries?.data ?? [];

    const data = await res.json();
    const reports: InjuryReport[] = [];

    for (const team of data.injuries ?? []) {
      const teamName = team.displayName ?? "";
      const abbrev = ESPN_TEAM_ABBREV[teamName] ?? "";

      const players: InjuredPlayer[] = [];
      for (const inj of team.injuries ?? []) {
        const status = inj.status as string;
        const normalizedStatus =
          status === "Out" ? "Out" :
          status === "Day-To-Day" ? "Day-To-Day" :
          status?.includes("Questionable") ? "Questionable" :
          status?.includes("Probable") ? "Probable" :
          status?.includes("Doubtful") ? "Doubtful" : "Day-To-Day";

        players.push({
          name: inj.athlete?.displayName ?? "",
          status: normalizedStatus as InjuredPlayer["status"],
          shortComment: inj.shortComment ?? "",
          date: inj.date ?? "",
        });
      }

      if (players.length > 0) {
        reports.push({ team: teamName, teamAbbrev: abbrev, players });
      }
    }

    cachedInjuries = { data: reports, ts: Date.now() };
    return reports;
  } catch {
    return cachedInjuries?.data ?? [];
  }
}

// ── Check if a specific player is injured ──
export async function isPlayerInjured(playerName: string): Promise<InjuredPlayer | null> {
  const injuries = await fetchNBAInjuries();
  const nameLower = playerName.toLowerCase();

  for (const team of injuries) {
    for (const player of team.players) {
      if (player.name.toLowerCase() === nameLower) return player;
      // Fuzzy: last name match
      const lastName = playerName.split(" ").pop()?.toLowerCase() ?? "";
      const injLastName = player.name.split(" ").pop()?.toLowerCase() ?? "";
      if (lastName.length > 3 && lastName === injLastName) return player;
    }
  }
  return null;
}

// ── Get all injured players for a team ──
export async function getTeamInjuries(teamAbbrev: string): Promise<InjuredPlayer[]> {
  const injuries = await fetchNBAInjuries();
  const team = injuries.find(r => r.teamAbbrev === teamAbbrev);
  return team?.players ?? [];
}

// ── Impact multiplier for prop projections ──
// Out = don't project (void), Day-To-Day = reduce confidence
export function getInjuryImpact(status: InjuredPlayer["status"]): {
  shouldProject: boolean;
  confidenceMultiplier: number; // 0-1 (1 = full confidence, 0 = void)
  description: string;
} {
  switch (status) {
    case "Out":
      return { shouldProject: false, confidenceMultiplier: 0, description: "OUT — skip prop projection" };
    case "Doubtful":
      return { shouldProject: false, confidenceMultiplier: 0.1, description: "DOUBTFUL — likely out" };
    case "Questionable":
      return { shouldProject: true, confidenceMultiplier: 0.6, description: "GTD — reduced confidence" };
    case "Day-To-Day":
      return { shouldProject: true, confidenceMultiplier: 0.7, description: "DTD — may be limited" };
    case "Probable":
      return { shouldProject: true, confidenceMultiplier: 0.9, description: "PROBABLE — likely plays" };
    default:
      return { shouldProject: true, confidenceMultiplier: 1, description: "Active" };
  }
}
