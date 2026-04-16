// ──────────────────────────────────────────────────────────
// NBA STATS FETCHER — REAL Game Logs from NBA CDN
// Uses cdn.nba.com box scores (free, no auth, no blocking)
// Schedule endpoint gives all game IDs for the season
// Box score endpoint gives per-player stats per game
// ──────────────────────────────────────────────────────────

export interface NbaPlayerGameLog {
  playerId: number;
  playerName: string;
  team: string;
  gameId: string;
  gameDate: string;
  matchup: string;
  isHome: boolean;
  opponent: string;
  minutes: number;
  pts: number;
  reb: number;
  ast: number;
  fg3m: number;
  fga: number;
  fgPct: number;
  ftPct: number;
  plusMinus: number;
  wl: string;
}

// ── Fetch season schedule from CDN → list of final game IDs ──
async function fetchSeasonGameIds(onProgress?: (msg: string) => void): Promise<Array<{ gameId: string; gameDate: string; homeTeam: string; awayTeam: string; homeScore: number; awayScore: number }>> {
  const res = await fetch("https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json");
  if (!res.ok) throw new Error("Failed to fetch NBA schedule");
  const data = await res.json();

  const games: Array<{ gameId: string; gameDate: string; homeTeam: string; awayTeam: string; homeScore: number; awayScore: number }> = [];

  for (const dateGroup of data.leagueSchedule?.gameDates ?? []) {
    for (const game of dateGroup.games ?? []) {
      // Only include regular season + playoff games that are Final
      if (game.gameStatus !== 3) continue;
      const gameId = game.gameId;
      // Regular season IDs start with "002", preseason "001", playoffs "004"
      if (!gameId?.startsWith("002") && !gameId?.startsWith("004")) continue;

      games.push({
        gameId,
        gameDate: game.gameDateEst?.split("T")[0] ?? "",
        homeTeam: game.homeTeam?.teamTricode ?? "",
        awayTeam: game.awayTeam?.teamTricode ?? "",
        homeScore: game.homeTeam?.score ?? 0,
        awayScore: game.awayTeam?.score ?? 0,
      });
    }
  }

  onProgress?.(`Found ${games.length} completed games in current season schedule`);
  return games;
}

// ── Fetch box score for a single game → per-player stats ──
async function fetchBoxScore(gameId: string): Promise<NbaPlayerGameLog[]> {
  const res = await fetch(`https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${gameId}.json`);
  if (!res.ok) return [];

  const data = await res.json();
  const game = data.game;
  if (!game || game.gameStatus < 3) return []; // not final

  const gameDate = game.gameTimeUTC?.split("T")[0] ?? "";
  const homeTeam = game.homeTeam;
  const awayTeam = game.awayTeam;
  const homeTricode = homeTeam?.teamTricode ?? "";
  const awayTricode = awayTeam?.teamTricode ?? "";
  const homeWon = (homeTeam?.score ?? 0) > (awayTeam?.score ?? 0);

  const logs: NbaPlayerGameLog[] = [];

  for (const side of [{ team: homeTeam, isHome: true, opp: awayTricode, won: homeWon }, { team: awayTeam, isHome: false, opp: homeTricode, won: !homeWon }]) {
    for (const player of side.team?.players ?? []) {
      if (player.status !== "ACTIVE" || player.played !== "1") continue;
      const stats = player.statistics;
      if (!stats) continue;

      const minutes = parseMinutes(stats.minutesCalculated ?? stats.minutes ?? "PT0M");
      if (minutes < 3) continue; // skip DNPs

      logs.push({
        playerId: player.personId,
        playerName: `${player.firstName ?? ""} ${player.familyName ?? ""}`.trim() || `Player ${player.personId}`,
        team: side.isHome ? homeTricode : awayTricode,
        gameId,
        gameDate,
        matchup: side.isHome ? `${homeTricode} vs. ${awayTricode}` : `${awayTricode} @ ${homeTricode}`,
        isHome: side.isHome,
        opponent: side.opp,
        minutes,
        pts: stats.points ?? 0,
        reb: stats.reboundsTotal ?? 0,
        ast: stats.assists ?? 0,
        fg3m: stats.threePointersMade ?? 0,
        fga: stats.fieldGoalsAttempted ?? 0,
        fgPct: stats.fieldGoalsPercentage ?? 0,
        ftPct: stats.freeThrowsPercentage ?? 0,
        plusMinus: stats.plusMinusPoints ?? 0,
        wl: side.won ? "W" : "L",
      });
    }
  }

  return logs;
}

// Parse "PT32M15.00S" or "32:15" to minutes number
function parseMinutes(raw: string): number {
  if (raw.startsWith("PT")) {
    const m = raw.match(/PT(\d+)M/);
    return m ? parseInt(m[1]) : 0;
  }
  const parts = raw.split(":");
  return parseInt(parts[0]) || 0;
}

// ── Main: Fetch all training data from real box scores ──
export async function fetchAllTrainingData(
  _seasons: number[], // ignored — CDN only has current season schedule
  onProgress?: (msg: string) => void
): Promise<NbaPlayerGameLog[]> {
  // Check Supabase cache first
  const cacheKey = "nba_real_gamelogs";
  try {
    const { cloudGet } = await import("@/lib/supabase/client");
    const cached = await cloudGet<{ logs: NbaPlayerGameLog[]; ts: string } | null>(cacheKey, null);
    if (cached && cached.logs?.length > 5000) {
      const age = Date.now() - new Date(cached.ts).getTime();
      if (age < 6 * 60 * 60 * 1000) { // fresh within 6 hours
        onProgress?.(`Loaded ${cached.logs.length} real player-games from cache`);
        return cached.logs;
      }
    }
  } catch {}

  onProgress?.("Fetching NBA season schedule from CDN...");
  const games = await fetchSeasonGameIds(onProgress);

  if (games.length === 0) {
    onProgress?.("No completed games found in schedule");
    return [];
  }

  // Fetch box scores for completed games (with rate limiting)
  // Process in batches to stay within Vercel timeout
  const allLogs: NbaPlayerGameLog[] = [];
  const maxGames = Math.min(games.length, 200); // cap to ~200 games for timeout safety

  // Sample evenly across the season for better coverage
  const step = Math.max(1, Math.floor(games.length / maxGames));
  const sampled = games.filter((_, i) => i % step === 0).slice(0, maxGames);

  onProgress?.(`Fetching box scores for ${sampled.length} games...`);

  for (let i = 0; i < sampled.length; i++) {
    try {
      const logs = await fetchBoxScore(sampled[i].gameId);
      allLogs.push(...logs);

      if (i > 0 && i % 20 === 0) {
        onProgress?.(`Fetched ${i}/${sampled.length} games — ${allLogs.length} player-games so far`);
      }
    } catch {}

    // Small delay to be respectful (CDN is lenient but don't hammer it)
    if (i % 5 === 4) await new Promise(r => setTimeout(r, 200));
  }

  // Sort chronologically
  allLogs.sort((a, b) => a.gameDate.localeCompare(b.gameDate));

  onProgress?.(`Total: ${allLogs.length} REAL player-games from ${sampled.length} box scores`);

  // Cache in Supabase
  try {
    const { cloudSet } = await import("@/lib/supabase/client");
    // Trim to avoid Supabase row size limits — keep essential fields only
    const trimmed = allLogs.map(l => ({
      playerId: l.playerId, playerName: l.playerName, team: l.team,
      gameId: l.gameId, gameDate: l.gameDate, matchup: l.matchup,
      isHome: l.isHome, opponent: l.opponent, minutes: l.minutes,
      pts: l.pts, reb: l.reb, ast: l.ast, fg3m: l.fg3m,
      fga: l.fga, fgPct: l.fgPct, ftPct: l.ftPct,
      plusMinus: l.plusMinus, wl: l.wl,
    }));
    await cloudSet(cacheKey, { logs: trimmed, ts: new Date().toISOString() });
    onProgress?.("Cached real game logs in Supabase");
  } catch {}

  return allLogs;
}

// ── Fetch recent game logs for a specific player ──
// Used for "Deep Refresh" when searching a player
export async function fetchPlayerRecentGames(
  playerId: number,
  onProgress?: (msg: string) => void
): Promise<NbaPlayerGameLog[]> {
  const games = await fetchSeasonGameIds();
  // Get the most recent 20 games to search through
  const recent = games.slice(-40);
  const playerLogs: NbaPlayerGameLog[] = [];

  for (const game of recent) {
    try {
      const logs = await fetchBoxScore(game.gameId);
      const playerLog = logs.find(l => l.playerId === playerId);
      if (playerLog) playerLogs.push(playerLog);
      if (playerLogs.length >= 15) break; // enough recent games
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }

  onProgress?.(`Found ${playerLogs.length} recent games for player ${playerId}`);
  return playerLogs.sort((a, b) => a.gameDate.localeCompare(b.gameDate));
}
