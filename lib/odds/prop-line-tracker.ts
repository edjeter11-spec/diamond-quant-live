// ──────────────────────────────────────────────────────────
// PROP LINE MOVEMENT TRACKER
// Captures prop line snapshots over time to detect sharp movement
// "Booker was 25.5 → now 27.5" = sharp money on the over
// Feeds into the brain's lineMovement factor
// ──────────────────────────────────────────────────────────

export interface PropLineSnapshot {
  timestamp: string;
  lines: Record<string, PropLineEntry>; // key: "playerName::propType"
}

export interface PropLineEntry {
  playerName: string;
  propType: string;
  line: number;
  bestOverOdds: number;
  bestUnderOdds: number;
}

export interface PropLineMovement {
  playerName: string;
  propType: string;
  openingLine: number;
  currentLine: number;
  lineShift: number;        // positive = line moved up (sharp over)
  openingOverOdds: number;
  currentOverOdds: number;
  oddsShift: number;        // negative = over got more expensive (sharp over)
  direction: "sharp_over" | "sharp_under" | "stable";
  signal: number;           // -1 to +1 for the brain's lineMovement factor
  firstSeen: string;
  lastUpdate: string;
}

const STORAGE_KEY = "dq_prop_line_snapshots";
const MAX_SNAPSHOTS = 24; // keep 24 snapshots (~12 hours at 30-min intervals)

// ── Load snapshots from localStorage ──
export function loadPropSnapshots(): PropLineSnapshot[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

// ── Save a new snapshot ──
export function savePropSnapshot(props: Array<{ playerName: string; propType: string; line: number; bestOverOdds: number; bestUnderOdds: number }>) {
  if (typeof window === "undefined") return;

  const lines: Record<string, PropLineEntry> = {};
  for (const p of props) {
    const key = `${p.playerName}::${p.propType}`;
    lines[key] = {
      playerName: p.playerName,
      propType: p.propType,
      line: p.line,
      bestOverOdds: p.bestOverOdds,
      bestUnderOdds: p.bestUnderOdds,
    };
  }

  const snapshots = loadPropSnapshots();
  snapshots.push({ timestamp: new Date().toISOString(), lines });

  // Keep only recent snapshots
  const trimmed = snapshots.slice(-MAX_SNAPSHOTS);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {}
}

// ── Get line movement for a specific player/prop ──
export function getPropLineMovement(playerName: string, propType: string): PropLineMovement | null {
  const snapshots = loadPropSnapshots();
  if (snapshots.length < 2) return null;

  const key = `${playerName}::${propType}`;
  const first = snapshots.find(s => s.lines[key]);
  const last = snapshots[snapshots.length - 1];

  if (!first || !last?.lines[key]) return null;

  const opening = first.lines[key];
  const current = last.lines[key];

  const lineShift = current.line - opening.line;
  const oddsShift = current.bestOverOdds - opening.bestOverOdds;

  // Determine direction
  // Line moved up AND over got more expensive = sharp over
  // Line moved down AND under got more expensive = sharp under
  let direction: PropLineMovement["direction"] = "stable";
  let signal = 0;

  if (Math.abs(lineShift) >= 0.5) {
    if (lineShift > 0) {
      direction = "sharp_over";
      signal = Math.min(1, lineShift / 3); // +3 line shift = max signal
    } else {
      direction = "sharp_under";
      signal = Math.max(-1, lineShift / 3);
    }
  } else if (Math.abs(oddsShift) >= 10) {
    // Line didn't move but odds shifted significantly
    if (oddsShift < -10) {
      direction = "sharp_over"; // over got more expensive = sharp money on over
      signal = Math.min(1, Math.abs(oddsShift) / 30);
    } else if (oddsShift > 10) {
      direction = "sharp_under";
      signal = Math.max(-1, -oddsShift / 30);
    }
  }

  return {
    playerName,
    propType,
    openingLine: opening.line,
    currentLine: current.line,
    lineShift,
    openingOverOdds: opening.bestOverOdds,
    currentOverOdds: current.bestOverOdds,
    oddsShift,
    direction,
    signal,
    firstSeen: first.timestamp,
    lastUpdate: last.timestamp,
  };
}

// ── Get all movements for today (for the projector) ──
export function getAllPropMovements(): Record<string, PropLineMovement> {
  const snapshots = loadPropSnapshots();
  if (snapshots.length < 2) return {};

  const movements: Record<string, PropLineMovement> = {};
  const lastSnapshot = snapshots[snapshots.length - 1];

  for (const key of Object.keys(lastSnapshot.lines)) {
    const [playerName, propType] = key.split("::");
    const movement = getPropLineMovement(playerName, propType);
    if (movement && movement.direction !== "stable") {
      movements[key] = movement;
    }
  }

  return movements;
}
