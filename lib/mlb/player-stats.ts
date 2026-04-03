// ──────────────────────────────────────────────────────────
// MLB Player Stats + Matchup History
// Pulls from the free MLB Stats API
// ──────────────────────────────────────────────────────────

const MLB_API = "https://statsapi.mlb.com/api/v1";

export interface PlayerSeasonStats {
  name: string;
  team: string;
  teamAbbrev: string;
  position: string;
  gamesPlayed: number;
  number?: string;
  photo?: string;
  // Pitcher stats
  era?: number;
  whip?: number;
  strikeouts?: number;
  k9?: number;
  bb9?: number;
  inningsPitched?: number;
  wins?: number;
  losses?: number;
  avgStrikeoutsPerGame?: number;
  // Batter stats
  avg?: number;
  ops?: number;
  hits?: number;
  homeRuns?: number;
  rbi?: number;
  stolenBases?: number;
  totalBases?: number;
  hitsPerGame?: number;
  tbPerGame?: number;
}

export interface GameLogEntry {
  date: string;
  opponent: string;
  // Pitcher
  strikeouts?: number;
  inningsPitched?: number;
  earnedRuns?: number;
  hits?: number;
  walks?: number;
  // Batter
  atBats?: number;
  hitsB?: number;
  homeRuns?: number;
  rbi?: number;
  totalBases?: number;
}

export interface PlayerAnalysis {
  player: PlayerSeasonStats;
  lastYearStats?: Partial<PlayerSeasonStats>;
  careerStats?: Partial<PlayerSeasonStats>;
  dataSource: "current" | "lastYear" | "career"; // which season the primary stats are from
  last10Games: GameLogEntry[];
  vsOpponent: { games: number; avgStat: number; trend: string };
  recommendation: {
    side: "over" | "under" | "lean_over" | "lean_under" | "no_edge";
    confidence: number;
    reasons: string[];
  };
}

// Search for a player by name — uses the correct MLB search endpoint
export async function searchPlayer(name: string): Promise<{ id: number; fullName: string; team: string; position: string; number: string; photo: string } | null> {
  try {
    // Use the people/search endpoint — actually filters by name
    const url = `${MLB_API}/people/search?names=${encodeURIComponent(name)}&sportIds=1&active=true`;
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    const data = await res.json();
    const people = data.people ?? [];
    if (people.length === 0) return null;

    const player = people[0]; // This endpoint actually returns correct matches
    const teamId = player.currentTeam?.id;

    // Get team name from roster if not directly available
    let teamName = "Unknown";
    if (teamId) {
      try {
        const teamRes = await fetch(`${MLB_API}/teams/${teamId}`, { next: { revalidate: 86400 } });
        if (teamRes.ok) {
          const teamData = await teamRes.json();
          teamName = teamData.teams?.[0]?.name ?? "Unknown";
        }
      } catch {}
    }

    return {
      id: player.id,
      fullName: player.fullName,
      team: teamName,
      position: player.primaryPosition?.abbreviation ?? "??",
      number: player.primaryNumber ?? "",
      photo: `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${player.id}/headshot/67/current`,
    };
  } catch {
    return null;
  }
}

// Fetch pitcher season stats
export async function fetchPitcherSeasonStats(playerId: number, season?: number): Promise<any> {
  const year = season ?? new Date().getFullYear();
  const url = `${MLB_API}/people/${playerId}/stats?stats=season&season=${year}&group=pitching`;
  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) return null;
  const data = await res.json();
  return data.stats?.[0]?.splits?.[0]?.stat ?? null;
}

// Fetch batter season stats
export async function fetchBatterSeasonStats(playerId: number, season?: number): Promise<any> {
  const year = season ?? new Date().getFullYear();
  const url = `${MLB_API}/people/${playerId}/stats?stats=season&season=${year}&group=hitting`;
  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) return null;
  const data = await res.json();
  return data.stats?.[0]?.splits?.[0]?.stat ?? null;
}

// Fetch career stats
export async function fetchCareerStats(playerId: number, isPitcher: boolean): Promise<any> {
  const group = isPitcher ? "pitching" : "hitting";
  const url = `${MLB_API}/people/${playerId}/stats?stats=career&group=${group}`;
  const res = await fetch(url, { next: { revalidate: 3600 } });
  if (!res.ok) return null;
  const data = await res.json();
  return data.stats?.[0]?.splits?.[0]?.stat ?? null;
}

// Fetch game log (last N games)
export async function fetchGameLog(playerId: number, isPitcher: boolean): Promise<GameLogEntry[]> {
  const year = new Date().getFullYear();
  const group = isPitcher ? "pitching" : "hitting";
  const url = `${MLB_API}/people/${playerId}/stats?stats=gameLog&season=${year}&group=${group}`;
  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) return [];
  const data = await res.json();
  const splits = data.stats?.[0]?.splits ?? [];

  return splits.slice(-15).map((s: any) => {
    const stat = s.stat;
    const opponent = s.opponent?.name ?? "Unknown";
    const date = s.date ?? "";

    if (isPitcher) {
      return {
        date,
        opponent,
        strikeouts: parseInt(stat.strikeOuts) || 0,
        inningsPitched: parseFloat(stat.inningsPitched) || 0,
        earnedRuns: parseInt(stat.earnedRuns) || 0,
        hits: parseInt(stat.hits) || 0,
        walks: parseInt(stat.baseOnBalls) || 0,
      };
    } else {
      const h = parseInt(stat.hits) || 0;
      const doubles = parseInt(stat.doubles) || 0;
      const triples = parseInt(stat.triples) || 0;
      const hr = parseInt(stat.homeRuns) || 0;
      const tb = h + doubles + triples * 2 + hr * 3;
      return {
        date,
        opponent,
        atBats: parseInt(stat.atBats) || 0,
        hitsB: h,
        homeRuns: hr,
        rbi: parseInt(stat.rbi) || 0,
        totalBases: tb,
      };
    }
  });
}

// Analyze a player for a specific prop market
export async function analyzePlayer(
  playerName: string,
  market: string,
  line: number,
  opponentTeam?: string
): Promise<PlayerAnalysis | null> {
  const player = await searchPlayer(playerName);
  if (!player) return null;

  const isPitcher = market.startsWith("pitcher_");
  const lastYear = new Date().getFullYear() - 1;

  // Fetch current season, last year, career, and game log in parallel
  const [seasonRaw, lastYearRaw, careerRaw, gameLog] = await Promise.all([
    isPitcher ? fetchPitcherSeasonStats(player.id) : fetchBatterSeasonStats(player.id),
    isPitcher ? fetchPitcherSeasonStats(player.id, lastYear) : fetchBatterSeasonStats(player.id, lastYear),
    fetchCareerStats(player.id, isPitcher),
    fetchGameLog(player.id, isPitcher),
  ]);

  // Use last year as fallback if current season has no data (early season)
  const primaryRaw = seasonRaw ?? lastYearRaw;
  if (!primaryRaw && !lastYearRaw && !careerRaw) return null;

  // Build season stats (use current season, fall back to last year for early season)
  const raw = primaryRaw ?? lastYearRaw ?? careerRaw;
  if (!raw) return null;
  const gamesPlayed = parseInt(raw.gamesPlayed || raw.gamesPitched || "0");
  const seasonStats: PlayerSeasonStats = {
    name: player.fullName,
    team: player.team,
    teamAbbrev: player.team.split(" ").pop()?.slice(0, 3).toUpperCase() ?? "???",
    position: player.position,
    gamesPlayed,
    number: player.number,
    photo: player.photo,
  };

  if (isPitcher) {
    const totalK = parseInt(raw.strikeOuts) || 0;
    const ip = parseFloat(raw.inningsPitched) || 0;
    seasonStats.era = parseFloat(raw.era) || 0;
    seasonStats.whip = parseFloat(raw.whip) || 0;
    seasonStats.strikeouts = totalK;
    seasonStats.k9 = ip > 0 ? (totalK / ip) * 9 : 0;
    seasonStats.bb9 = ip > 0 ? ((parseInt(raw.baseOnBalls) || 0) / ip) * 9 : 0;
    seasonStats.inningsPitched = ip;
    seasonStats.wins = parseInt(raw.wins) || 0;
    seasonStats.losses = parseInt(raw.losses) || 0;
    seasonStats.avgStrikeoutsPerGame = gamesPlayed > 0 ? totalK / gamesPlayed : 0;
  } else {
    const hits = parseInt(raw.hits) || 0;
    const doubles = parseInt(raw.doubles) || 0;
    const triples = parseInt(raw.triples) || 0;
    const hr = parseInt(raw.homeRuns) || 0;
    const tb = hits + doubles + triples * 2 + hr * 3;
    seasonStats.avg = parseFloat(raw.avg) || 0;
    seasonStats.ops = parseFloat(raw.ops) || 0;
    seasonStats.hits = hits;
    seasonStats.homeRuns = hr;
    seasonStats.rbi = parseInt(raw.rbi) || 0;
    seasonStats.stolenBases = parseInt(raw.stolenBases) || 0;
    seasonStats.totalBases = tb;
    seasonStats.hitsPerGame = gamesPlayed > 0 ? hits / gamesPlayed : 0;
    seasonStats.tbPerGame = gamesPlayed > 0 ? tb / gamesPlayed : 0;
  }

  // Analyze last 10 games
  const last10 = gameLog.slice(-10);

  // Get stat values for the specific market
  const statValues = last10.map((g) => getStatForMarket(g, market, isPitcher));
  const avgLast10 = statValues.length > 0 ? statValues.reduce((a, b) => a + b, 0) / statValues.length : 0;

  // Vs opponent analysis
  const vsOpp = opponentTeam
    ? gameLog.filter((g) => g.opponent.toLowerCase().includes(opponentTeam.toLowerCase().split(" ").pop() ?? ""))
    : [];
  const vsOppStats = vsOpp.map((g) => getStatForMarket(g, market, isPitcher));
  const avgVsOpp = vsOppStats.length > 0 ? vsOppStats.reduce((a, b) => a + b, 0) / vsOppStats.length : avgLast10;

  // Trend analysis
  const last5 = statValues.slice(-5);
  const first5 = statValues.slice(0, 5);
  const avgLast5 = last5.length > 0 ? last5.reduce((a, b) => a + b, 0) / last5.length : 0;
  const avgFirst5 = first5.length > 0 ? first5.reduce((a, b) => a + b, 0) / first5.length : 0;
  const trending = avgLast5 > avgFirst5 ? "up" : avgLast5 < avgFirst5 ? "down" : "flat";

  // Hit rate (how often they go over)
  const overCount = statValues.filter((v) => v > line).length;
  const hitRate = statValues.length > 0 ? overCount / statValues.length : 0.5;

  // Build recommendation
  const recommendation = buildRecommendation(
    market, line, avgLast10, avgVsOpp, hitRate, trending, seasonStats, last10.length, vsOpp.length
  );

  // Build last year's stats
  const lastYearStats = lastYearRaw ? buildStatSummary(lastYearRaw, isPitcher) : undefined;
  const careerStatsObj = careerRaw ? buildStatSummary(careerRaw, isPitcher) : undefined;
  const dataSource = seasonRaw ? "current" as const : lastYearRaw ? "lastYear" as const : "career" as const;

  return {
    player: seasonStats,
    lastYearStats,
    careerStats: careerStatsObj,
    dataSource,
    last10Games: last10,
    vsOpponent: {
      games: vsOpp.length,
      avgStat: Math.round(avgVsOpp * 100) / 100,
      trend: trending,
    },
    recommendation,
  };
}

// Build a stat summary from raw API data
function buildStatSummary(raw: any, isPitcher: boolean): Partial<PlayerSeasonStats> {
  const gp = parseInt(raw.gamesPlayed || raw.gamesPitched || "0");
  if (isPitcher) {
    const totalK = parseInt(raw.strikeOuts) || 0;
    const ip = parseFloat(raw.inningsPitched) || 0;
    return {
      gamesPlayed: gp,
      era: parseFloat(raw.era) || 0,
      whip: parseFloat(raw.whip) || 0,
      strikeouts: totalK,
      k9: ip > 0 ? (totalK / ip) * 9 : 0,
      wins: parseInt(raw.wins) || 0,
      losses: parseInt(raw.losses) || 0,
      avgStrikeoutsPerGame: gp > 0 ? totalK / gp : 0,
    };
  } else {
    const hits = parseInt(raw.hits) || 0;
    const doubles = parseInt(raw.doubles) || 0;
    const triples = parseInt(raw.triples) || 0;
    const hr = parseInt(raw.homeRuns) || 0;
    const tb = hits + doubles + triples * 2 + hr * 3;
    return {
      gamesPlayed: gp,
      avg: parseFloat(raw.avg) || 0,
      ops: parseFloat(raw.ops) || 0,
      hits, homeRuns: hr,
      rbi: parseInt(raw.rbi) || 0,
      stolenBases: parseInt(raw.stolenBases) || 0,
      totalBases: tb,
      hitsPerGame: gp > 0 ? hits / gp : 0,
      tbPerGame: gp > 0 ? tb / gp : 0,
    };
  }
}

function getStatForMarket(game: GameLogEntry, market: string, isPitcher: boolean): number {
  if (isPitcher) {
    if (market.includes("strikeout")) return game.strikeouts ?? 0;
    if (market.includes("outs") || market.includes("recorded")) return (game.inningsPitched ?? 0) * 3;
    return game.strikeouts ?? 0;
  } else {
    if (market.includes("hits")) return game.hitsB ?? 0;
    if (market.includes("total_bases")) return game.totalBases ?? 0;
    if (market.includes("home_run")) return game.homeRuns ?? 0;
    if (market.includes("rbi")) return game.rbi ?? 0;
    return game.hitsB ?? 0;
  }
}

function buildRecommendation(
  market: string,
  line: number,
  avgLast10: number,
  avgVsOpp: number,
  hitRate: number,
  trending: string,
  stats: PlayerSeasonStats,
  sampleSize: number,
  oppSampleSize: number
): PlayerAnalysis["recommendation"] {
  const reasons: string[] = [];
  let score = 0; // positive = over, negative = under

  // Average vs line
  const avgDiff = avgLast10 - line;
  if (avgDiff > 0.5) {
    score += 20;
    reasons.push(`Averaging ${avgLast10.toFixed(1)} over last ${sampleSize} games (line: ${line})`);
  } else if (avgDiff < -0.5) {
    score -= 20;
    reasons.push(`Averaging ${avgLast10.toFixed(1)} over last ${sampleSize} games (under the ${line} line)`);
  } else {
    reasons.push(`Averaging ${avgLast10.toFixed(1)} — right at the line of ${line}`);
  }

  // Hit rate
  if (hitRate > 0.65) {
    score += 15;
    reasons.push(`Hit the over in ${(hitRate * 100).toFixed(0)}% of recent games`);
  } else if (hitRate < 0.35) {
    score -= 15;
    reasons.push(`Only hit the over in ${(hitRate * 100).toFixed(0)}% of recent games`);
  }

  // Trend
  if (trending === "up") {
    score += 10;
    reasons.push("Trending up — recent games better than earlier stretch");
  } else if (trending === "down") {
    score -= 10;
    reasons.push("Trending down — recent games worse than earlier stretch");
  }

  // Vs opponent
  if (oppSampleSize >= 2) {
    if (avgVsOpp > line + 0.3) {
      score += 12;
      reasons.push(`Averages ${avgVsOpp.toFixed(1)} vs this opponent (${oppSampleSize} games)`);
    } else if (avgVsOpp < line - 0.3) {
      score -= 12;
      reasons.push(`Only averages ${avgVsOpp.toFixed(1)} vs this opponent (${oppSampleSize} games)`);
    }
  }

  // Pitcher-specific
  if (market.includes("strikeout") && stats.k9) {
    if (stats.k9 > 9.5) {
      score += 8;
      reasons.push(`Elite K rate: ${stats.k9.toFixed(1)} K/9 this season`);
    } else if (stats.k9 < 7.0) {
      score -= 8;
      reasons.push(`Low K rate: ${stats.k9.toFixed(1)} K/9 this season`);
    }
  }

  // Batter-specific
  if (market.includes("hits") && stats.avg) {
    if (stats.avg > 0.290) {
      score += 8;
      reasons.push(`Hitting ${stats.avg.toFixed(3)} this season — well above average`);
    } else if (stats.avg < 0.230) {
      score -= 8;
      reasons.push(`Batting just ${stats.avg.toFixed(3)} this season — below average`);
    }
  }

  if (market.includes("total_bases") && stats.ops) {
    if (stats.ops > 0.850) {
      score += 8;
      reasons.push(`Strong ${stats.ops.toFixed(3)} OPS — extra-base power`);
    }
  }

  // Determine side
  let side: PlayerAnalysis["recommendation"]["side"];
  const absScore = Math.abs(score);
  if (score > 15) side = "over";
  else if (score > 5) side = "lean_over";
  else if (score < -15) side = "under";
  else if (score < -5) side = "lean_under";
  else side = "no_edge";

  return {
    side,
    confidence: Math.min(absScore, 80),
    reasons,
  };
}
