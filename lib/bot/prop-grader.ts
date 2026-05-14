export interface PropGradeResult {
  result: "win" | "loss" | "push";
  actualValue: number;
  line: number;
  side: "over" | "under";
}

export function gradePropPick(
  pick: { playerName: string; market: string; line: number; side: "over" | "under" },
  boxScores: Array<{ playerName: string; pts: number; reb: number; ast: number; minutes: number }>,
): PropGradeResult | null {
  const lastName = (name: string) => name.toLowerCase().split(" ").slice(-1)[0];
  const player = boxScores.find(
    (p) =>
      p.playerName.toLowerCase().includes(lastName(pick.playerName)) ||
      pick.playerName.toLowerCase().includes(lastName(p.playerName)),
  );
  if (!player || player.minutes < 5) return null;

  const actual =
    pick.market === "player_points"
      ? player.pts
      : pick.market === "player_rebounds"
        ? player.reb
        : player.ast;

  if (actual === pick.line) return { result: "push", actualValue: actual, line: pick.line, side: pick.side };
  const hit = pick.side === "over" ? actual > pick.line : actual < pick.line;
  return { result: hit ? "win" : "loss", actualValue: actual, line: pick.line, side: pick.side };
}

// ── MLB prop grader ──
// Stat keys map to MLB box score fields from statsapi.mlb.com:
//   batter.hits, batter.homeRuns, batter.totalBases, batter.rbi, batter.runs,
//   batter.stolenBases, pitcher.strikeOuts, pitcher.inningsPitched
//
// `boxStats` is a player-keyed map of computed values. Caller is responsible
// for converting innings (e.g. "5.1") into outs (5 * 3 + 1 = 16).
export interface MLBPlayerStats {
  playerName: string;
  hits: number;
  homeRuns: number;
  totalBases: number;
  rbis: number;
  runsScored: number;
  stolenBases: number;
  strikeouts: number; // pitcher strikeouts
  outs: number;       // pitcher outs (innings * 3 + remainder)
  appeared: boolean;  // false if DNP
}

const MLB_MARKET_TO_STAT: Record<string, keyof MLBPlayerStats> = {
  batter_hits: "hits",
  batter_home_runs: "homeRuns",
  batter_total_bases: "totalBases",
  batter_rbis: "rbis",
  batter_runs_scored: "runsScored",
  batter_stolen_bases: "stolenBases",
  pitcher_strikeouts: "strikeouts",
  pitcher_outs: "outs",
};

export function gradeMLBPropPick(
  pick: { playerName: string; market: string; line: number; side: "over" | "under" },
  players: MLBPlayerStats[],
): PropGradeResult | null {
  const statKey = MLB_MARKET_TO_STAT[pick.market];
  if (!statKey) return null;
  const lastName = (name: string) => name.toLowerCase().split(" ").slice(-1)[0];
  const player = players.find(
    (p) =>
      p.playerName.toLowerCase().includes(lastName(pick.playerName)) ||
      pick.playerName.toLowerCase().includes(lastName(p.playerName)),
  );
  if (!player || !player.appeared) return null;
  const actual = Number(player[statKey] ?? 0);
  if (actual === pick.line) return { result: "push", actualValue: actual, line: pick.line, side: pick.side };
  const hit = pick.side === "over" ? actual > pick.line : actual < pick.line;
  return { result: hit ? "win" : "loss", actualValue: actual, line: pick.line, side: pick.side };
}

// Parse MLB box score response from statsapi.mlb.com into MLBPlayerStats[]
export function parseMLBBoxScore(boxData: any): MLBPlayerStats[] {
  const players: MLBPlayerStats[] = [];
  for (const side of ["home", "away"] as const) {
    const teamPlayers = boxData?.teams?.[side]?.players ?? {};
    for (const pid of Object.keys(teamPlayers)) {
      const p = teamPlayers[pid];
      const name: string = p.person?.fullName ?? "";
      if (!name) continue;
      const bat = p.stats?.batting ?? {};
      const pit = p.stats?.pitching ?? {};
      const ipStr = String(pit.inningsPitched ?? "0");
      const [whole, frac] = ipStr.split(".").map(Number);
      const outs = (Number(whole) || 0) * 3 + (Number(frac) || 0);
      const appeared =
        (bat.atBats ?? 0) > 0 ||
        (bat.plateAppearances ?? 0) > 0 ||
        (pit.outs ?? 0) > 0 ||
        outs > 0;
      players.push({
        playerName: name,
        hits: Number(bat.hits ?? 0),
        homeRuns: Number(bat.homeRuns ?? 0),
        totalBases: Number(bat.totalBases ?? 0),
        rbis: Number(bat.rbi ?? 0),
        runsScored: Number(bat.runs ?? 0),
        stolenBases: Number(bat.stolenBases ?? 0),
        strikeouts: Number(pit.strikeOuts ?? 0),
        outs,
        appeared,
      });
    }
  }
  return players;
}
