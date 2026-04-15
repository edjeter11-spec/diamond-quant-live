// ──────────────────────────────────────────────────────────
// NBA Player Stats — Using free NBA CDN (no API key needed)
// Player index has: name, team, jersey, position, PPG, RPG, APG
// Photos from cdn.nba.com/headshots
// ──────────────────────────────────────────────────────────

import { getCached, setCache } from "@/lib/odds/server-cache";

const NBA_CDN = "https://cdn.nba.com/static/json/staticData/playerIndex.json";

interface NBAPlayerRaw {
  id: number;
  firstName: string;
  lastName: string;
  team: string;
  teamAbbrev: string;
  jersey: string;
  position: string;
  ppg: number;
  rpg: number;
  apg: number;
}

// Load the full player index (cached 1hr in memory, saved to Supabase daily)
async function loadPlayerIndex(): Promise<NBAPlayerRaw[]> {
  const cached = getCached("nba_player_index", 3600_000);
  if (cached) return cached;

  // Try Supabase first (saved from previous day)
  try {
    const { cloudGet } = await import("@/lib/supabase/client");
    const cloud = await cloudGet<{ players: NBAPlayerRaw[]; date: string }>("nba_player_index", null as any);
    if (cloud?.players?.length > 0) {
      const age = (Date.now() - new Date(cloud.date).getTime()) / 3600000;
      if (age < 24) { // less than 24 hours old
        setCache("nba_player_index", cloud.players);
        return cloud.players;
      }
    }
  } catch {}

  try {
    const res = await fetch(NBA_CDN, { next: { revalidate: 3600 } });
    if (!res.ok) return [];
    const data = await res.json();
    const headers = data.resultSets?.[0]?.headers ?? [];
    const rows = data.resultSets?.[0]?.rowSet ?? [];

    const idIdx = headers.indexOf("PERSON_ID");
    const lastIdx = headers.indexOf("PLAYER_LAST_NAME");
    const firstIdx = headers.indexOf("PLAYER_FIRST_NAME");
    const teamAbbrIdx = headers.indexOf("TEAM_ABBREVIATION");
    const teamNameIdx = headers.indexOf("TEAM_NAME");
    const jerseyIdx = headers.indexOf("JERSEY_NUMBER");
    const posIdx = headers.indexOf("POSITION");
    const ptsIdx = headers.indexOf("PTS");
    const rebIdx = headers.indexOf("REB");
    const astIdx = headers.indexOf("AST");
    const rosterIdx = headers.indexOf("ROSTER_STATUS");

    const players: NBAPlayerRaw[] = rows
      .filter((r: any) => r[rosterIdx] === 1.0) // active players only
      .map((r: any) => ({
        id: r[idIdx],
        firstName: r[firstIdx],
        lastName: r[lastIdx],
        team: `${r[teamAbbrIdx]} ${r[teamNameIdx] ?? ""}`.trim(),
        teamAbbrev: r[teamAbbrIdx] ?? "",
        jersey: r[jerseyIdx] ?? "",
        position: r[posIdx] ?? "",
        ppg: r[ptsIdx] ?? 0,
        rpg: r[rebIdx] ?? 0,
        apg: r[astIdx] ?? 0,
      }));

    setCache("nba_player_index", players);

    // Save to Supabase so next load is instant
    try {
      const { cloudSet } = await import("@/lib/supabase/client");
      await cloudSet("nba_player_index", { players, date: new Date().toISOString() });
    } catch {}

    return players;
  } catch {
    return [];
  }
}

// Search for a player by name
export async function searchNBAPlayer(name: string): Promise<NBAPlayerRaw | null> {
  const players = await loadPlayerIndex();
  if (players.length === 0) return null;

  const nameLower = name.toLowerCase().trim();
  const words = nameLower.split(" ");

  // Exact match
  let match = players.find(p =>
    `${p.firstName} ${p.lastName}`.toLowerCase() === nameLower
  );

  // Last name match
  if (!match) {
    match = players.find(p =>
      p.lastName.toLowerCase() === (words[words.length - 1] ?? "") &&
      (words.length === 1 || p.firstName.toLowerCase().startsWith(words[0]?.slice(0, 3) ?? ""))
    );
  }

  // Contains match
  if (!match) {
    match = players.find(p => {
      const full = `${p.firstName} ${p.lastName}`.toLowerCase();
      return words.every(w => full.includes(w));
    });
  }

  return match ?? null;
}

// Build full profile for prop analysis
export interface NBAPlayerProfile {
  id: number;
  name: string;
  team: string;
  teamAbbrev: string;
  position: string;
  number: string;
  photo: string;
  ppg: number;
  rpg: number;
  apg: number;
  gamesPlayed: number;
  // These come from season stats (not in the index)
  fgPct: number;
  threePct: number;
  ftPct: number;
  mpg: number;
  spg: number;
  bpg: number;
  gameLog: any[];
  statAvg: Record<string, number>;
  hitRates: Record<string, { line: number; overCount: number; total: number; rate: number }>;
}

export async function buildNBAPlayerProfile(
  playerName: string,
  market: string,
  line: number
): Promise<NBAPlayerProfile | null> {
  const player = await searchNBAPlayer(playerName);
  if (!player) return null;

  const photo = `https://cdn.nba.com/headshots/nba/latest/260x190/${player.id}.png`;

  const profile: NBAPlayerProfile = {
    id: player.id,
    name: `${player.firstName} ${player.lastName}`,
    team: player.team,
    teamAbbrev: player.teamAbbrev,
    position: player.position,
    number: player.jersey,
    photo,
    ppg: player.ppg,
    rpg: player.rpg,
    apg: player.apg,
    gamesPlayed: 0,
    fgPct: 0, threePct: 0, ftPct: 0, mpg: 0, spg: 0, bpg: 0,
    gameLog: [],
    statAvg: {
      player_points: player.ppg,
      player_rebounds: player.rpg,
      player_assists: player.apg,
      player_threes: 0,
      player_pra: player.ppg + player.rpg + player.apg,
    },
    hitRates: {},
  };

  // Calculate hit rate based on season average vs line
  const statMap: Record<string, number> = {
    player_points: player.ppg,
    player_rebounds: player.rpg,
    player_assists: player.apg,
    player_pra: player.ppg + player.rpg + player.apg,
  };

  for (const [mkt, avg] of Object.entries(statMap)) {
    // Estimate hit rate from average vs line using normal distribution approximation
    const diff = avg - line;
    const stdDev = avg * 0.3; // ~30% variance typical for NBA
    const zScore = stdDev > 0 ? diff / stdDev : 0;
    // Approximate: z-score of 0 = 50%, +1 = 84%, -1 = 16%
    const rate = Math.min(95, Math.max(5, Math.round(50 + zScore * 34)));

    profile.hitRates[mkt] = { line, overCount: 0, total: 0, rate };
  }

  return profile;
}

export function getNBAPlayerPhotoByName(playerName: string): string {
  return "";
}
