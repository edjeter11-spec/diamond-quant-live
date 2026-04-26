// ──────────────────────────────────────────────────────────
// NBA Referee Tendencies
// Pulls today's officiating crew from ESPN summary endpoint +
// static tendency table for well-known active NBA refs.
// Used by NBA engine total projection + prop projector FT props.
// ──────────────────────────────────────────────────────────

export interface RefereeData {
  name: string;
  foulRatePerGame: number;   // total fouls called per game (lg avg ~42)
  totalPointsBoost: number;  // expected total pts under this ref (lg avg ~225)
  ftAttemptsBoost: number;   // expected combined FTA/game (lg avg ~46)
}

const ESPN_API = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary";

// LEAGUE AVERAGE BASELINES (2024-25 season):
//   fouls/game ≈ 42, total points ≈ 225, FTA/game (both teams) ≈ 46
// totalPointsBoost > 225 = high-scoring ref (more whistles → more FTs → more points)
// totalPointsBoost < 225 = let-them-play ref (fewer whistles → lower scoring)
// Source: NBA Stats / Basketball-Reference referee splits.
const REFEREE_TENDENCIES: Record<string, Omit<RefereeData, "name">> = {
  // ── High-foul, high-total (whistle-happy) ──
  "Scott Foster":      { foulRatePerGame: 46, totalPointsBoost: 229, ftAttemptsBoost: 50 },
  "Tony Brothers":     { foulRatePerGame: 44, totalPointsBoost: 227, ftAttemptsBoost: 48 },
  "Marc Davis":        { foulRatePerGame: 45, totalPointsBoost: 228, ftAttemptsBoost: 49 },
  "Eric Lewis":        { foulRatePerGame: 44, totalPointsBoost: 227, ftAttemptsBoost: 48 },
  "Zach Zarba":        { foulRatePerGame: 44, totalPointsBoost: 227, ftAttemptsBoost: 48 },
  "Sean Wright":       { foulRatePerGame: 44, totalPointsBoost: 226, ftAttemptsBoost: 48 },
  "Courtney Kirkland": { foulRatePerGame: 44, totalPointsBoost: 226, ftAttemptsBoost: 47 },

  // ── Slightly above average ──
  "James Capers":      { foulRatePerGame: 43, totalPointsBoost: 226, ftAttemptsBoost: 47 },
  "Kane Fitzgerald":   { foulRatePerGame: 43, totalPointsBoost: 226, ftAttemptsBoost: 47 },
  "John Goble":        { foulRatePerGame: 43, totalPointsBoost: 225, ftAttemptsBoost: 47 },
  "Bill Kennedy":      { foulRatePerGame: 43, totalPointsBoost: 225, ftAttemptsBoost: 47 },

  // ── Neutral ──
  "Ed Malloy":         { foulRatePerGame: 42, totalPointsBoost: 225, ftAttemptsBoost: 46 },
  "Tyler Ford":        { foulRatePerGame: 42, totalPointsBoost: 225, ftAttemptsBoost: 46 },
  "JB DeRosa":         { foulRatePerGame: 42, totalPointsBoost: 225, ftAttemptsBoost: 46 },
  "J.B. DeRosa":       { foulRatePerGame: 42, totalPointsBoost: 225, ftAttemptsBoost: 46 },
  "David Guthrie":     { foulRatePerGame: 42, totalPointsBoost: 225, ftAttemptsBoost: 46 },
  "Josh Tiven":        { foulRatePerGame: 42, totalPointsBoost: 225, ftAttemptsBoost: 46 },
  "Mark Lindsay":      { foulRatePerGame: 42, totalPointsBoost: 225, ftAttemptsBoost: 46 },
  "Kevin Scott":       { foulRatePerGame: 42, totalPointsBoost: 224, ftAttemptsBoost: 46 },

  // ── Slightly below average (let-them-play) ──
  "Mitchell Ervin":    { foulRatePerGame: 41, totalPointsBoost: 224, ftAttemptsBoost: 45 },
  "Brian Forte":       { foulRatePerGame: 41, totalPointsBoost: 223, ftAttemptsBoost: 45 },
  "Karl Lane":         { foulRatePerGame: 41, totalPointsBoost: 223, ftAttemptsBoost: 45 },

  // ── Lenient (low foul, low total) ──
  "Rodney Mott":       { foulRatePerGame: 40, totalPointsBoost: 222, ftAttemptsBoost: 44 },
  "Brent Barnaky":     { foulRatePerGame: 40, totalPointsBoost: 222, ftAttemptsBoost: 44 },
  "Matt Boland":       { foulRatePerGame: 39, totalPointsBoost: 221, ftAttemptsBoost: 43 },
};

// League-average fallback for unknown refs
const DEFAULT_REFEREE: Omit<RefereeData, "name"> = {
  foulRatePerGame: 42,
  totalPointsBoost: 225,
  ftAttemptsBoost: 46,
};

// In-memory cache keyed by ESPN event id (crew rarely changes mid-game)
const refereeCache = new Map<string, { data: RefereeData[]; cachedAt: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

export async function getGameReferees(gameId: string | number): Promise<RefereeData[]> {
  const key = String(gameId);
  const hit = refereeCache.get(key);
  if (hit && Date.now() - hit.cachedAt < CACHE_TTL_MS) return hit.data;

  try {
    const url = `${ESPN_API}?event=${gameId}`;
    const res = await fetch(url, { next: { revalidate: 1800 } });
    if (!res.ok) {
      refereeCache.set(key, { data: [], cachedAt: Date.now() });
      return [];
    }
    const data = await res.json();
    // ESPN exposes officials under gameInfo.officials (array of { fullName, displayName })
    const officials: any[] =
      data?.gameInfo?.officials ??
      data?.boxscore?.officials ??
      [];
    const result: RefereeData[] = officials
      .map((o: any) => {
        const name: string | undefined = o?.fullName ?? o?.displayName ?? o?.name;
        if (!name) return null;
        const tend = REFEREE_TENDENCIES[name] ?? DEFAULT_REFEREE;
        return { name, ...tend } as RefereeData;
      })
      .filter((r): r is RefereeData => r !== null);

    refereeCache.set(key, { data: result, cachedAt: Date.now() });
    return result;
  } catch {
    refereeCache.set(key, { data: [], cachedAt: Date.now() });
    return [];
  }
}

// Lookup-only helper (no network) — useful when ref name already known
export function lookupRefTendency(name: string): RefereeData {
  const tend = REFEREE_TENDENCIES[name] ?? DEFAULT_REFEREE;
  return { name, ...tend };
}

// Aggregate a 3-ref crew into one signal (simple mean)
export function aggregateCrew(refs: RefereeData[]): Omit<RefereeData, "name"> & { names: string[] } {
  if (refs.length === 0) return { ...DEFAULT_REFEREE, names: [] };
  const n = refs.length;
  return {
    foulRatePerGame: refs.reduce((s, r) => s + r.foulRatePerGame, 0) / n,
    totalPointsBoost: refs.reduce((s, r) => s + r.totalPointsBoost, 0) / n,
    ftAttemptsBoost: refs.reduce((s, r) => s + r.ftAttemptsBoost, 0) / n,
    names: refs.map(r => r.name),
  };
}

export function describeCrew(refs: RefereeData[]): string {
  if (refs.length === 0) return "Officials TBD";
  const agg = aggregateCrew(refs);
  const dev = agg.totalPointsBoost - 225;
  const tag =
    dev > 1.5 ? "high-foul crew (over lean)" :
    dev < -1.5 ? "let-them-play crew (under lean)" :
    "neutral crew";
  return `${agg.names.join(", ")} — ${tag} (${agg.foulRatePerGame.toFixed(0)} fouls/G, ${agg.totalPointsBoost.toFixed(0)} pts/G avg)`;
}
