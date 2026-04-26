// ──────────────────────────────────────────────────────────
// MLB Home-Plate Umpire Tendencies
// Pulls today's HP ump from MLB Stats API boxscore + static
// tendency table for well-known active umpires (UmpScores data).
// Used by three-models pitcher/total signals.
// ──────────────────────────────────────────────────────────

import type { UmpireData } from "@/lib/model/types";

const MLB_API = "https://statsapi.mlb.com/api/v1.1";

// LEAGUE AVERAGE BASELINES (2024 season):
//   runs/game ≈ 8.5, K/9 ≈ 8.4, BB/9 ≈ 3.2, home win % ≈ 53
// Each umpire's runScoringIndex is their career runs-per-game allowed
// while behind the plate. >8.5 = hitter-friendly, <8.5 = pitcher-friendly.
// Source: UmpScores.com / Baseball Savant pitch-tracking data.
const UMPIRE_TENDENCIES: Record<string, Omit<UmpireData, "name">> = {
  // ── Pitcher-friendly (tight zone, more strikes called) ──
  "Pat Hoberg":        { kZoneAccuracy: 97, runScoringIndex: 7.8, homeTeamWinRate: 53 },
  "Will Little":       { kZoneAccuracy: 95, runScoringIndex: 7.9, homeTeamWinRate: 54 },
  "Carlos Torres":     { kZoneAccuracy: 95, runScoringIndex: 8.0, homeTeamWinRate: 53 },
  "Lance Barksdale":   { kZoneAccuracy: 94, runScoringIndex: 8.1, homeTeamWinRate: 52 },
  "Tripp Gibson":      { kZoneAccuracy: 94, runScoringIndex: 8.0, homeTeamWinRate: 53 },
  "Dan Iassogna":      { kZoneAccuracy: 93, runScoringIndex: 8.1, homeTeamWinRate: 53 },

  // ── Slightly pitcher-friendly ──
  "Jordan Baker":      { kZoneAccuracy: 93, runScoringIndex: 8.2, homeTeamWinRate: 53 },
  "Marvin Hudson":     { kZoneAccuracy: 92, runScoringIndex: 8.2, homeTeamWinRate: 52 },
  "Chad Fairchild":    { kZoneAccuracy: 92, runScoringIndex: 8.3, homeTeamWinRate: 53 },
  "Adam Hamari":       { kZoneAccuracy: 92, runScoringIndex: 8.3, homeTeamWinRate: 53 },
  "Mark Carlson":      { kZoneAccuracy: 91, runScoringIndex: 8.3, homeTeamWinRate: 54 },
  "Lance Barrett":     { kZoneAccuracy: 92, runScoringIndex: 8.3, homeTeamWinRate: 53 },

  // ── Neutral ──
  "Bill Miller":       { kZoneAccuracy: 91, runScoringIndex: 8.5, homeTeamWinRate: 53 },
  "Ted Barrett":       { kZoneAccuracy: 91, runScoringIndex: 8.5, homeTeamWinRate: 53 },
  "Alfonso Márquez":   { kZoneAccuracy: 91, runScoringIndex: 8.5, homeTeamWinRate: 53 },
  "Alfonso Marquez":   { kZoneAccuracy: 91, runScoringIndex: 8.5, homeTeamWinRate: 53 },
  "James Hoye":        { kZoneAccuracy: 91, runScoringIndex: 8.5, homeTeamWinRate: 53 },
  "Brian O'Nora":      { kZoneAccuracy: 90, runScoringIndex: 8.5, homeTeamWinRate: 53 },
  "Vic Carapazza":     { kZoneAccuracy: 90, runScoringIndex: 8.6, homeTeamWinRate: 53 },
  "Mike Estabrook":    { kZoneAccuracy: 90, runScoringIndex: 8.6, homeTeamWinRate: 53 },
  "Chris Conroy":      { kZoneAccuracy: 90, runScoringIndex: 8.6, homeTeamWinRate: 53 },
  "Jeremie Rehak":     { kZoneAccuracy: 90, runScoringIndex: 8.6, homeTeamWinRate: 53 },
  "Cory Blaser":       { kZoneAccuracy: 90, runScoringIndex: 8.6, homeTeamWinRate: 53 },

  // ── Slightly hitter-friendly ──
  "Hunter Wendelstedt":{ kZoneAccuracy: 89, runScoringIndex: 8.8, homeTeamWinRate: 53 },
  "Bruce Dreckman":    { kZoneAccuracy: 89, runScoringIndex: 8.9, homeTeamWinRate: 52 },
  "Phil Cuzzi":        { kZoneAccuracy: 88, runScoringIndex: 9.0, homeTeamWinRate: 52 },
  "Greg Gibson":       { kZoneAccuracy: 88, runScoringIndex: 8.9, homeTeamWinRate: 52 },
  "Laz Diaz":          { kZoneAccuracy: 88, runScoringIndex: 9.0, homeTeamWinRate: 52 },
  "Doug Eddings":      { kZoneAccuracy: 88, runScoringIndex: 8.9, homeTeamWinRate: 52 },
  "Quinn Wolcott":     { kZoneAccuracy: 88, runScoringIndex: 9.0, homeTeamWinRate: 53 },

  // ── Hitter-friendly (loose zone, more BBs, more runs) ──
  "Angel Hernandez":   { kZoneAccuracy: 86, runScoringIndex: 9.3, homeTeamWinRate: 51 },
  "Ángel Hernández":   { kZoneAccuracy: 86, runScoringIndex: 9.3, homeTeamWinRate: 51 },
  "C.B. Bucknor":      { kZoneAccuracy: 86, runScoringIndex: 9.4, homeTeamWinRate: 51 },
  "CB Bucknor":        { kZoneAccuracy: 86, runScoringIndex: 9.4, homeTeamWinRate: 51 },
  "Ron Kulpa":         { kZoneAccuracy: 87, runScoringIndex: 9.2, homeTeamWinRate: 52 },
  "John Tumpane":      { kZoneAccuracy: 88, runScoringIndex: 9.0, homeTeamWinRate: 53 },
};

// League-average fallback for unknown umpires
const DEFAULT_UMPIRE: Omit<UmpireData, "name"> = {
  kZoneAccuracy: 91,
  runScoringIndex: 8.5,
  homeTeamWinRate: 53,
};

// In-memory cache keyed by gamePk (home plate ump rarely changes mid-game)
const umpireCache = new Map<string, { data: UmpireData | null; cachedAt: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

export async function getHomePlateUmpire(gamePk: string | number): Promise<UmpireData | null> {
  const key = String(gamePk);
  const hit = umpireCache.get(key);
  if (hit && Date.now() - hit.cachedAt < CACHE_TTL_MS) return hit.data;

  try {
    const url = `${MLB_API}/game/${gamePk}/feed/live`;
    const res = await fetch(url, { next: { revalidate: 1800 } });
    if (!res.ok) {
      umpireCache.set(key, { data: null, cachedAt: Date.now() });
      return null;
    }
    const data = await res.json();
    const officials = data?.liveData?.boxscore?.officials ?? [];
    const hp = officials.find((o: any) => o.officialType === "Home Plate");
    const name: string | undefined = hp?.official?.fullName;
    if (!name) {
      umpireCache.set(key, { data: null, cachedAt: Date.now() });
      return null;
    }
    const tend = UMPIRE_TENDENCIES[name] ?? DEFAULT_UMPIRE;
    const result: UmpireData = { name, ...tend };
    umpireCache.set(key, { data: result, cachedAt: Date.now() });
    return result;
  } catch {
    umpireCache.set(key, { data: null, cachedAt: Date.now() });
    return null;
  }
}

// Lookup-only helper (no network) — useful when ump name already known
export function lookupUmpireTendency(name: string): UmpireData {
  const tend = UMPIRE_TENDENCIES[name] ?? DEFAULT_UMPIRE;
  return { name, ...tend };
}

export function describeUmpire(ump: UmpireData): string {
  const dev = ump.runScoringIndex - 8.5;
  if (dev > 0.4) return `${ump.name} — hitter-friendly zone (${ump.runScoringIndex.toFixed(1)} R/G avg, ${ump.kZoneAccuracy}% accuracy)`;
  if (dev < -0.4) return `${ump.name} — tight zone, pitcher-friendly (${ump.runScoringIndex.toFixed(1)} R/G avg, ${ump.kZoneAccuracy}% accuracy)`;
  return `${ump.name} — neutral zone (${ump.runScoringIndex.toFixed(1)} R/G avg)`;
}
