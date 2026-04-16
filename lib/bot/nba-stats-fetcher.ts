// ──────────────────────────────────────────────────────────
// NBA STATS FETCHER — Player Data from NBA CDN + Synthetic Game Logs
// stats.nba.com blocks Vercel IPs, so we use the free NBA CDN player
// index for real averages and generate realistic game-by-game training
// data using known NBA statistical distributions.
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

interface CDNPlayer {
  id: number;
  firstName: string;
  lastName: string;
  team: string;
  teamAbbrev: string;
  ppg: number;
  rpg: number;
  apg: number;
}

const NBA_TEAMS = [
  "ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW",
  "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK",
  "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS",
];

// Seeded random for reproducible training
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) & 0x7fffffff; return s / 0x7fffffff; };
}

// Normal distribution from uniform random (Box-Muller)
function normalRandom(rng: () => number, mean: number, stdDev: number): number {
  const u1 = rng();
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(Math.max(u1, 0.0001))) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, Math.round(mean + z * stdDev));
}

// ── Fetch real player data from NBA CDN ──
async function fetchPlayerIndex(): Promise<CDNPlayer[]> {
  // Try Supabase cache first
  try {
    const { cloudGet } = await import("@/lib/supabase/client");
    const cached = await cloudGet<{ players: CDNPlayer[]; ts: string } | null>("nba_training_players", null);
    if (cached && cached.players?.length > 100) {
      const age = Date.now() - new Date(cached.ts).getTime();
      if (age < 24 * 60 * 60 * 1000) return cached.players; // fresh enough
    }
  } catch {}

  const res = await fetch("https://cdn.nba.com/static/json/staticData/playerIndex.json");
  if (!res.ok) throw new Error("Failed to fetch NBA CDN player index");
  const data = await res.json();

  // CDN uses resultSets[0] with headers + rowSet format
  const resultSet = data?.resultSets?.[0];
  if (!resultSet) throw new Error("No resultSet in CDN response");

  const headers: string[] = resultSet.headers;
  const rows: any[][] = resultSet.rowSet;

  // Map column indices dynamically
  const col = (name: string) => headers.indexOf(name);
  const iId = col("PERSON_ID");
  const iLast = col("PLAYER_LAST_NAME");
  const iFirst = col("PLAYER_FIRST_NAME");
  const iTeamCity = col("TEAM_CITY");
  const iTeamName = col("TEAM_NAME");
  const iTeamAbbrev = col("TEAM_ABBREVIATION");
  const iPts = col("PTS");
  const iReb = col("REB");
  const iAst = col("AST");

  const players: CDNPlayer[] = [];

  for (const row of rows) {
    const ppg = row[iPts] ?? 0;
    const rpg = row[iReb] ?? 0;
    const apg = row[iAst] ?? 0;
    // Only include players who actually play
    if (ppg < 3 && rpg < 2 && apg < 1) continue;

    players.push({
      id: row[iId] ?? 0,
      firstName: row[iFirst] ?? "",
      lastName: row[iLast] ?? "",
      team: `${row[iTeamCity] ?? ""} ${row[iTeamName] ?? ""}`.trim(),
      teamAbbrev: row[iTeamAbbrev] ?? "",
      ppg, rpg, apg,
    });
  }

  // Cache
  try {
    const { cloudSet } = await import("@/lib/supabase/client");
    await cloudSet("nba_training_players", { players, ts: new Date().toISOString() });
  } catch {}

  return players;
}

// ── Generate realistic game logs from real player averages ──
// Uses NBA statistical distributions: game-to-game variance is ~30-40% of average
// Home players score ~1.5 more PPG, B2B players score ~8% less
// This creates training data that the brain can learn real patterns from

function generateSeasonGameLogs(
  players: CDNPlayer[],
  seasonYear: number,
  rng: () => number
): NbaPlayerGameLog[] {
  const logs: NbaPlayerGameLog[] = [];
  const seasonStart = new Date(`${seasonYear}-10-20`);

  // Generate ~82 game dates for the season
  const gameDates: string[] = [];
  for (let i = 0; i < 180; i += 2) { // every other day roughly
    const d = new Date(seasonStart.getTime() + i * 24 * 60 * 60 * 1000);
    if (gameDates.length >= 82) break;
    // Skip some days randomly (not every team plays every other day)
    if (rng() > 0.6) continue;
    gameDates.push(d.toISOString().split("T")[0]);
  }

  for (const player of players) {
    if (!player.teamAbbrev || player.ppg < 3) continue;

    // Each player plays ~65-82 games per season
    const gamesThisSeason = Math.round(65 + rng() * 17);
    const playerDates = gameDates
      .filter(() => rng() < gamesThisSeason / gameDates.length)
      .slice(0, gamesThisSeason);

    let prevDate = "";

    for (let g = 0; g < playerDates.length; g++) {
      const date = playerDates[g];
      const isHome = rng() > 0.5;
      const opponent = NBA_TEAMS[Math.floor(rng() * NBA_TEAMS.length)];
      const isB2B = prevDate && daysBetween(prevDate, date) <= 1;

      // Variance: NBA players have ~30-35% game-to-game stddev
      const ptsStdDev = player.ppg * 0.35;
      const rebStdDev = player.rpg * 0.40;
      const astStdDev = player.apg * 0.42;

      // Context adjustments
      let ptsMod = 0, rebMod = 0, astMod = 0;
      if (isHome) { ptsMod += 1.5; rebMod += 0.3; astMod += 0.2; }
      if (isB2B) { ptsMod -= player.ppg * 0.08; rebMod -= player.rpg * 0.06; astMod -= player.apg * 0.05; }

      // Generate the actual stat line
      const pts = normalRandom(rng, player.ppg + ptsMod, ptsStdDev);
      const reb = normalRandom(rng, player.rpg + rebMod, rebStdDev);
      const ast = normalRandom(rng, player.apg + astMod, astStdDev);
      const fg3m = normalRandom(rng, player.ppg * 0.12, player.ppg * 0.08);
      const minutes = Math.max(10, Math.min(42, normalRandom(rng, 28, 6)));

      logs.push({
        playerId: player.id,
        playerName: `${player.firstName} ${player.lastName}`,
        team: player.teamAbbrev,
        gameId: `${seasonYear}${String(g).padStart(4, "0")}${player.id}`,
        gameDate: date,
        matchup: isHome ? `${player.teamAbbrev} vs. ${opponent}` : `${player.teamAbbrev} @ ${opponent}`,
        isHome,
        opponent,
        minutes,
        pts, reb, ast, fg3m,
        fga: Math.round(pts * 0.45 + rng() * 5),
        fgPct: 0.35 + rng() * 0.20,
        ftPct: 0.70 + rng() * 0.20,
        plusMinus: Math.round((rng() - 0.5) * 30),
        wl: rng() > 0.5 ? "W" : "L",
      });

      prevDate = date;
    }
  }

  return logs;
}

function daysBetween(d1: string, d2: string): number {
  return Math.round(Math.abs(new Date(d2).getTime() - new Date(d1).getTime()) / (1000 * 60 * 60 * 24));
}

// ── Main: Fetch all training data ──
export async function fetchAllTrainingData(
  seasons: number[],
  onProgress?: (msg: string) => void
): Promise<NbaPlayerGameLog[]> {
  onProgress?.("Fetching real player data from NBA CDN...");
  const players = await fetchPlayerIndex();
  onProgress?.(`Loaded ${players.length} NBA players with real season averages`);

  const allLogs: NbaPlayerGameLog[] = [];

  for (const year of seasons) {
    // Check cache
    const cacheKey = `nba_gamelogs_${year}`;
    try {
      const { cloudGet } = await import("@/lib/supabase/client");
      const cached = await cloudGet<NbaPlayerGameLog[] | null>(cacheKey, null);
      if (cached && cached.length > 1000) {
        onProgress?.(`Loaded ${cached.length} games from cache for ${year}-${year + 1}`);
        allLogs.push(...cached);
        continue;
      }
    } catch {}

    onProgress?.(`Generating ${year}-${year + 1} season training data from real player averages...`);
    const rng = seededRandom(year * 31337); // deterministic per season
    const seasonLogs = generateSeasonGameLogs(players, year, rng);
    onProgress?.(`Generated ${seasonLogs.length} player-games for ${year}-${year + 1}`);
    allLogs.push(...seasonLogs);

    // Cache
    try {
      const { cloudSet } = await import("@/lib/supabase/client");
      await cloudSet(cacheKey, seasonLogs);
    } catch {}
  }

  // Sort chronologically
  allLogs.sort((a, b) => a.gameDate.localeCompare(b.gameDate));
  onProgress?.(`Total: ${allLogs.length} player-games across ${seasons.length} seasons`);
  return allLogs;
}
