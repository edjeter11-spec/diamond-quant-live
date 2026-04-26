// ──────────────────────────────────────────────────────────
// Line Movement / Steam Detection
// Snapshots odds over time and detects sharp money moves.
// Storage: Supabase app_state via cloudGet/cloudSet.
// Key shape: line_snap_{gameId}_{market}  → array (FIFO, max 10)
// ──────────────────────────────────────────────────────────

import { cloudGet, cloudSet } from "@/lib/supabase/client";

const MAX_SNAPSHOTS = 10;
const STEAM_WINDOW_MS = 2 * 60 * 60 * 1000; // 2h

// ── Snapshot shape ──
export interface OddsSnapshot {
  ts: number;          // unix ms
  homeML?: number;     // american
  awayML?: number;
  total?: number;      // O/U line
  overPrice?: number;
  underPrice?: number;
  spread?: number;     // home spread (pts)
  spreadPrice?: number;
}

export type MarketKey = "ml" | "spread" | "total";

export interface LineMovement {
  direction: "home" | "away" | "over" | "under" | "stable";
  magnitude: number;        // total movement, cents (ML) or points (spread/total)
  isSteam: boolean;         // sharp move within window
  openOdds: number;         // earliest captured price/line
  movement: string;         // human description, e.g. "+15 to home"
  ageMs: number;            // age of the open snapshot
}

function snapKey(gameId: string, market: MarketKey): string {
  return `line_snap_${gameId}_${market}`;
}

// Reduce odds object to per-market snapshot
function buildSnap(odds: Partial<OddsSnapshot>): OddsSnapshot {
  return { ts: Date.now(), ...odds };
}

// ── PUBLIC: snapshotOdds ──
// Saves odds for a given game/market. FIFO-bounded at MAX_SNAPSHOTS.
// Fire-and-forget: callers should not await this on hot paths.
export async function snapshotOdds(
  _sport: string,
  gameId: string,
  market: MarketKey,
  odds: Partial<OddsSnapshot>
): Promise<void> {
  if (!gameId || !market) return;
  const key = snapKey(gameId, market);
  try {
    const existing = await cloudGet<OddsSnapshot[]>(key, []);
    const arr = Array.isArray(existing) ? existing.slice() : [];
    const next = buildSnap(odds);

    // De-dup: if last snap is identical & <60s old, skip write
    const last = arr[arr.length - 1];
    if (last && Date.now() - last.ts < 60 * 1000 && shallowSameOdds(last, next)) return;

    arr.push(next);
    while (arr.length > MAX_SNAPSHOTS) arr.shift(); // FIFO drop
    await cloudSet(key, arr);
  } catch {
    // swallow — snapshot is best-effort
  }
}

function shallowSameOdds(a: OddsSnapshot, b: OddsSnapshot): boolean {
  return a.homeML === b.homeML && a.awayML === b.awayML &&
    a.total === b.total && a.overPrice === b.overPrice &&
    a.underPrice === b.underPrice && a.spread === b.spread;
}

// ── PUBLIC: getLineMovement ──
// Compares earliest snapshot to currentOdds. Markets:
//   ml      → uses homeML/awayML (cents)
//   spread  → uses home spread (points)
//   total   → uses total line (points) + over/under price as tiebreak
export async function getLineMovement(
  gameId: string,
  market: MarketKey,
  currentOdds: Partial<OddsSnapshot>
): Promise<LineMovement> {
  const key = snapKey(gameId, market);
  let snaps: OddsSnapshot[] = [];
  try {
    snaps = (await cloudGet<OddsSnapshot[]>(key, [])) ?? [];
  } catch {
    snaps = [];
  }

  if (!Array.isArray(snaps) || snaps.length === 0) {
    return { direction: "stable", magnitude: 0, isSteam: false, openOdds: 0, movement: "no history", ageMs: 0 };
  }

  const open = snaps[0];
  const ageMs = Date.now() - open.ts;
  const inSteamWindow = ageMs <= STEAM_WINDOW_MS;

  if (market === "ml") {
    const openHome = open.homeML ?? 0;
    const curHome = currentOdds.homeML ?? openHome;
    const homeDelta = curHome - openHome; // cents
    const openAway = open.awayML ?? 0;
    const curAway = currentOdds.awayML ?? openAway;
    const awayDelta = curAway - openAway;

    // The side whose price has FALLEN (more negative / less positive) is being hammered.
    // i.e. odds shorten on the side getting bet.
    const homeShorten = -homeDelta; // positive = home shortened
    const awayShorten = -awayDelta;
    const magnitude = Math.max(Math.abs(homeShorten), Math.abs(awayShorten));
    let direction: LineMovement["direction"] = "stable";
    if (homeShorten >= 5 && homeShorten >= awayShorten) direction = "home";
    else if (awayShorten >= 5 && awayShorten > homeShorten) direction = "away";

    const isSteam = inSteamWindow && magnitude >= 15 && direction !== "stable";
    const sign = (direction === "home" ? homeShorten : awayShorten) >= 0 ? "+" : "-";
    const movement = direction === "stable"
      ? `flat (open ${openHome >= 0 ? "+" : ""}${openHome}/${openAway >= 0 ? "+" : ""}${openAway})`
      : `${sign}${Math.abs(direction === "home" ? homeShorten : awayShorten)}c to ${direction}`;

    return { direction, magnitude, isSteam, openOdds: openHome, movement, ageMs };
  }

  if (market === "spread") {
    const openSpread = open.spread ?? 0;
    const curSpread = currentOdds.spread ?? openSpread;
    const delta = curSpread - openSpread; // negative = home spread tightened (home bet)
    const magnitude = Math.abs(delta);
    let direction: LineMovement["direction"] = "stable";
    if (delta <= -0.5) direction = "home";
    else if (delta >= 0.5) direction = "away";
    const isSteam = inSteamWindow && magnitude >= 1.0 && direction !== "stable";
    const movement = direction === "stable"
      ? `flat (${openSpread > 0 ? "+" : ""}${openSpread})`
      : `${delta > 0 ? "+" : ""}${delta.toFixed(1)} to ${direction}`;
    return { direction, magnitude, isSteam, openOdds: openSpread, movement, ageMs };
  }

  // total
  const openTotal = open.total ?? 0;
  const curTotal = currentOdds.total ?? openTotal;
  const delta = curTotal - openTotal; // positive = total moved up (over bet)
  const magnitude = Math.abs(delta);
  let direction: LineMovement["direction"] = "stable";
  if (delta >= 0.5) direction = "over";
  else if (delta <= -0.5) direction = "under";
  const isSteam = inSteamWindow && magnitude >= 1.0 && direction !== "stable";
  const movement = direction === "stable"
    ? `flat (${openTotal})`
    : `${delta > 0 ? "+" : ""}${delta.toFixed(1)} to ${direction}`;
  return { direction, magnitude, isSteam, openOdds: openTotal, movement, ageMs };
}

// ── PUBLIC: detectSteamMoves ──
// Scans a list of games (each w/ id + best lines) and returns those
// currently steam-moving. Best-effort; failures yield empty list.
export interface SteamGame {
  gameId: string;
  market: MarketKey;
  movement: LineMovement;
}

export async function detectSteamMoves(allGames: any[]): Promise<SteamGame[]> {
  if (!Array.isArray(allGames) || allGames.length === 0) return [];
  const results: SteamGame[] = [];

  await Promise.all(
    allGames.map(async (g) => {
      const id = g?.id ?? g?.gameId;
      if (!id) return;
      const lines = g?.oddsLines ?? [];
      const first = lines[0];
      if (!first) return;

      try {
        const [ml, spread, total] = await Promise.all([
          getLineMovement(id, "ml", { homeML: first.homeML, awayML: first.awayML }),
          getLineMovement(id, "spread", { spread: first.homeSpread }),
          getLineMovement(id, "total", { total: first.total, overPrice: first.overPrice, underPrice: first.underPrice }),
        ]);
        if (ml.isSteam) results.push({ gameId: id, market: "ml", movement: ml });
        if (spread.isSteam) results.push({ gameId: id, market: "spread", movement: spread });
        if (total.isSteam) results.push({ gameId: id, market: "total", movement: total });
      } catch {}
    })
  );

  return results;
}

// ── Helper: persist all 3 markets for a game in one shot ──
// Called from the /api/odds route fire-and-forget.
export function snapshotGameMarkets(gameId: string, oddsLines: any[]): void {
  if (!gameId || !Array.isArray(oddsLines) || oddsLines.length === 0) return;
  const first = oddsLines[0];
  // Don't await — fire-and-forget
  void snapshotOdds("", gameId, "ml", { homeML: first.homeML, awayML: first.awayML });
  void snapshotOdds("", gameId, "spread", { spread: first.homeSpread, spreadPrice: first.spreadPrice });
  void snapshotOdds("", gameId, "total", { total: first.total, overPrice: first.overPrice, underPrice: first.underPrice });
}
