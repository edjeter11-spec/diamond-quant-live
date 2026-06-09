// ──────────────────────────────────────────────────────────
// NFL Team Ratings — 2024 season baselines
// EPA per play, pace (sec/play), DVOA proxies, etc.
//
// Source: combined ESPN + nflfastR DVOA data, periodically updated.
// All values are approximate / season-end snapshots.
// ──────────────────────────────────────────────────────────

export interface NFLTeamRating {
  offEPA: number;       // offensive expected points added per play
  defEPA: number;       // defensive EPA allowed per play (lower = better defense)
  paceSec: number;      // average seconds per offensive snap (lower = faster pace)
  passRate: number;     // % of plays that are pass (vs run)
  redZoneTDPct: number; // % of red zone trips that end in TD
  yardsPerGameOff: number;
  yardsPerGameDef: number;
  pointsPerGameOff: number;
  pointsPerGameDef: number;
}

// 2024-25 season approximations
export const NFL_TEAM_RATINGS: Record<string, NFLTeamRating> = {
  ARI: { offEPA: 0.02, defEPA: 0.04, paceSec: 26.5, passRate: 0.57, redZoneTDPct: 0.58, yardsPerGameOff: 355, yardsPerGameDef: 345, pointsPerGameOff: 22.5, pointsPerGameDef: 24.8 },
  ATL: { offEPA: 0.01, defEPA: 0.05, paceSec: 28.0, passRate: 0.58, redZoneTDPct: 0.55, yardsPerGameOff: 340, yardsPerGameDef: 365, pointsPerGameOff: 21.8, pointsPerGameDef: 25.1 },
  BAL: { offEPA: 0.16, defEPA: -0.04, paceSec: 26.8, passRate: 0.54, redZoneTDPct: 0.66, yardsPerGameOff: 410, yardsPerGameDef: 305, pointsPerGameOff: 28.5, pointsPerGameDef: 18.6 },
  BUF: { offEPA: 0.15, defEPA: -0.06, paceSec: 25.9, passRate: 0.61, redZoneTDPct: 0.64, yardsPerGameOff: 395, yardsPerGameDef: 310, pointsPerGameOff: 28.2, pointsPerGameDef: 18.9 },
  CAR: { offEPA: -0.06, defEPA: 0.08, paceSec: 28.8, passRate: 0.59, redZoneTDPct: 0.48, yardsPerGameOff: 310, yardsPerGameDef: 390, pointsPerGameOff: 17.5, pointsPerGameDef: 28.7 },
  CHI: { offEPA: 0.03, defEPA: 0.00, paceSec: 27.5, passRate: 0.58, redZoneTDPct: 0.55, yardsPerGameOff: 340, yardsPerGameDef: 330, pointsPerGameOff: 21.0, pointsPerGameDef: 22.1 },
  CIN: { offEPA: 0.10, defEPA: 0.02, paceSec: 26.5, passRate: 0.62, redZoneTDPct: 0.62, yardsPerGameOff: 380, yardsPerGameDef: 350, pointsPerGameOff: 25.8, pointsPerGameDef: 24.0 },
  CLE: { offEPA: -0.04, defEPA: -0.02, paceSec: 28.3, passRate: 0.57, redZoneTDPct: 0.52, yardsPerGameOff: 320, yardsPerGameDef: 330, pointsPerGameOff: 19.2, pointsPerGameDef: 21.5 },
  DAL: { offEPA: 0.05, defEPA: 0.03, paceSec: 27.0, passRate: 0.59, redZoneTDPct: 0.58, yardsPerGameOff: 360, yardsPerGameDef: 360, pointsPerGameOff: 23.5, pointsPerGameDef: 24.6 },
  DEN: { offEPA: 0.06, defEPA: -0.05, paceSec: 27.4, passRate: 0.58, redZoneTDPct: 0.59, yardsPerGameOff: 350, yardsPerGameDef: 315, pointsPerGameOff: 24.3, pointsPerGameDef: 19.8 },
  DET: { offEPA: 0.18, defEPA: 0.02, paceSec: 26.0, passRate: 0.55, redZoneTDPct: 0.68, yardsPerGameOff: 420, yardsPerGameDef: 340, pointsPerGameOff: 30.1, pointsPerGameDef: 22.5 },
  GB:  { offEPA: 0.09, defEPA: -0.03, paceSec: 26.8, passRate: 0.58, redZoneTDPct: 0.60, yardsPerGameOff: 370, yardsPerGameDef: 320, pointsPerGameOff: 25.0, pointsPerGameDef: 20.5 },
  HOU: { offEPA: 0.07, defEPA: -0.02, paceSec: 27.1, passRate: 0.59, redZoneTDPct: 0.59, yardsPerGameOff: 365, yardsPerGameDef: 325, pointsPerGameOff: 24.2, pointsPerGameDef: 20.8 },
  IND: { offEPA: 0.02, defEPA: 0.04, paceSec: 27.5, passRate: 0.56, redZoneTDPct: 0.55, yardsPerGameOff: 345, yardsPerGameDef: 355, pointsPerGameOff: 22.0, pointsPerGameDef: 24.3 },
  JAX: { offEPA: -0.03, defEPA: 0.07, paceSec: 28.0, passRate: 0.59, redZoneTDPct: 0.52, yardsPerGameOff: 325, yardsPerGameDef: 375, pointsPerGameOff: 19.8, pointsPerGameDef: 27.5 },
  KC:  { offEPA: 0.14, defEPA: -0.07, paceSec: 25.7, passRate: 0.60, redZoneTDPct: 0.65, yardsPerGameOff: 380, yardsPerGameDef: 295, pointsPerGameOff: 28.0, pointsPerGameDef: 17.5 },
  LV:  { offEPA: -0.05, defEPA: 0.06, paceSec: 28.2, passRate: 0.58, redZoneTDPct: 0.50, yardsPerGameOff: 315, yardsPerGameDef: 370, pointsPerGameOff: 18.5, pointsPerGameDef: 27.0 },
  LAC: { offEPA: 0.04, defEPA: -0.01, paceSec: 27.2, passRate: 0.58, redZoneTDPct: 0.57, yardsPerGameOff: 355, yardsPerGameDef: 335, pointsPerGameOff: 23.0, pointsPerGameDef: 21.8 },
  LAR: { offEPA: 0.08, defEPA: 0.02, paceSec: 26.5, passRate: 0.60, redZoneTDPct: 0.60, yardsPerGameOff: 370, yardsPerGameDef: 350, pointsPerGameOff: 25.5, pointsPerGameDef: 23.5 },
  MIA: { offEPA: 0.06, defEPA: 0.03, paceSec: 25.5, passRate: 0.60, redZoneTDPct: 0.58, yardsPerGameOff: 380, yardsPerGameDef: 355, pointsPerGameOff: 24.0, pointsPerGameDef: 24.2 },
  MIN: { offEPA: 0.08, defEPA: -0.04, paceSec: 27.0, passRate: 0.60, redZoneTDPct: 0.59, yardsPerGameOff: 360, yardsPerGameDef: 320, pointsPerGameOff: 24.5, pointsPerGameDef: 20.0 },
  NE:  { offEPA: -0.08, defEPA: 0.05, paceSec: 28.5, passRate: 0.55, redZoneTDPct: 0.48, yardsPerGameOff: 295, yardsPerGameDef: 365, pointsPerGameOff: 16.5, pointsPerGameDef: 26.5 },
  NO:  { offEPA: 0.00, defEPA: 0.01, paceSec: 27.5, passRate: 0.58, redZoneTDPct: 0.55, yardsPerGameOff: 340, yardsPerGameDef: 340, pointsPerGameOff: 21.5, pointsPerGameDef: 23.5 },
  NYG: { offEPA: -0.05, defEPA: 0.04, paceSec: 28.0, passRate: 0.57, redZoneTDPct: 0.50, yardsPerGameOff: 310, yardsPerGameDef: 360, pointsPerGameOff: 18.0, pointsPerGameDef: 25.5 },
  NYJ: { offEPA: -0.02, defEPA: -0.05, paceSec: 27.5, passRate: 0.58, redZoneTDPct: 0.52, yardsPerGameOff: 330, yardsPerGameDef: 310, pointsPerGameOff: 20.5, pointsPerGameDef: 20.0 },
  PHI: { offEPA: 0.12, defEPA: -0.06, paceSec: 27.0, passRate: 0.55, redZoneTDPct: 0.63, yardsPerGameOff: 385, yardsPerGameDef: 305, pointsPerGameOff: 26.8, pointsPerGameDef: 19.0 },
  PIT: { offEPA: 0.01, defEPA: -0.04, paceSec: 28.2, passRate: 0.55, redZoneTDPct: 0.54, yardsPerGameOff: 325, yardsPerGameDef: 320, pointsPerGameOff: 20.8, pointsPerGameDef: 20.5 },
  SF:  { offEPA: 0.13, defEPA: -0.05, paceSec: 26.5, passRate: 0.56, redZoneTDPct: 0.64, yardsPerGameOff: 395, yardsPerGameDef: 315, pointsPerGameOff: 27.5, pointsPerGameDef: 19.8 },
  SEA: { offEPA: 0.05, defEPA: 0.01, paceSec: 27.0, passRate: 0.58, redZoneTDPct: 0.57, yardsPerGameOff: 360, yardsPerGameDef: 345, pointsPerGameOff: 23.5, pointsPerGameDef: 22.5 },
  TB:  { offEPA: 0.04, defEPA: 0.00, paceSec: 27.5, passRate: 0.60, redZoneTDPct: 0.56, yardsPerGameOff: 350, yardsPerGameDef: 335, pointsPerGameOff: 22.5, pointsPerGameDef: 22.0 },
  TEN: { offEPA: -0.06, defEPA: 0.05, paceSec: 28.5, passRate: 0.56, redZoneTDPct: 0.50, yardsPerGameOff: 305, yardsPerGameDef: 370, pointsPerGameOff: 17.0, pointsPerGameDef: 27.0 },
  WAS: { offEPA: 0.07, defEPA: 0.06, paceSec: 26.5, passRate: 0.59, redZoneTDPct: 0.60, yardsPerGameOff: 370, yardsPerGameDef: 380, pointsPerGameOff: 24.5, pointsPerGameDef: 27.0 },
};

export function getNFLTeamRating(abbrev: string): NFLTeamRating {
  return NFL_TEAM_RATINGS[abbrev.toUpperCase()] ?? {
    offEPA: 0, defEPA: 0, paceSec: 27.5, passRate: 0.58, redZoneTDPct: 0.55,
    yardsPerGameOff: 340, yardsPerGameDef: 340, pointsPerGameOff: 22.0, pointsPerGameDef: 22.0,
  };
}
