// ──────────────────────────────────────────────────────────
// NFL Per-Position Defensive Strength
//
// 0-100 scale. Higher = team allows MORE production at that position.
// 50 = league average. Updated periodically from FTN/PFF style data.
//
// Use case: a top WR vs a team weak vs WRs → lean OVER. Same WR vs
// a shutdown corner → lean UNDER.
// ──────────────────────────────────────────────────────────

export type NFLPosition = "QB" | "RB" | "WR" | "TE" | "K" | "DEF";

interface PositionDefense {
  QB: number;
  RB: number;
  WR: number;
  TE: number;
}

// 2024-25 per-position defensive efficiency (approximate)
export const NFL_POS_DEFENSE: Record<string, PositionDefense> = {
  ARI: { QB: 58, RB: 55, WR: 52, TE: 48 },
  ATL: { QB: 60, RB: 60, WR: 58, TE: 55 },
  BAL: { QB: 38, RB: 35, WR: 42, TE: 45 },
  BUF: { QB: 35, RB: 40, WR: 40, TE: 42 },
  CAR: { QB: 65, RB: 65, WR: 62, TE: 60 },
  CHI: { QB: 48, RB: 50, WR: 50, TE: 48 },
  CIN: { QB: 52, RB: 50, WR: 50, TE: 52 },
  CLE: { QB: 42, RB: 45, WR: 45, TE: 48 },
  DAL: { QB: 50, RB: 52, WR: 50, TE: 50 },
  DEN: { QB: 38, RB: 42, WR: 40, TE: 45 },
  DET: { QB: 50, RB: 48, WR: 52, TE: 55 },
  GB:  { QB: 42, RB: 45, WR: 45, TE: 50 },
  HOU: { QB: 45, RB: 45, WR: 45, TE: 48 },
  IND: { QB: 55, RB: 55, WR: 52, TE: 50 },
  JAX: { QB: 62, RB: 60, WR: 60, TE: 58 },
  KC:  { QB: 35, RB: 38, WR: 40, TE: 42 },
  LV:  { QB: 60, RB: 62, WR: 58, TE: 55 },
  LAC: { QB: 50, RB: 48, WR: 50, TE: 52 },
  LAR: { QB: 52, RB: 50, WR: 50, TE: 48 },
  MIA: { QB: 55, RB: 55, WR: 52, TE: 52 },
  MIN: { QB: 42, RB: 45, WR: 45, TE: 48 },
  NE:  { QB: 55, RB: 58, WR: 55, TE: 55 },
  NO:  { QB: 50, RB: 52, WR: 48, TE: 50 },
  NYG: { QB: 55, RB: 55, WR: 55, TE: 52 },
  NYJ: { QB: 38, RB: 42, WR: 38, TE: 45 },
  PHI: { QB: 38, RB: 40, WR: 42, TE: 45 },
  PIT: { QB: 40, RB: 42, WR: 42, TE: 45 },
  SF:  { QB: 38, RB: 38, WR: 40, TE: 42 },
  SEA: { QB: 50, RB: 50, WR: 50, TE: 50 },
  TB:  { QB: 48, RB: 45, WR: 50, TE: 50 },
  TEN: { QB: 60, RB: 62, WR: 58, TE: 55 },
  WAS: { QB: 58, RB: 58, WR: 60, TE: 58 },
};

// Map market → position the prop is most affected by
export function getPositionForMarket(market: string): NFLPosition {
  if (market.startsWith("player_pass")) return "QB";
  if (market.startsWith("player_rush")) return "RB";
  if (market.startsWith("player_reception")) return "WR"; // also TE — caller can override
  return "WR";
}

export function getNFLDefVsPosition(teamAbbrev: string, position: NFLPosition): number {
  const t = NFL_POS_DEFENSE[teamAbbrev.toUpperCase()];
  if (!t) return 50;
  if (position === "K" || position === "DEF") return 50;
  return t[position as keyof PositionDefense] ?? 50;
}

// Convert 0-100 def num → 1-30 rank (lower = better defense)
export function nflDefenseToRank(defNum: number): number {
  const clamped = Math.max(30, Math.min(70, defNum));
  return Math.round(((clamped - 30) / 40) * 29 + 1);
}
