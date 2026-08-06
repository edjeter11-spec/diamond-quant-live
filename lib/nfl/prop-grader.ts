// ──────────────────────────────────────────────────────────
// NFL Player Prop Grader
//
// Grades published player props against final box scores from ESPN's public
// API (same source lib/nfl/stats-api.ts's fetchNFLBoxScore already uses
// successfully for the internal prop_predictions grading path). This file is
// the manual_picks-facing counterpart — same shape as lib/mlb/prop-grader.ts
// and lib/nba/prop-grader.ts — so /api/post-results can grade NFL picks and
// post the same kind of Discord recap MLB gets.
// ──────────────────────────────────────────────────────────

import {
  getNFLGameStatus,
  fetchNFLBoxScore,
  type NFLGameLog,
} from "./stats-api";

export type PropResult = "win" | "loss" | "push";

export interface NflPropGrade {
  result: PropResult;
  actualValue: number;
  line: number;
  side: "over" | "under";
}

export interface PlayerLine {
  name: string;
  stats: Partial<NFLGameLog>;
}

/** market_key on manual_picks → stat field on the ESPN box score. */
const MARKET_STAT: Record<string, keyof NFLGameLog> = {
  player_pass_yds: "passYds",
  player_pass_tds: "passTds",
  player_pass_attempts: "passAttempts",
  player_rush_yds: "rushYds",
  player_rush_attempts: "rushAttempts",
  player_receptions: "receptions",
  player_reception_yds: "receivingYds",
};

/** Last-name match, same forgiving approach the MLB/NBA graders use. */
function findPlayer(name: string, lines: PlayerLine[]): PlayerLine | null {
  const lastName = (n: string) =>
    n.toLowerCase().trim().split(/\s+/).slice(-1)[0];
  const target = name.toLowerCase().trim();
  const targetLast = lastName(name);
  return (
    lines.find(
      (p) =>
        p.name.toLowerCase().trim() === target ||
        p.name.toLowerCase().includes(targetLast),
    ) ?? null
  );
}

/**
 * Grade one published NFL prop.
 *
 * Returns null — NOT a loss — when the player can't be found in a final
 * game's box score (inactive, didn't record the relevant stat category,
 * name mismatch). The caller distinguishes "void" (game confirmed final,
 * player genuinely absent) from "not final yet" the same way MLB does.
 */
export function gradeNflProp(
  pick: {
    playerName: string;
    market: string;
    line: number;
    side: "over" | "under";
  },
  lines: PlayerLine[],
): NflPropGrade | null {
  const player = findPlayer(pick.playerName, lines);
  if (!player) return null;

  const statKey = MARKET_STAT[pick.market];
  if (!statKey) return null;

  const actual = Number(player.stats[statKey] ?? NaN);
  if (!Number.isFinite(actual)) return null;

  if (actual === pick.line)
    return {
      result: "push",
      actualValue: actual,
      line: pick.line,
      side: pick.side,
    };

  const over = actual > pick.line;
  const hit = pick.side === "over" ? over : !over;
  return {
    result: hit ? "win" : "loss",
    actualValue: actual,
    line: pick.line,
    side: pick.side,
  };
}

function espnYyyymmdd(dateISO: string): string {
  return dateISO.replace(/-/g, "");
}

/** Final games for a SPECIFIC ET date, via ESPN's date-parameterized
 *  scoreboard. NOT fetchTodayNFLGames (which reflects ESPN's current-week
 *  "today" and is fine for cron's live-slate use, but post-results grades
 *  YESTERDAY's slate every morning via previousSlate() — the exact bug the
 *  NBA grader had). NFL's weekly cadence makes a stale-date miss less likely
 *  in practice than it was for NBA's daily slate, but it's not guaranteed,
 *  so this fetches the actual date being graded rather than "whatever ESPN
 *  currently calls today". */
export async function fetchFinalGames(dateISO: string): Promise<
  Array<{
    gameId: string;
    home: string;
    away: string;
    homeScore: number;
    awayScore: number;
  }>
> {
  try {
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${espnYyyymmdd(dateISO)}`,
      { signal: AbortSignal.timeout(10000), next: { revalidate: 300 } },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.events ?? [])
      .filter((ev: any) => getNFLGameStatus(ev) === "final")
      .map((ev: any) => {
        const comp = ev.competitions?.[0];
        const home = comp?.competitors?.find((c: any) => c.homeAway === "home");
        const away = comp?.competitors?.find((c: any) => c.homeAway === "away");
        return {
          gameId: String(ev.id),
          home: home?.team?.displayName ?? "",
          away: away?.team?.displayName ?? "",
          // Needed to grade moneyline manual_picks rows — see post-results.
          homeScore: Number(home?.score ?? NaN),
          awayScore: Number(away?.score ?? NaN),
        };
      });
  } catch {
    return [];
  }
}

/** Every player's final box-score line for one game. Returns [] on any
 *  failure — callers treat that as "can't grade yet". */
export async function fetchGamePlayerLines(
  gameId: string | number,
): Promise<PlayerLine[]> {
  const box = await fetchNFLBoxScore(String(gameId));
  return box.map((p) => ({ name: p.playerName, stats: p.stats }));
}
