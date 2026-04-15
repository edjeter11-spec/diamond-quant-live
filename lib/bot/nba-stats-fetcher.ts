// ──────────────────────────────────────────────────────────
// NBA STATS FETCHER — Player Game Logs from stats.nba.com
// Fetches 3 seasons of historical data for brain training
// Caches in Supabase to avoid re-fetching
// ──────────────────────────────────────────────────────────

export interface NbaPlayerGameLog {
  playerId: number;
  playerName: string;
  team: string;
  gameId: string;
  gameDate: string;     // YYYY-MM-DD
  matchup: string;      // "LAL vs. BOS" or "LAL @ BOS"
  isHome: boolean;
  opponent: string;     // "BOS"
  minutes: number;
  pts: number;
  reb: number;
  ast: number;
  fg3m: number;
  fga: number;
  fgPct: number;
  ftPct: number;
  plusMinus: number;
  wl: string;           // "W" or "L"
}

const NBA_STATS_HEADERS = {
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://www.nba.com/",
  "Origin": "https://www.nba.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "x-nba-stats-origin": "stats",
  "x-nba-stats-token": "true",
};

const SEASON_MAP: Record<number, string> = {
  2022: "2022-23",
  2023: "2023-24",
  2024: "2024-25",
};

// ── Fetch one season of player game logs ──
export async function fetchSeasonGameLogs(season: string): Promise<NbaPlayerGameLog[]> {
  const url = `https://stats.nba.com/stats/playergamelogs?SeasonType=Regular+Season&Season=${season}`;

  const res = await fetch(url, { headers: NBA_STATS_HEADERS });
  if (!res.ok) throw new Error(`stats.nba.com returned ${res.status} for ${season}`);

  const data = await res.json();
  const resultSet = data.resultSets?.[0];
  if (!resultSet) throw new Error(`No resultSet for ${season}`);

  const headers: string[] = resultSet.headers;
  const rows: any[][] = resultSet.rowSet;

  // Build column index map
  const col = (name: string) => headers.indexOf(name);
  const iPlayerId = col("PLAYER_ID");
  const iPlayerName = col("PLAYER_NAME");
  const iTeam = col("TEAM_ABBREVIATION");
  const iGameId = col("GAME_ID");
  const iGameDate = col("GAME_DATE");
  const iMatchup = col("MATCHUP");
  const iWL = col("WL");
  const iMin = col("MIN");
  const iPts = col("PTS");
  const iReb = col("REB");
  const iAst = col("AST");
  const iFg3m = col("FG3M");
  const iFga = col("FGA");
  const iFgPct = col("FG_PCT");
  const iFtPct = col("FT_PCT");
  const iPM = col("PLUS_MINUS");

  return rows.map(row => {
    const matchup = row[iMatchup] ?? "";
    const isHome = matchup.includes("vs.");
    // Extract opponent: "LAL vs. BOS" → "BOS", "LAL @ BOS" → "BOS"
    const oppParts = matchup.split(isHome ? "vs." : "@");
    const opponent = (oppParts[1] ?? "").trim();

    return {
      playerId: row[iPlayerId] ?? 0,
      playerName: row[iPlayerName] ?? "",
      team: row[iTeam] ?? "",
      gameId: String(row[iGameId] ?? ""),
      gameDate: (row[iGameDate] ?? "").split("T")[0], // normalize to YYYY-MM-DD
      matchup,
      isHome,
      opponent,
      minutes: parseFloat(row[iMin]) || 0,
      pts: row[iPts] ?? 0,
      reb: row[iReb] ?? 0,
      ast: row[iAst] ?? 0,
      fg3m: row[iFg3m] ?? 0,
      fga: row[iFga] ?? 0,
      fgPct: row[iFgPct] ?? 0,
      ftPct: row[iFtPct] ?? 0,
      plusMinus: row[iPM] ?? 0,
      wl: row[iWL] ?? "",
    };
  });
}

// ── Fetch all training data (3 seasons) with caching ──
export async function fetchAllTrainingData(
  seasons: number[],
  onProgress?: (msg: string) => void
): Promise<NbaPlayerGameLog[]> {
  const allLogs: NbaPlayerGameLog[] = [];

  for (const year of seasons) {
    const seasonStr = SEASON_MAP[year];
    if (!seasonStr) continue;

    const cacheKey = `nba_gamelogs_${seasonStr}`;

    // Check Supabase cache first
    onProgress?.(`Checking cache for ${seasonStr}...`);
    try {
      const { cloudGet } = await import("@/lib/supabase/client");
      const cached = await cloudGet<NbaPlayerGameLog[] | null>(cacheKey, null);
      if (cached && cached.length > 1000) {
        onProgress?.(`Loaded ${cached.length} games from cache for ${seasonStr}`);
        allLogs.push(...cached);
        continue;
      }
    } catch {}

    // Fetch from stats.nba.com
    onProgress?.(`Fetching ${seasonStr} from stats.nba.com...`);
    try {
      const logs = await fetchSeasonGameLogs(seasonStr);
      onProgress?.(`Fetched ${logs.length} player-games for ${seasonStr}`);
      allLogs.push(...logs);

      // Cache in Supabase
      try {
        const { cloudSet } = await import("@/lib/supabase/client");
        await cloudSet(cacheKey, logs);
        onProgress?.(`Cached ${seasonStr} in Supabase`);
      } catch {}
    } catch (err: any) {
      onProgress?.(`Failed to fetch ${seasonStr}: ${err.message}`);
    }

    // Rate limit delay between seasons
    await new Promise(r => setTimeout(r, 2500));
  }

  // Sort by date ascending (oldest first) for chronological training
  allLogs.sort((a, b) => a.gameDate.localeCompare(b.gameDate));

  onProgress?.(`Total: ${allLogs.length} player-games across ${seasons.length} seasons`);
  return allLogs;
}
