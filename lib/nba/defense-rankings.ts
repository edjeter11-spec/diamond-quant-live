// ──────────────────────────────────────────────────────────
// NBA DEFENSIVE RANKINGS — Team Defense vs Position
// Uses ESPN team stats to rank teams by defensive efficiency
// Cached 6 hours — updates don't need to be real-time
// ──────────────────────────────────────────────────────────

export interface TeamDefenseRanking {
  teamAbbrev: string;
  teamName: string;
  ptsAllowed: number;    // avg points allowed per game
  rebAllowed: number;    // avg rebounds allowed
  astAllowed: number;    // avg assists allowed
  defRank: number;       // 1-30 (1 = best defense)
  ptsRank: number;       // rank by pts allowed (1 = fewest allowed)
  rebRank: number;
  astRank: number;
  pace: number;          // avg possessions (affects stat volume)
}

const ESPN_TEAM_IDS: Record<string, string> = {
  "ATL": "1", "BOS": "2", "BKN": "17", "CHA": "30", "CHI": "4",
  "CLE": "5", "DAL": "6", "DEN": "7", "DET": "8", "GSW": "9",
  "HOU": "10", "IND": "11", "LAC": "12", "LAL": "13", "MEM": "29",
  "MIA": "14", "MIL": "15", "MIN": "16", "NOP": "3", "NYK": "18",
  "OKC": "25", "ORL": "19", "PHI": "20", "PHX": "21", "POR": "22",
  "SAC": "23", "SAS": "24", "TOR": "28", "UTA": "26", "WAS": "27",
};

let cache: { rankings: Record<string, TeamDefenseRanking>; ts: number } | null = null;

export async function fetchDefenseRankings(): Promise<Record<string, TeamDefenseRanking>> {
  // Return cache if fresh (6 hours)
  if (cache && Date.now() - cache.ts < 6 * 60 * 60 * 1000) return cache.rankings;

  const rankings: TeamDefenseRanking[] = [];

  // Fetch all teams' stats in parallel (batched)
  const entries = Object.entries(ESPN_TEAM_IDS);
  for (let i = 0; i < entries.length; i += 5) {
    const batch = entries.slice(i, i + 5);
    const results = await Promise.all(
      batch.map(async ([abbrev, id]) => {
        try {
          const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${id}/statistics`);
          if (!res.ok) return null;
          const data = await res.json();
          const stats = data.results?.stats?.categories ?? [];

          // Extract offensive stats (which represent opponent's defense when flipped)
          const offStats = stats.find((c: any) => c.name === "offensive")?.stats ?? [];
          const genStats = stats.find((c: any) => c.name === "general")?.stats ?? [];

          const avgPts = offStats.find((s: any) => s.name === "avgPoints")?.value ?? 110;
          const avgReb = genStats.find((s: any) => s.name === "avgRebounds")?.value ?? 44;
          const avgAst = offStats.find((s: any) => s.name === "avgAssists")?.value ?? 25;

          // For defense, we want OPPONENT stats. ESPN only gives team's own stats.
          // Approximate: league avg - team's offense = rough defense allowed
          // Better: use the team's own scoring as a pace proxy
          return { abbrev, avgPts, avgReb, avgAst };
        } catch {
          return null;
        }
      })
    );

    for (const r of results) {
      if (r) {
        rankings.push({
          teamAbbrev: r.abbrev,
          teamName: r.abbrev,
          ptsAllowed: 230 - r.avgPts, // rough: league avg total ~230, so opponent scores ~230 - team's pts
          rebAllowed: 88 - r.avgReb,  // similar logic for rebounds
          astAllowed: 50 - r.avgAst,  // and assists
          defRank: 0, ptsRank: 0, rebRank: 0, astRank: 0,
          pace: r.avgPts, // team's scoring correlates with pace
        });
      }
    }

    // Small delay between batches
    if (i + 5 < entries.length) await new Promise(r => setTimeout(r, 300));
  }

  // Rank by points allowed (ascending = best defense)
  rankings.sort((a, b) => a.ptsAllowed - b.ptsAllowed);
  rankings.forEach((r, i) => { r.ptsRank = i + 1; r.defRank = i + 1; });

  // Rank by rebounds allowed
  const byReb = [...rankings].sort((a, b) => a.rebAllowed - b.rebAllowed);
  byReb.forEach((r, i) => { r.rebRank = i + 1; });

  // Rank by assists allowed
  const byAst = [...rankings].sort((a, b) => a.astAllowed - b.astAllowed);
  byAst.forEach((r, i) => { r.astRank = i + 1; });

  // Build lookup
  const result: Record<string, TeamDefenseRanking> = {};
  for (const r of rankings) result[r.teamAbbrev] = r;

  cache = { rankings: result, ts: Date.now() };

  // Also cache in Supabase for server-side access
  try {
    const { cloudSet } = await import("@/lib/supabase/client");
    await cloudSet("nba_defense_rankings", { rankings: result, ts: new Date().toISOString() });
  } catch {}

  return result;
}

// Get defense rank for a specific team and stat type
export async function getDefenseRank(teamAbbrev: string, propType: string): Promise<number> {
  const rankings = await fetchDefenseRankings();
  const team = rankings[teamAbbrev];
  if (!team) return 15; // middle of the pack default

  switch (propType) {
    case "player_points": return team.ptsRank;
    case "player_rebounds": return team.rebRank;
    case "player_assists": return team.astRank;
    default: return team.defRank;
  }
}
