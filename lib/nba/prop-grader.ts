// ──────────────────────────────────────────────────────────
// NBA Player Prop Grader
//
// Grades published player props against final box scores. This file is the
// manual_picks-facing counterpart — same shape as lib/mlb/prop-grader.ts —
// so /api/post-results can grade NBA picks and post the same kind of Discord
// recap MLB gets.
//
// Source: ESPN's scoreboard/summary endpoints, NOT the NBA CDN liveData
// endpoint lib/bot/nba-prop-audit.ts uses internally. The CDN's
// todaysScoreboard only reflects the CURRENT date with no way to ask for a
// specific past date — useless for post-results, which grades YESTERDAY's
// slate every morning via previousSlate(). ESPN's scoreboard accepts
// `dates=YYYYMMDD` (same endpoint app/api/cron/route.ts already uses
// successfully for nbaCompletedGames), so this grader can reliably find the
// exact games that were played on the slate being graded.
// ──────────────────────────────────────────────────────────

export type PropResult = "win" | "loss" | "push";

export interface NbaPropGrade {
  result: PropResult;
  actualValue: number;
  line: number;
  side: "over" | "under";
}

export interface PlayerLine {
  name: string;
  points: number;
  reboundsTotal: number;
  assists: number;
  threePointersMade: number;
}

/** market_key on manual_picks → stat field on the CDN box score. */
const MARKET_STAT: Record<string, keyof Omit<PlayerLine, "name">> = {
  player_points: "points",
  player_rebounds: "reboundsTotal",
  player_assists: "assists",
  player_threes: "threePointersMade",
};

function normalizeName(name: string): string {
  return (
    name
      // Strip accents first — the NBA is full of them (Jokić, Dončić,
      // Šengün) and an accented box-score name will never .includes() an
      // unaccented pick name. Same bug that silently voided a real MLB
      // pick ("Jeremy Peña" vs "Jeremy Pena") — see lib/mlb/prop-grader.ts.
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/\./g, "")
      .replace(/'/g, "")
      .replace(/\s+(jr|sr|ii|iii|iv)$/i, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Last-name-plus-first-3 match, same forgiving approach the MLB grader uses. */
function findPlayer(name: string, lines: PlayerLine[]): PlayerLine | null {
  const target = normalizeName(name);
  const exact = lines.find((p) => normalizeName(p.name) === target);
  if (exact) return exact;

  const targetParts = target.split(" ");
  if (targetParts.length < 2) return null;
  return (
    lines.find((p) => {
      const bParts = normalizeName(p.name).split(" ");
      if (bParts.length < 2) return false;
      return (
        targetParts[targetParts.length - 1] === bParts[bParts.length - 1] &&
        targetParts[0].slice(0, 3) === bParts[0].slice(0, 3)
      );
    }) ?? null
  );
}

/**
 * Grade one published NBA prop.
 *
 * Returns null — NOT a loss — when the player can't be found in a final
 * game's box score. A DNP/scratch is a void, graded by the caller the same
 * way MLB does: void if the player's game is confirmed final and he's
 * genuinely absent, otherwise "not final yet."
 */
export function gradeNbaProp(
  pick: {
    playerName: string;
    market: string;
    line: number;
    side: "over" | "under";
  },
  lines: PlayerLine[],
): NbaPropGrade | null {
  const player = findPlayer(pick.playerName, lines);
  if (!player) return null;

  const statKey = MARKET_STAT[pick.market];
  if (!statKey) return null;

  const actual = Number(player[statKey]);
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

/** Final games for a specific ET date, via ESPN's date-parameterized
 *  scoreboard (same endpoint app/api/cron/route.ts already uses for
 *  nbaCompletedGames). Returns ESPN event ids — the box-score fetch below
 *  needs these, not NBA's internal gameId format. */
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
      `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${espnYyyymmdd(dateISO)}`,
      { signal: AbortSignal.timeout(10000), next: { revalidate: 300 } },
    );
    if (!res.ok) return [];
    const data = await res.json();
    const out: Array<{
      gameId: string;
      home: string;
      away: string;
      homeScore: number;
      awayScore: number;
    }> = [];
    for (const ev of data?.events ?? []) {
      const comp = ev.competitions?.[0];
      if (comp?.status?.type?.name !== "STATUS_FINAL") continue;
      const home = comp.competitors?.find((c: any) => c.homeAway === "home");
      const away = comp.competitors?.find((c: any) => c.homeAway === "away");
      if (!home || !away) continue;
      out.push({
        gameId: String(ev.id),
        home: home.team?.displayName ?? "",
        away: away.team?.displayName ?? "",
        // Needed to grade moneyline manual_picks rows (no player_name/
        // market_key, so gradeNbaProp can't touch them) — see post-results.
        homeScore: Number(home.score ?? NaN),
        awayScore: Number(away.score ?? NaN),
      });
    }
    return out;
  } catch {
    return [];
  }
}

// ESPN's boxscore stat row is a fixed-order array matched against a parallel
// labels array, not a keyed object — "MIN","PTS","FG","3PT","FT","REB","AST",
// "TO","STL","BLK","OREB","DREB","PF","+/-". 3PT is a made-attempted string
// ("0-5"); every other needed stat is a plain number string.
function statByLabel(
  labels: string[],
  stats: string[],
  label: string,
): string | undefined {
  const idx = labels.indexOf(label);
  return idx >= 0 ? stats[idx] : undefined;
}

// NaN, not 0, when the label is missing or unparseable — same reasoning as
// the `?? NaN` on the other stats: a missing column must leave the pick
// ungraded, not silently settle every threes-over as a 0-for loss.
function threesMade(raw: string | undefined): number {
  if (!raw) return NaN;
  const n = Number(raw.split("-")[0]);
  return Number.isFinite(n) ? n : NaN;
}

/** Every player's final box-score line for one game (ESPN event id). Returns
 *  [] on any failure or if the game isn't final yet — callers treat that as
 *  "can't grade yet". */
export async function fetchGamePlayerLines(
  gameId: string | number,
): Promise<PlayerLine[]> {
  try {
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${gameId}`,
      { signal: AbortSignal.timeout(10000), next: { revalidate: 3600 } },
    );
    if (!res.ok) return [];
    const data = await res.json();
    const teams = data?.boxscore?.players ?? [];
    if (teams.length === 0) return []; // not final / no box score yet

    const out: PlayerLine[] = [];
    for (const team of teams) {
      const group = team?.statistics?.[0];
      const labels: string[] = group?.labels ?? [];
      for (const a of group?.athletes ?? []) {
        if (a.didNotPlay) continue;
        const stats: string[] = a.stats ?? [];
        // `?? NaN`, never `?? 0`. statByLabel returns undefined for a label
        // it can't find, so if ESPN ever renames a column (REB -> TRB, say),
        // `?? 0` would give EVERY player 0 rebounds and settle every
        // rebounds-over as a confident LOSS with actualValue 0 — a
        // whole-slate silent-loss generator that the downstream
        // Number.isFinite check can't catch, because 0 is finite. NaN fails
        // that check and the pick stays ungraded, which is the safe failure.
        out.push({
          name: a.athlete?.displayName ?? "",
          points: Number(statByLabel(labels, stats, "PTS") ?? NaN),
          reboundsTotal: Number(statByLabel(labels, stats, "REB") ?? NaN),
          assists: Number(statByLabel(labels, stats, "AST") ?? NaN),
          threePointersMade: threesMade(statByLabel(labels, stats, "3PT")),
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}
