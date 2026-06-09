// ──────────────────────────────────────────────────────────
// NHL Stats — NHL official API (api-web.nhle.com) — free, no auth.
// Plus ESPN for box scores.
// ──────────────────────────────────────────────────────────

export interface NHLGameSummary {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeAbbrev: string;
  awayAbbrev: string;
  homeScore: number;
  awayScore: number;
  status: "pre" | "live" | "final";
  startTime: string;
  period: number;
  clock: string;
}

// Today's NHL schedule
export async function fetchTodayNHLGames(): Promise<any[]> {
  try {
    // NHL API uses YYYY-MM-DD format
    const today = new Date().toISOString().split("T")[0];
    const res = await fetch(
      `https://api-web.nhle.com/v1/schedule/${today}`,
      { next: { revalidate: 300 } },
    );
    if (!res.ok) return [];
    const data = await res.json();
    const games: any[] = [];
    for (const week of data.gameWeek ?? []) {
      if (week.date === today) {
        games.push(...(week.games ?? []));
      }
    }
    return games;
  } catch {
    return [];
  }
}

export function getNHLGameStatus(game: any): "pre" | "live" | "final" {
  const state = String(game.gameState ?? "").toUpperCase();
  if (state === "FINAL" || state === "OFF") return "final";
  if (state === "LIVE" || state === "CRIT") return "live";
  return "pre";
}

// Box score for a single game (NHL API)
export async function fetchNHLBoxScore(gameId: string): Promise<{ playerName: string; team: string; position: string; stats: { goals: number; assists: number; points: number; shots: number; saves?: number; toi?: string } }[]> {
  try {
    const res = await fetch(
      `https://api-web.nhle.com/v1/gamecenter/${gameId}/boxscore`,
      { next: { revalidate: 300 } },
    );
    if (!res.ok) return [];
    const data = await res.json();
    const out: { playerName: string; team: string; position: string; stats: { goals: number; assists: number; points: number; shots: number; saves?: number; toi?: string } }[] = [];

    const processSide = (side: any, teamAbbrev: string) => {
      const all = [
        ...(side?.forwards ?? []),
        ...(side?.defense ?? []),
      ];
      for (const p of all) {
        out.push({
          playerName: p.name?.default ?? `${p.firstName?.default ?? ""} ${p.lastName?.default ?? ""}`.trim(),
          team: teamAbbrev,
          position: p.position ?? "F",
          stats: {
            goals: Number(p.goals ?? 0),
            assists: Number(p.assists ?? 0),
            points: Number(p.points ?? 0),
            shots: Number(p.shots ?? 0),
            toi: p.toi ?? "",
          },
        });
      }
      for (const g of side?.goalies ?? []) {
        out.push({
          playerName: g.name?.default ?? `${g.firstName?.default ?? ""} ${g.lastName?.default ?? ""}`.trim(),
          team: teamAbbrev,
          position: "G",
          stats: {
            goals: 0,
            assists: 0,
            points: 0,
            shots: Number(g.shotsAgainst ?? 0),
            saves: Number(g.saves ?? 0),
            toi: g.toi ?? "",
          },
        });
      }
    };

    processSide(data.playerByGameStats?.homeTeam, data.homeTeam?.abbrev ?? "");
    processSide(data.playerByGameStats?.awayTeam, data.awayTeam?.abbrev ?? "");
    return out;
  } catch {
    return [];
  }
}
