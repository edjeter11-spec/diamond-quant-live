// ──────────────────────────────────────────────────────────
// MLB Stats API Connector (Free, no key required)
// https://statsapi.mlb.com/api/v1/
// ──────────────────────────────────────────────────────────

const MLB_API = "https://statsapi.mlb.com/api/v1";

export interface MLBGame {
  gamePk: number;
  gameDate: string;
  status: { statusCode: string; detailedState: string };
  teams: {
    home: { team: { id: number; name: string }; score?: number; probablePitcher?: MLBPitcher };
    away: { team: { id: number; name: string }; score?: number; probablePitcher?: MLBPitcher };
  };
  venue: { name: string; id: number };
  linescore?: {
    currentInning: number;
    currentInningOrdinal: string;
    inningHalf: string;
    outs: number;
    offense?: { first?: object; second?: object; third?: object };
  };
  weather?: { condition: string; temp: string; wind: string };
}

export interface MLBPitcher {
  id: number;
  fullName: string;
  stats?: {
    era: string;
    wins: number;
    losses: number;
    strikeOuts: number;
    whip: string;
  };
}

export interface MLBTeamStats {
  teamId: number;
  teamName: string;
  wins: number;
  losses: number;
  runsScored: number;
  runsAllowed: number;
  battingAvg: number;
  ops: number;
  era: number;
  whip: number;
  bullpenEra: number;
  lastTenRecord: string;
}

// Fetch today's schedule with live data
export async function fetchTodayGames(): Promise<MLBGame[]> {
  const today = new Date().toISOString().split("T")[0];
  const url = `${MLB_API}/schedule?sportId=1&date=${today}&hydrate=probablePitcher,linescore,weather,team`;

  const res = await fetch(url, { next: { revalidate: 15 } });
  if (!res.ok) throw new Error(`MLB API error: ${res.status}`);

  const data = await res.json();
  return data.dates?.[0]?.games ?? [];
}

// Fetch schedule for a specific ISO date (YYYY-MM-DD)
export async function fetchGamesForDate(date: string): Promise<MLBGame[]> {
  const url = `${MLB_API}/schedule?sportId=1&date=${date}&hydrate=probablePitcher,linescore,weather,team`;
  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) return [];
  const data = await res.json();
  return data.dates?.[0]?.games ?? [];
}

// Fetch live game data (updates every ~10 seconds during games)
export async function fetchLiveGame(gamePk: number): Promise<{
  linescore: any;
  boxscore: any;
  plays: any;
}> {
  const url = `${MLB_API}.1/game/${gamePk}/feed/live`;
  const res = await fetch(url, { next: { revalidate: 10 } });
  if (!res.ok) throw new Error(`Live game API error: ${res.status}`);

  const data = await res.json();
  return {
    linescore: data.liveData?.linescore,
    boxscore: data.liveData?.boxscore,
    plays: data.liveData?.plays,
  };
}

// Fetch team season stats
export async function fetchTeamStats(teamId: number, season?: number): Promise<any> {
  const year = season ?? new Date().getFullYear();
  const url = `${MLB_API}/teams/${teamId}/stats?stats=season&season=${year}&group=hitting,pitching,fielding`;

  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`Team stats API error: ${res.status}`);

  return res.json();
}

// Fetch pitcher game log
export async function fetchPitcherStats(pitcherId: number, season?: number): Promise<any> {
  const year = season ?? new Date().getFullYear();
  const url = `${MLB_API}/people/${pitcherId}/stats?stats=season,gameLog&season=${year}&group=pitching`;

  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`Pitcher stats API error: ${res.status}`);

  return res.json();
}

// Fetch team roster
export async function fetchRoster(teamId: number): Promise<any> {
  const url = `${MLB_API}/teams/${teamId}/roster/active`;
  const res = await fetch(url, { next: { revalidate: 600 } });
  if (!res.ok) throw new Error(`Roster API error: ${res.status}`);
  return res.json();
}

// Fetch standings
export async function fetchStandings(): Promise<any> {
  const url = `${MLB_API}/standings?leagueId=103,104`;
  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`Standings API error: ${res.status}`);
  return res.json();
}

// Parse game status
export function getGameStatus(game: MLBGame): "pre" | "live" | "final" {
  const code = game.status.statusCode;
  if (code === "F" || code === "O" || code === "DR") return "final";
  if (code === "I" || code === "MA" || code === "MF") return "live";
  return "pre";
}

// Format team abbreviation from full name
const TEAM_ABBREVS: Record<string, string> = {
  "Arizona Diamondbacks": "ARI", "Atlanta Braves": "ATL", "Baltimore Orioles": "BAL",
  "Boston Red Sox": "BOS", "Chicago Cubs": "CHC", "Chicago White Sox": "CWS",
  "Cincinnati Reds": "CIN", "Cleveland Guardians": "CLE", "Colorado Rockies": "COL",
  "Detroit Tigers": "DET", "Houston Astros": "HOU", "Kansas City Royals": "KC",
  "Los Angeles Angels": "LAA", "Los Angeles Dodgers": "LAD", "Miami Marlins": "MIA",
  "Milwaukee Brewers": "MIL", "Minnesota Twins": "MIN", "New York Mets": "NYM",
  "New York Yankees": "NYY", "Oakland Athletics": "OAK", "Philadelphia Phillies": "PHI",
  "Pittsburgh Pirates": "PIT", "San Diego Padres": "SD", "San Francisco Giants": "SF",
  "Seattle Mariners": "SEA", "St. Louis Cardinals": "STL", "Tampa Bay Rays": "TB",
  "Texas Rangers": "TEX", "Toronto Blue Jays": "TOR", "Washington Nationals": "WSH",
};

export function getTeamAbbrev(teamName: string): string {
  return TEAM_ABBREVS[teamName] ?? teamName.slice(0, 3).toUpperCase();
}
