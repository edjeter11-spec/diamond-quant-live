// ──────────────────────────────────────────────────────────
// MLB Player Prop Grader
//
// Grades published player props against final box scores from the free MLB
// Stats API. lib/bot/prop-grader.ts already existed but is NBA-only — it takes
// pts/reb/ast, which don't exist in baseball.
//
// Used by the daily results recap so what we posted to Discord gets settled
// against what actually happened, rather than being graded by hand.
// ──────────────────────────────────────────────────────────

const MLB_API = "https://statsapi.mlb.com/api/v1";

export type PropResult = "win" | "loss" | "push";

export interface MlbPropGrade {
  result: PropResult;
  actualValue: number;
  line: number;
  side: "over" | "under";
}

/** Batting stat key on the MLB boxscore for each market we publish. */
const MARKET_STAT: Record<string, string> = {
  batter_hits: "hits",
  batter_total_bases: "totalBases",
  batter_rbis: "rbi",
  batter_runs_scored: "runs",
  batter_home_runs: "homeRuns",
  batter_stolen_bases: "stolenBases",
};

/** Pitching markets read from a different stat block. */
const PITCHING_STAT: Record<string, string> = {
  pitcher_strikeouts: "strikeOuts",
  pitcher_outs: "outs",
};

export interface PlayerLine {
  name: string;
  batting?: Record<string, number>;
  pitching?: Record<string, number>;
}

/**
 * Pull every player's final batting/pitching line for one game.
 * Returns [] on any failure — callers treat that as "can't grade yet".
 */
export async function fetchGamePlayerLines(
  gamePk: number | string,
): Promise<PlayerLine[]> {
  try {
    const res = await fetch(`${MLB_API}/game/${gamePk}/boxscore`, {
      signal: AbortSignal.timeout(10000),
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const out: PlayerLine[] = [];
    for (const side of ["home", "away"] as const) {
      const players = data?.teams?.[side]?.players ?? {};
      for (const key of Object.keys(players)) {
        const p = players[key];
        const name = p?.person?.fullName;
        if (!name) continue;
        out.push({
          name,
          batting: p?.stats?.batting ?? undefined,
          pitching: p?.stats?.pitching ?? undefined,
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

// Strip accents/diacritics before comparing — "Jeremy Peña" (MLB Stats API's
// real box-score name) vs "Jeremy Pena" (however the pick's name got typed
// or synthesized upstream) failed BOTH directions of the old .includes()
// check, since "peña" contains neither "pena" nor vice versa. That silently
// voided a real pick — Peña went 0-for-5 (0 total bases, well under his 1.5
// line — a genuine LOSS) and it posted to Discord as an unexplained white
// circle instead. NFKD decomposes "é" into "e" + a combining accent mark,
// which the diacritics regex then strips.
function stripAccents(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/** Last-name match, same forgiving approach the NBA grader uses. */
function findPlayer(name: string, lines: PlayerLine[]): PlayerLine | null {
  const last = (n: string) =>
    stripAccents(n).toLowerCase().trim().split(/\s+/).slice(-1)[0];
  const target = last(name);
  return (
    lines.find(
      (p) =>
        stripAccents(p.name).toLowerCase().includes(target) ||
        stripAccents(name).toLowerCase().includes(last(p.name)),
    ) ?? null
  );
}

/**
 * Grade one published prop.
 *
 * Returns null — NOT a loss — when the player can't be found or didn't record
 * a line. A scratched or benched player is a void, and silently grading that
 * as a loss would understate the record in a way that shows up as fake
 * accuracy in the other direction.
 */
export function gradeMlbProp(
  pick: {
    playerName: string;
    market: string;
    line: number;
    side: "over" | "under";
  },
  lines: PlayerLine[],
): MlbPropGrade | null {
  const player = findPlayer(pick.playerName, lines);
  if (!player) return null;

  const battingKey = MARKET_STAT[pick.market];
  const pitchingKey = PITCHING_STAT[pick.market];

  let actual: number | undefined;
  if (battingKey) {
    // Didn't bat at all → no line to grade against.
    if (!player.batting || (player.batting.plateAppearances ?? 0) === 0)
      return null;
    actual = Number(player.batting[battingKey]);
  } else if (pitchingKey) {
    if (!player.pitching) return null;
    actual = Number(player.pitching[pitchingKey]);
  } else {
    return null; // market we don't grade
  }

  if (!Number.isFinite(actual)) return null;

  if (actual === pick.line)
    return {
      result: "push",
      actualValue: actual!,
      line: pick.line,
      side: pick.side,
    };

  const over = actual! > pick.line;
  const hit = pick.side === "over" ? over : !over;
  return {
    result: hit ? "win" : "loss",
    actualValue: actual!,
    line: pick.line,
    side: pick.side,
  };
}

/** Final games for an ET date, as {gamePk, teams} for box-score lookup. */
export async function fetchFinalGames(dateISO: string): Promise<
  Array<{
    gamePk: number;
    home: string;
    away: string;
    homeScore: number;
    awayScore: number;
  }>
> {
  try {
    const res = await fetch(`${MLB_API}/schedule?sportId=1&date=${dateISO}`, {
      signal: AbortSignal.timeout(10000),
      next: { revalidate: 600 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const games = data?.dates?.[0]?.games ?? [];
    return games
      .filter((g: any) => g?.status?.abstractGameState === "Final")
      .map((g: any) => ({
        gamePk: g.gamePk,
        home: g?.teams?.home?.team?.name ?? "",
        away: g?.teams?.away?.team?.name ?? "",
        // Scores ride along in the same payload — needed to grade moneyline
        // picks (manual_picks rows with market='moneyline' have no
        // player_name/market_key, so gradeMlbProp can't touch them at all;
        // this feeds the separate moneyline-grading path in post-results).
        homeScore: Number(g?.teams?.home?.score ?? NaN),
        awayScore: Number(g?.teams?.away?.score ?? NaN),
      }));
  } catch {
    return [];
  }
}
