// ──────────────────────────────────────────────────────────
// NBA Player Stats — Game logs, season averages, matchup data
// Uses balldontlie API (free) for stats
// ──────────────────────────────────────────────────────────

const BDL_API = "https://api.balldontlie.io/v1";

export interface NBAPlayerProfile {
  id: number;
  name: string;
  team: string;
  teamAbbrev: string;
  position: string;
  number: string;
  photo: string;
  // Season averages
  ppg: number;
  rpg: number;
  apg: number;
  spg: number;
  bpg: number;
  fgPct: number;
  threePct: number;
  ftPct: number;
  mpg: number;
  gamesPlayed: number;
  // Game log (last 10-15)
  gameLog: NBAGameLogEntry[];
  // For prop analysis
  statAvg: Record<string, number>; // market -> average
  hitRates: Record<string, { line: number; overCount: number; total: number; rate: number }>;
}

export interface NBAGameLogEntry {
  date: string;
  opponent: string;
  points: number;
  rebounds: number;
  assists: number;
  threes: number;
  steals: number;
  blocks: number;
  minutes: number;
  pra: number; // points + rebounds + assists
}

// Search for an NBA player
export async function searchNBAPlayer(name: string): Promise<{ id: number; name: string; team: string; position: string } | null> {
  try {
    const res = await fetch(`${BDL_API}/players?search=${encodeURIComponent(name)}&per_page=5`);
    if (!res.ok) return null;
    const data = await res.json();
    const players = data.data ?? [];
    if (players.length === 0) return null;

    // Find best match
    const nameLower = name.toLowerCase();
    const match = players.find((p: any) =>
      `${p.first_name} ${p.last_name}`.toLowerCase() === nameLower
    ) ?? players.find((p: any) =>
      `${p.first_name} ${p.last_name}`.toLowerCase().includes(nameLower) ||
      nameLower.includes(p.last_name?.toLowerCase())
    ) ?? players[0];

    return {
      id: match.id,
      name: `${match.first_name} ${match.last_name}`,
      team: match.team?.full_name ?? "Unknown",
      position: match.position ?? "?",
    };
  } catch {
    return null;
  }
}

// Get NBA player season averages
export async function getNBAPlayerAverages(playerId: number, season?: number): Promise<any> {
  const yr = season ?? new Date().getFullYear();
  // Try current season, then last season
  for (const s of [yr, yr - 1]) {
    try {
      const res = await fetch(`${BDL_API}/season_averages?season=${s}&player_ids[]=${playerId}`);
      if (!res.ok) continue;
      const data = await res.json();
      if (data.data?.length > 0) return { ...data.data[0], season: s };
    } catch {}
  }
  return null;
}

// Get NBA player game log (last N games)
export async function getNBAGameLog(playerId: number, limit: number = 15): Promise<NBAGameLogEntry[]> {
  try {
    const season = new Date().getFullYear();
    // Try current season first, then last
    for (const s of [season, season - 1]) {
      const res = await fetch(`${BDL_API}/stats?player_ids[]=${playerId}&seasons[]=${s}&per_page=${limit}&sort=-date`);
      if (!res.ok) continue;
      const data = await res.json();
      const stats = data.data ?? [];
      if (stats.length === 0) continue;

      return stats.map((g: any) => ({
        date: g.game?.date?.split("T")[0] ?? "",
        opponent: g.game?.home_team_id === g.player?.team_id
          ? `vs ${g.game?.visitor_team?.abbreviation ?? "?"}`
          : `@ ${g.game?.home_team?.abbreviation ?? "?"}`,
        points: g.pts ?? 0,
        rebounds: g.reb ?? 0,
        assists: g.ast ?? 0,
        threes: g.fg3m ?? 0,
        steals: g.stl ?? 0,
        blocks: g.blk ?? 0,
        minutes: parseInt(g.min) || 0,
        pra: (g.pts ?? 0) + (g.reb ?? 0) + (g.ast ?? 0),
      }));
    }
    return [];
  } catch {
    return [];
  }
}

// Build full player profile for prop analysis
export async function buildNBAPlayerProfile(
  playerName: string,
  market: string,
  line: number
): Promise<NBAPlayerProfile | null> {
  const player = await searchNBAPlayer(playerName);
  if (!player) return null;

  const [averages, gameLog] = await Promise.all([
    getNBAPlayerAverages(player.id),
    getNBAGameLog(player.id),
  ]);

  const teamAbbrev = player.team.split(" ").pop()?.slice(0, 3).toUpperCase() ?? "?";

  // NBA headshot
  const photo = `https://cdn.nba.com/headshots/nba/latest/260x190/${player.id}.png`;

  const profile: NBAPlayerProfile = {
    id: player.id,
    name: player.name,
    team: player.team,
    teamAbbrev,
    position: player.position,
    number: "",
    photo,
    ppg: averages?.pts ?? 0,
    rpg: averages?.reb ?? 0,
    apg: averages?.ast ?? 0,
    spg: averages?.stl ?? 0,
    bpg: averages?.blk ?? 0,
    fgPct: Math.round((averages?.fg_pct ?? 0) * 1000) / 10,
    threePct: Math.round((averages?.fg3_pct ?? 0) * 1000) / 10,
    ftPct: Math.round((averages?.ft_pct ?? 0) * 1000) / 10,
    mpg: averages?.min ? parseFloat(averages.min) : 0,
    gamesPlayed: averages?.games_played ?? 0,
    gameLog,
    statAvg: {},
    hitRates: {},
  };

  // Calculate stat averages from game log
  const statMap: Record<string, (g: NBAGameLogEntry) => number> = {
    player_points: (g) => g.points,
    player_rebounds: (g) => g.rebounds,
    player_assists: (g) => g.assists,
    player_threes: (g) => g.threes,
    player_pra: (g) => g.pra,
  };

  for (const [mkt, getter] of Object.entries(statMap)) {
    const vals = gameLog.map(getter);
    profile.statAvg[mkt] = vals.length > 0
      ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10
      : 0;

    // Hit rate for this market at the given line
    const overCount = vals.filter(v => v > line).length;
    profile.hitRates[mkt] = {
      line,
      overCount,
      total: vals.length,
      rate: vals.length > 0 ? Math.round((overCount / vals.length) * 100) : 50,
    };
  }

  return profile;
}

// Get photo URL for NBA player by name (quick, no API call)
export function getNBAPlayerPhotoByName(playerName: string): string {
  // We can't get the ID without an API call, so return empty
  // The full profile fetch will provide the photo
  return "";
}
