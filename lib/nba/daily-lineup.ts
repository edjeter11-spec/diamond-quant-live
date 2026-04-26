// ──────────────────────────────────────────────────────────
// NBA Daily Lineup Confirmation Signal
//
// Sportsbooks post player props 2-3h before tip — BEFORE
// confirmed starting lineups. If a 25+ ppg star is unexpectedly
// OUT and books haven't adjusted, that's pure edge.
//
// Mirrors lib/mlb/daily-lineup.ts pattern. Source: ESPN summary
// endpoint — boxscore.players[].statistics[0].athletes[] gives
// the starter array; injuries[] gives the OUT/DNP feed.
// Endpoint: site.api.espn.com/.../basketball/nba/summary?event={id}
// ──────────────────────────────────────────────────────────

import { getCached, setCache } from "@/lib/odds/server-cache";
import { cloudGet, cloudSet } from "@/lib/supabase/client";
import { searchNBAPlayer } from "@/lib/nba/player-stats";

const ESPN_SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary";
const CACHE_TTL = 15 * 60 * 1000; // 15min — lineups don't change once posted

export interface NBALineupStarter {
  name: string;
  playerId: string;
  position: string;
}

export interface NBAInactiveStar {
  name: string;
  reason: string;     // "Out" / "DNP-CD" / "ankle" etc
  impact: number;     // projected points contribution that vanishes (≈ ppg)
}

export interface NBALineupReport {
  gameId: string;
  teamAbbrev: string;
  starters: NBALineupStarter[];
  inactiveStars: NBAInactiveStar[];
  confirmed: boolean; // true if lineup officially posted (>1h pre-game)
  summary: string;
}

interface ESPNAthlete {
  active?: boolean;
  starter?: boolean;
  didNotPlay?: boolean;
  reason?: string;
  athlete?: {
    id?: string | number;
    fullName?: string;
    displayName?: string;
    position?: { abbreviation?: string };
  };
}

interface ESPNInjury {
  status?: string;
  type?: { name?: string; abbreviation?: string };
  details?: { type?: string; detail?: string };
  athlete?: { id?: string | number; fullName?: string; displayName?: string };
}

async function fetchSummary(gameId: string): Promise<any | null> {
  try {
    const res = await fetch(`${ESPN_SUMMARY}?event=${gameId}`, { next: { revalidate: 900 } });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Fetch starting lineup + inactive-star report for one team's upcoming game.
 * `confirmed` = true once we're inside the 1h-pre-tip window AND ESPN has 5 starters.
 */
export async function getNBALineup(
  gameId: string,
  teamAbbrev: string
): Promise<NBALineupReport> {
  const memKey = `nba_lineup_${gameId}_${teamAbbrev}`;
  const memCached = getCached(memKey, CACHE_TTL) as NBALineupReport | null;
  if (memCached) return memCached;

  // Supabase day-cache (survives serverless cold starts)
  const cloudKey = `nba_lineup_${gameId}_${todayKey()}_${teamAbbrev}`;
  try {
    const cloud = await cloudGet<{ data: NBALineupReport; ts: number } | null>(cloudKey, null);
    if (cloud && Date.now() - cloud.ts < CACHE_TTL) {
      setCache(memKey, cloud.data);
      return cloud.data;
    }
  } catch {}

  const empty: NBALineupReport = {
    gameId, teamAbbrev,
    starters: [], inactiveStars: [],
    confirmed: false,
    summary: `${teamAbbrev} lineup not yet posted`,
  };

  const summary = await fetchSummary(gameId);
  if (!summary) {
    setCache(memKey, empty);
    return empty;
  }

  // Tip-off time → are we within 1h pre-game?
  const dateStr: string | undefined = summary.header?.competitions?.[0]?.date;
  const tipMs = dateStr ? new Date(dateStr).getTime() : 0;
  const minsToTip = tipMs ? (tipMs - Date.now()) / 60000 : Infinity;

  // ── Starters from boxscore ──
  const teamBox = (summary.boxscore?.players ?? []).find(
    (t: any) => (t.team?.abbreviation ?? "").toUpperCase() === teamAbbrev.toUpperCase()
  );
  const athletes: ESPNAthlete[] = teamBox?.statistics?.[0]?.athletes ?? [];
  const starters: NBALineupStarter[] = athletes
    .filter(a => a.starter && a.athlete?.fullName)
    .map(a => ({
      name: a.athlete!.fullName ?? a.athlete!.displayName ?? "",
      playerId: String(a.athlete!.id ?? ""),
      position: a.athlete!.position?.abbreviation ?? "",
    }));

  // Confirmed = 5 starters AND inside the pre-tip window (or already in-game)
  const confirmed = starters.length === 5 && minsToTip <= 60;

  // ── Inactive stars: cross-reference ESPN injuries[] + DNPs against player ppg ──
  const teamInjuries = (summary.injuries ?? []).find(
    (t: any) => (t.team?.abbreviation ?? "").toUpperCase() === teamAbbrev.toUpperCase()
  );
  const injEntries: ESPNInjury[] = teamInjuries?.injuries ?? [];

  const inactiveStars: NBAInactiveStar[] = [];

  // Pull ppg via searchNBAPlayer (already cached in player-stats.ts)
  for (const inj of injEntries) {
    const status = (inj.type?.name ?? inj.status ?? "").toUpperCase();
    if (!status.includes("OUT") && !status.includes("DOUBTFUL")) continue;
    const name = inj.athlete?.fullName ?? inj.athlete?.displayName ?? "";
    if (!name) continue;
    let ppg = 0;
    try {
      const p = await searchNBAPlayer(name);
      ppg = p?.ppg ?? 0;
    } catch {}
    if (ppg < 20) continue; // only stars (>=20 ppg)
    inactiveStars.push({
      name,
      reason: inj.details?.detail ?? inj.details?.type ?? inj.status ?? "Out",
      impact: Math.round(ppg * 10) / 10,
    });
  }

  // DNP-CD style scratches that show up in athletes but not in injuries[]
  for (const a of athletes) {
    if (!a.didNotPlay || a.starter) continue;
    const name = a.athlete?.fullName ?? a.athlete?.displayName ?? "";
    if (!name) continue;
    if (inactiveStars.some(s => s.name === name)) continue;
    let ppg = 0;
    try { const p = await searchNBAPlayer(name); ppg = p?.ppg ?? 0; } catch {}
    if (ppg < 20) continue;
    inactiveStars.push({ name, reason: a.reason ?? "DNP", impact: Math.round(ppg * 10) / 10 });
  }

  inactiveStars.sort((a, b) => b.impact - a.impact);

  const totalImpact = inactiveStars.reduce((s, p) => s + p.impact, 0);
  const summaryLine = inactiveStars.length === 0
    ? confirmed
      ? `${teamAbbrev} confirmed — full strength`
      : `${teamAbbrev} no star absences flagged`
    : `${teamAbbrev} missing ${inactiveStars.length} star${inactiveStars.length !== 1 ? "s" : ""} (-${totalImpact.toFixed(1)} ppg): ${inactiveStars.slice(0, 3).map(s => `${s.name.split(" ").pop()} (${s.impact})`).join(", ")}`;

  const result: NBALineupReport = {
    gameId, teamAbbrev,
    starters, inactiveStars, confirmed,
    summary: summaryLine,
  };

  setCache(memKey, result);
  // Fire-and-forget cloud write
  cloudSet(cloudKey, { data: result, ts: Date.now() }).catch(() => {});
  return result;
}

/**
 * Net edge in projected points from one team's lineup report.
 * Returns from the perspective of THAT team — caller flips sign for opponent.
 *
 * A 25+ ppg star OUT ≈ -8 pts to that team (and +4 to opponent on the other call).
 * Rule: each missing star contributes -(ppg * 0.32) to its own team.
 * Capped at ±12 pts to keep one report from blowing up the model.
 */
export function computeNBALineupEdge(lineup: NBALineupReport): number {
  if (!lineup.confirmed && lineup.inactiveStars.length === 0) return 0;
  const raw = lineup.inactiveStars.reduce((s, p) => s + p.impact * 0.32, 0);
  return Math.max(-12, Math.min(12, -raw));
}
