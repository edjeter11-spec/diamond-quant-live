// ──────────────────────────────────────────────────────────
// NHL Per-Position Defensive Strength
// Forwards (F) = how easy it is for opposing forwards to score
// Defensemen (D) = how easy for D-men to put up points
// Goalie = save percentage of starter facing this team
//
// 0-100. 50 = neutral. Higher = team allows MORE production.
// ──────────────────────────────────────────────────────────

export type NHLPosition = "F" | "D" | "G";

interface NHLPositionDefense {
  F: number;     // vs forwards
  D: number;     // vs defensemen
  Shots: number; // vs shots on goal
  PP: number;    // power play allowed (higher = gives more PP time)
}

export const NHL_POS_DEFENSE: Record<string, NHLPositionDefense> = {
  ANA: { F: 62, D: 60, Shots: 65, PP: 58 },
  UTA: { F: 50, D: 52, Shots: 52, PP: 50 },
  BOS: { F: 42, D: 40, Shots: 40, PP: 42 },
  BUF: { F: 56, D: 55, Shots: 55, PP: 55 },
  CGY: { F: 52, D: 50, Shots: 52, PP: 50 },
  CAR: { F: 35, D: 35, Shots: 32, PP: 36 },
  CHI: { F: 65, D: 62, Shots: 65, PP: 62 },
  COL: { F: 45, D: 45, Shots: 45, PP: 48 },
  CBJ: { F: 58, D: 55, Shots: 58, PP: 55 },
  DAL: { F: 40, D: 42, Shots: 40, PP: 42 },
  DET: { F: 50, D: 50, Shots: 50, PP: 50 },
  EDM: { F: 48, D: 50, Shots: 48, PP: 52 },
  FLA: { F: 38, D: 38, Shots: 35, PP: 38 },
  LAK: { F: 42, D: 42, Shots: 42, PP: 42 },
  MIN: { F: 48, D: 50, Shots: 50, PP: 48 },
  MTL: { F: 58, D: 55, Shots: 58, PP: 55 },
  NSH: { F: 50, D: 50, Shots: 50, PP: 50 },
  NJD: { F: 45, D: 48, Shots: 45, PP: 45 },
  NYI: { F: 48, D: 48, Shots: 48, PP: 50 },
  NYR: { F: 45, D: 45, Shots: 45, PP: 45 },
  OTT: { F: 55, D: 52, Shots: 55, PP: 52 },
  PHI: { F: 55, D: 52, Shots: 52, PP: 55 },
  PIT: { F: 50, D: 50, Shots: 50, PP: 50 },
  SJS: { F: 65, D: 62, Shots: 65, PP: 62 },
  SEA: { F: 50, D: 52, Shots: 52, PP: 50 },
  STL: { F: 52, D: 50, Shots: 50, PP: 52 },
  TBL: { F: 40, D: 40, Shots: 38, PP: 40 },
  TOR: { F: 50, D: 50, Shots: 48, PP: 50 },
  VAN: { F: 45, D: 48, Shots: 48, PP: 45 },
  VGK: { F: 42, D: 42, Shots: 42, PP: 42 },
  WSH: { F: 48, D: 48, Shots: 48, PP: 48 },
  WPG: { F: 38, D: 40, Shots: 40, PP: 40 },
};

export function getNHLDefVsPosition(teamAbbrev: string, position: NHLPosition): number {
  const t = NHL_POS_DEFENSE[teamAbbrev.toUpperCase()];
  if (!t) return 50;
  if (position === "G") return t.Shots; // shots faced
  return position === "F" ? t.F : t.D;
}

export function getNHLDefVsShots(teamAbbrev: string): number {
  return NHL_POS_DEFENSE[teamAbbrev.toUpperCase()]?.Shots ?? 50;
}

export function getNHLPowerPlayGiven(teamAbbrev: string): number {
  return NHL_POS_DEFENSE[teamAbbrev.toUpperCase()]?.PP ?? 50;
}
