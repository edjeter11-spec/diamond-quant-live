// ──────────────────────────────────────────────────────────
// NFL Stats — ESPN public API
// Game logs, season averages, schedule, scores
// ──────────────────────────────────────────────────────────

export interface NFLGameLog {
  gameId: string;
  week: number;
  date: string;
  opponent: string;
  isHome: boolean;
  // QB stats
  passYds?: number;
  passTds?: number;
  passAttempts?: number;
  passCompletions?: number;
  // RB stats
  rushYds?: number;
  rushAttempts?: number;
  rushTds?: number;
  // WR/TE stats
  receptions?: number;
  receivingYds?: number;
  receivingTds?: number;
}

export interface NFLPlayerSeasonAvg {
  playerName: string;
  position: string;
  team: string;
  gamesPlayed: number;
  // Aggregated season averages
  passYdsPerGame?: number;
  passTdsPerGame?: number;
  passAttemptsPerGame?: number;
  rushYdsPerGame?: number;
  rushAttemptsPerGame?: number;
  receptionsPerGame?: number;
  receivingYdsPerGame?: number;
  // Last 5 games trend
  last5Avg: Partial<NFLGameLog>;
}

const NFL_SCHEDULE_CACHE = new Map<string, { ts: number; data: any }>();
const CACHE_MS = 60 * 60 * 1000;

// Today's NFL games via ESPN scoreboard
export async function fetchTodayNFLGames(): Promise<any[]> {
  try {
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard`,
      { next: { revalidate: 300 } },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.events ?? [];
  } catch {
    return [];
  }
}

// Get NFL game status (final / live / pre)
export function getNFLGameStatus(event: any): "final" | "live" | "pre" {
  const status = event.status?.type?.name ?? "";
  if (status.includes("FINAL")) return "final";
  if (status.includes("IN_PROGRESS") || status.includes("HALFTIME")) return "live";
  return "pre";
}

// Box score → player stats array
export async function fetchNFLBoxScore(gameId: string): Promise<{ playerName: string; position: string; stats: Partial<NFLGameLog> }[]> {
  try {
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${gameId}`,
      { next: { revalidate: 300 } },
    );
    if (!res.ok) return [];
    const data = await res.json();
    const players: { playerName: string; position: string; stats: Partial<NFLGameLog> }[] = [];

    // ESPN boxscore.players → array of teams → each has statistics by category
    for (const team of data.boxscore?.players ?? []) {
      for (const stat of team.statistics ?? []) {
        const category = (stat.name ?? "").toLowerCase(); // "passing" | "rushing" | "receiving"
        const labels: string[] = stat.labels ?? [];
        for (const athlete of stat.athletes ?? []) {
          const name = athlete.athlete?.displayName ?? "";
          if (!name) continue;
          const values: string[] = athlete.stats ?? [];
          const stats: Partial<NFLGameLog> = {};

          // Match ESPN's stat label conventions
          for (let i = 0; i < labels.length; i++) {
            const v = parseFloat(values[i] ?? "0") || 0;
            const label = labels[i];
            if (category === "passing") {
              if (label === "YDS") stats.passYds = v;
              else if (label === "TD") stats.passTds = v;
              else if (label === "C/ATT") {
                const [c, a] = String(values[i] ?? "0/0").split("/").map(Number);
                stats.passCompletions = c || 0;
                stats.passAttempts = a || 0;
              }
            } else if (category === "rushing") {
              if (label === "YDS") stats.rushYds = v;
              else if (label === "TD") stats.rushTds = v;
              else if (label === "CAR") stats.rushAttempts = v;
            } else if (category === "receiving") {
              if (label === "YDS") stats.receivingYds = v;
              else if (label === "TD") stats.receivingTds = v;
              else if (label === "REC") stats.receptions = v;
            }
          }

          // Merge if same player appears in multiple categories
          const existing = players.find((p) => p.playerName === name);
          if (existing) Object.assign(existing.stats, stats);
          else players.push({ playerName: name, position: athlete.athlete?.position?.abbreviation ?? "", stats });
        }
      }
    }
    return players;
  } catch {
    return [];
  }
}

// Find a player's ESPN ID from name (used for stat lookup)
export async function searchNFLPlayer(name: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://site.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(name)}&type=player&sport=football&league=nfl`,
      { next: { revalidate: 86400 } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const hit = data.results?.[0]?.contents?.[0];
    return hit?.id ? String(hit.id) : null;
  } catch {
    return null;
  }
}

// Season averages for a player by ESPN ID
export async function fetchPlayerSeasonStats(playerId: string): Promise<NFLPlayerSeasonAvg | null> {
  try {
    const res = await fetch(
      `https://site.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${playerId}/statistics`,
      { next: { revalidate: 3600 } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const splits = data.splits?.categories ?? [];
    let games = 0;
    let passYds = 0, passTds = 0, passAtt = 0;
    let rushYds = 0, rushAtt = 0;
    let rec = 0, recYds = 0;
    for (const cat of splits) {
      const stats = cat.stats ?? [];
      for (const s of stats) {
        const v = parseFloat(s.value ?? "0") || 0;
        const name = (s.name ?? "").toLowerCase();
        if (name === "gamesplayed") games = v;
        if (name === "passingyards") passYds = v;
        if (name === "passingtouchdowns") passTds = v;
        if (name === "passingattempts") passAtt = v;
        if (name === "rushingyards") rushYds = v;
        if (name === "rushingattempts") rushAtt = v;
        if (name === "receptions") rec = v;
        if (name === "receivingyards") recYds = v;
      }
    }
    if (games <= 0) return null;
    return {
      playerName: data.athlete?.displayName ?? "",
      position: data.athlete?.position?.abbreviation ?? "",
      team: data.athlete?.team?.abbreviation ?? "",
      gamesPlayed: games,
      passYdsPerGame: passYds / games,
      passTdsPerGame: passTds / games,
      passAttemptsPerGame: passAtt / games,
      rushYdsPerGame: rushYds / games,
      rushAttemptsPerGame: rushAtt / games,
      receptionsPerGame: rec / games,
      receivingYdsPerGame: recYds / games,
      last5Avg: {},
    };
  } catch {
    return null;
  }
}
