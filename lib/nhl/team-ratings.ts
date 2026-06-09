// ──────────────────────────────────────────────────────────
// NHL Team Ratings (2024-25 baselines)
// xG = expected goals. Lower defensive xG = better defense.
// PP% = power play %. PK% = penalty kill %.
// ──────────────────────────────────────────────────────────

export interface NHLTeamRating {
  xGFperGame: number;     // expected goals for per game
  xGAperGame: number;     // expected goals against per game
  ppPct: number;          // power play %
  pkPct: number;          // penalty kill %
  shotsForPerGame: number;
  shotsAgainstPerGame: number;
  paceMinutes: number;    // 5v5 pace - relative tempo
  goalsForPerGame: number;
  goalsAgainstPerGame: number;
}

// 2024-25 approximations
export const NHL_TEAM_RATINGS: Record<string, NHLTeamRating> = {
  ANA: { xGFperGame: 2.65, xGAperGame: 3.30, ppPct: 16.5, pkPct: 76.0, shotsForPerGame: 28.0, shotsAgainstPerGame: 32.5, paceMinutes: 1.00, goalsForPerGame: 2.6, goalsAgainstPerGame: 3.4 },
  UTA: { xGFperGame: 3.05, xGAperGame: 2.95, ppPct: 23.5, pkPct: 79.0, shotsForPerGame: 30.0, shotsAgainstPerGame: 30.5, paceMinutes: 1.02, goalsForPerGame: 3.1, goalsAgainstPerGame: 3.0 },
  BOS: { xGFperGame: 3.10, xGAperGame: 2.75, ppPct: 24.5, pkPct: 80.5, shotsForPerGame: 30.5, shotsAgainstPerGame: 28.5, paceMinutes: 1.00, goalsForPerGame: 3.2, goalsAgainstPerGame: 2.8 },
  BUF: { xGFperGame: 2.95, xGAperGame: 3.15, ppPct: 21.0, pkPct: 77.5, shotsForPerGame: 30.0, shotsAgainstPerGame: 31.5, paceMinutes: 1.03, goalsForPerGame: 3.0, goalsAgainstPerGame: 3.2 },
  CGY: { xGFperGame: 2.75, xGAperGame: 3.00, ppPct: 19.5, pkPct: 78.5, shotsForPerGame: 28.5, shotsAgainstPerGame: 30.5, paceMinutes: 1.00, goalsForPerGame: 2.8, goalsAgainstPerGame: 3.1 },
  CAR: { xGFperGame: 3.20, xGAperGame: 2.55, ppPct: 22.5, pkPct: 82.0, shotsForPerGame: 33.5, shotsAgainstPerGame: 27.0, paceMinutes: 1.04, goalsForPerGame: 3.3, goalsAgainstPerGame: 2.6 },
  CHI: { xGFperGame: 2.45, xGAperGame: 3.40, ppPct: 17.0, pkPct: 75.5, shotsForPerGame: 27.0, shotsAgainstPerGame: 33.5, paceMinutes: 1.00, goalsForPerGame: 2.5, goalsAgainstPerGame: 3.6 },
  COL: { xGFperGame: 3.25, xGAperGame: 2.75, ppPct: 25.5, pkPct: 80.0, shotsForPerGame: 32.0, shotsAgainstPerGame: 29.0, paceMinutes: 1.05, goalsForPerGame: 3.4, goalsAgainstPerGame: 2.8 },
  CBJ: { xGFperGame: 2.85, xGAperGame: 3.10, ppPct: 18.5, pkPct: 78.0, shotsForPerGame: 29.0, shotsAgainstPerGame: 31.5, paceMinutes: 1.01, goalsForPerGame: 2.9, goalsAgainstPerGame: 3.1 },
  DAL: { xGFperGame: 3.15, xGAperGame: 2.70, ppPct: 23.0, pkPct: 81.0, shotsForPerGame: 30.5, shotsAgainstPerGame: 28.5, paceMinutes: 1.01, goalsForPerGame: 3.2, goalsAgainstPerGame: 2.7 },
  DET: { xGFperGame: 2.95, xGAperGame: 3.00, ppPct: 22.0, pkPct: 79.5, shotsForPerGame: 30.0, shotsAgainstPerGame: 30.0, paceMinutes: 1.00, goalsForPerGame: 2.9, goalsAgainstPerGame: 3.0 },
  EDM: { xGFperGame: 3.30, xGAperGame: 2.85, ppPct: 27.5, pkPct: 80.5, shotsForPerGame: 32.5, shotsAgainstPerGame: 29.0, paceMinutes: 1.05, goalsForPerGame: 3.4, goalsAgainstPerGame: 2.9 },
  FLA: { xGFperGame: 3.15, xGAperGame: 2.60, ppPct: 23.5, pkPct: 83.0, shotsForPerGame: 31.0, shotsAgainstPerGame: 27.5, paceMinutes: 1.02, goalsForPerGame: 3.2, goalsAgainstPerGame: 2.6 },
  LAK: { xGFperGame: 2.95, xGAperGame: 2.75, ppPct: 21.5, pkPct: 81.0, shotsForPerGame: 29.5, shotsAgainstPerGame: 28.5, paceMinutes: 0.98, goalsForPerGame: 3.0, goalsAgainstPerGame: 2.8 },
  MIN: { xGFperGame: 2.85, xGAperGame: 2.90, ppPct: 22.0, pkPct: 80.0, shotsForPerGame: 29.5, shotsAgainstPerGame: 30.0, paceMinutes: 1.00, goalsForPerGame: 2.9, goalsAgainstPerGame: 2.9 },
  MTL: { xGFperGame: 2.75, xGAperGame: 3.10, ppPct: 20.0, pkPct: 77.0, shotsForPerGame: 28.5, shotsAgainstPerGame: 31.5, paceMinutes: 1.01, goalsForPerGame: 2.8, goalsAgainstPerGame: 3.2 },
  NSH: { xGFperGame: 2.95, xGAperGame: 2.95, ppPct: 21.0, pkPct: 79.0, shotsForPerGame: 30.0, shotsAgainstPerGame: 30.0, paceMinutes: 1.00, goalsForPerGame: 3.0, goalsAgainstPerGame: 3.0 },
  NJD: { xGFperGame: 3.10, xGAperGame: 2.80, ppPct: 22.5, pkPct: 79.5, shotsForPerGame: 31.5, shotsAgainstPerGame: 28.5, paceMinutes: 1.04, goalsForPerGame: 3.1, goalsAgainstPerGame: 2.8 },
  NYI: { xGFperGame: 2.80, xGAperGame: 2.90, ppPct: 19.5, pkPct: 80.5, shotsForPerGame: 28.5, shotsAgainstPerGame: 29.5, paceMinutes: 0.97, goalsForPerGame: 2.8, goalsAgainstPerGame: 2.9 },
  NYR: { xGFperGame: 3.15, xGAperGame: 2.85, ppPct: 24.5, pkPct: 80.0, shotsForPerGame: 30.5, shotsAgainstPerGame: 29.0, paceMinutes: 1.00, goalsForPerGame: 3.1, goalsAgainstPerGame: 2.9 },
  OTT: { xGFperGame: 2.90, xGAperGame: 3.05, ppPct: 21.5, pkPct: 78.5, shotsForPerGame: 29.5, shotsAgainstPerGame: 30.5, paceMinutes: 1.01, goalsForPerGame: 2.9, goalsAgainstPerGame: 3.0 },
  PHI: { xGFperGame: 2.85, xGAperGame: 3.00, ppPct: 19.5, pkPct: 78.0, shotsForPerGame: 29.0, shotsAgainstPerGame: 30.5, paceMinutes: 1.00, goalsForPerGame: 2.9, goalsAgainstPerGame: 3.0 },
  PIT: { xGFperGame: 2.95, xGAperGame: 2.95, ppPct: 22.5, pkPct: 79.0, shotsForPerGame: 30.0, shotsAgainstPerGame: 30.0, paceMinutes: 1.00, goalsForPerGame: 2.9, goalsAgainstPerGame: 3.0 },
  SJS: { xGFperGame: 2.50, xGAperGame: 3.45, ppPct: 17.5, pkPct: 74.5, shotsForPerGame: 27.0, shotsAgainstPerGame: 33.5, paceMinutes: 0.98, goalsForPerGame: 2.5, goalsAgainstPerGame: 3.6 },
  SEA: { xGFperGame: 2.80, xGAperGame: 2.95, ppPct: 20.5, pkPct: 79.5, shotsForPerGame: 29.0, shotsAgainstPerGame: 30.5, paceMinutes: 0.99, goalsForPerGame: 2.8, goalsAgainstPerGame: 3.0 },
  STL: { xGFperGame: 2.90, xGAperGame: 2.95, ppPct: 21.0, pkPct: 79.0, shotsForPerGame: 29.5, shotsAgainstPerGame: 30.0, paceMinutes: 1.00, goalsForPerGame: 2.9, goalsAgainstPerGame: 3.0 },
  TBL: { xGFperGame: 3.20, xGAperGame: 2.70, ppPct: 25.0, pkPct: 81.5, shotsForPerGame: 32.0, shotsAgainstPerGame: 28.0, paceMinutes: 1.03, goalsForPerGame: 3.3, goalsAgainstPerGame: 2.7 },
  TOR: { xGFperGame: 3.20, xGAperGame: 2.90, ppPct: 24.5, pkPct: 79.5, shotsForPerGame: 31.0, shotsAgainstPerGame: 29.5, paceMinutes: 1.01, goalsForPerGame: 3.2, goalsAgainstPerGame: 2.9 },
  VAN: { xGFperGame: 3.05, xGAperGame: 2.80, ppPct: 22.5, pkPct: 80.0, shotsForPerGame: 30.0, shotsAgainstPerGame: 29.0, paceMinutes: 1.00, goalsForPerGame: 3.0, goalsAgainstPerGame: 2.8 },
  VGK: { xGFperGame: 3.15, xGAperGame: 2.75, ppPct: 23.5, pkPct: 81.5, shotsForPerGame: 31.0, shotsAgainstPerGame: 28.5, paceMinutes: 1.02, goalsForPerGame: 3.1, goalsAgainstPerGame: 2.7 },
  WSH: { xGFperGame: 3.00, xGAperGame: 2.85, ppPct: 22.0, pkPct: 80.0, shotsForPerGame: 30.0, shotsAgainstPerGame: 29.0, paceMinutes: 1.00, goalsForPerGame: 3.0, goalsAgainstPerGame: 2.9 },
  WPG: { xGFperGame: 3.20, xGAperGame: 2.70, ppPct: 24.0, pkPct: 81.0, shotsForPerGame: 30.5, shotsAgainstPerGame: 28.5, paceMinutes: 1.01, goalsForPerGame: 3.2, goalsAgainstPerGame: 2.7 },
};

export function getNHLTeamRating(abbrev: string): NHLTeamRating {
  return NHL_TEAM_RATINGS[abbrev.toUpperCase()] ?? {
    xGFperGame: 3.0, xGAperGame: 3.0, ppPct: 21, pkPct: 79,
    shotsForPerGame: 30, shotsAgainstPerGame: 30, paceMinutes: 1.0,
    goalsForPerGame: 3.0, goalsAgainstPerGame: 3.0,
  };
}
