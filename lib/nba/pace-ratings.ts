// ──────────────────────────────────────────────────────────
// NBA Team Pace + Offensive / Defensive Ratings (2024-25 baselines)
//
// Pace = possessions per 48 min. League avg ~99.
// Off Rating = points per 100 possessions. League avg ~115.
// Def Rating = points allowed per 100 possessions. Lower is better.
//
// Pace mismatch matters for totals: fast team + slow team averages
// their paces, but high-pace × weak defense skews totals high.
// ──────────────────────────────────────────────────────────

export interface TeamRating {
  pace: number;         // possessions / 48
  offRating: number;    // pts / 100 poss
  defRating: number;    // pts allowed / 100 poss
  netRating: number;    // off - def
}

// 2024-25 season baselines (approximate, regularly updated in-season)
export const NBA_TEAM_RATINGS: Record<string, TeamRating> = {
  ATL: { pace: 102.1, offRating: 114.8, defRating: 115.5, netRating: -0.7 },
  BOS: { pace: 98.3, offRating: 121.2, defRating: 110.8, netRating: 10.4 },
  BKN: { pace: 99.7, offRating: 110.2, defRating: 117.1, netRating: -6.9 },
  CHA: { pace: 96.8, offRating: 107.5, defRating: 118.2, netRating: -10.7 },
  CHI: { pace: 98.5, offRating: 112.1, defRating: 114.2, netRating: -2.1 },
  CLE: { pace: 98.8, offRating: 119.5, defRating: 111.2, netRating: 8.3 },
  DAL: { pace: 99.2, offRating: 115.8, defRating: 113.1, netRating: 2.7 },
  DEN: { pace: 97.5, offRating: 117.1, defRating: 113.8, netRating: 3.3 },
  DET: { pace: 99.1, offRating: 112.3, defRating: 114.5, netRating: -2.2 },
  GSW: { pace: 101.3, offRating: 114.2, defRating: 113.8, netRating: 0.4 },
  HOU: { pace: 98.4, offRating: 114.5, defRating: 111.2, netRating: 3.3 },
  IND: { pace: 103.5, offRating: 118.2, defRating: 115.1, netRating: 3.1 },
  LAC: { pace: 99.5, offRating: 116.3, defRating: 112.2, netRating: 4.1 },
  LAL: { pace: 99.8, offRating: 115.2, defRating: 114.1, netRating: 1.1 },
  MEM: { pace: 103.2, offRating: 113.5, defRating: 112.8, netRating: 0.7 },
  MIA: { pace: 98.1, offRating: 113.5, defRating: 113.2, netRating: 0.3 },
  MIL: { pace: 99.8, offRating: 117.2, defRating: 113.5, netRating: 3.7 },
  MIN: { pace: 98.5, offRating: 113.8, defRating: 110.5, netRating: 3.3 },
  NOP: { pace: 99.8, offRating: 112.5, defRating: 115.3, netRating: -2.8 },
  NYK: { pace: 99.2, offRating: 117.5, defRating: 113.2, netRating: 4.3 },
  OKC: { pace: 99.5, offRating: 119.1, defRating: 107.8, netRating: 11.3 }, // elite defense
  ORL: { pace: 97.8, offRating: 109.8, defRating: 112.5, netRating: -2.7 },
  PHI: { pace: 98.5, offRating: 114.8, defRating: 114.2, netRating: 0.6 },
  PHX: { pace: 99.2, offRating: 116.5, defRating: 114.5, netRating: 2.0 },
  POR: { pace: 100.1, offRating: 110.5, defRating: 117.2, netRating: -6.7 },
  SAC: { pace: 100.8, offRating: 114.3, defRating: 114.8, netRating: -0.5 },
  SAS: { pace: 99.5, offRating: 113.2, defRating: 114.8, netRating: -1.6 },
  TOR: { pace: 100.5, offRating: 112.1, defRating: 115.2, netRating: -3.1 },
  UTA: { pace: 99.8, offRating: 112.5, defRating: 117.1, netRating: -4.6 },
  WAS: { pace: 100.2, offRating: 110.1, defRating: 118.5, netRating: -8.4 },
};

export function getTeamRating(abbrev: string): TeamRating {
  return NBA_TEAM_RATINGS[(abbrev || "").toUpperCase()] ?? {
    pace: 99.0, offRating: 114.0, defRating: 114.0, netRating: 0,
  };
}

/**
 * Compute projected total for tonight using pace + ratings.
 *
 * Formula: combined pace × avg (home offRating against away defRating,
 * away offRating against home defRating) / 100 × 2 teams.
 *
 * Returns { projectedTotal, paceNote, factors }.
 */
export function projectGameTotal(homeAbbrev: string, awayAbbrev: string): {
  projectedTotal: number;
  expectedPace: number;
  paceNote: string;
  factors: string[];
} {
  const home = getTeamRating(homeAbbrev);
  const away = getTeamRating(awayAbbrev);
  const factors: string[] = [];

  // Avg pace of both teams is the best single predictor of possessions
  const expectedPace = (home.pace + away.pace) / 2;

  // Each team's expected points = opponent's DefRating tilted by own OffRating
  const homeExpPoints = ((home.offRating + away.defRating) / 2) * (expectedPace / 100);
  const awayExpPoints = ((away.offRating + home.defRating) / 2) * (expectedPace / 100);
  const projectedTotal = homeExpPoints + awayExpPoints;

  // Pace mismatch note — noteworthy when ≥4 pace gap
  const paceDiff = Math.abs(home.pace - away.pace);
  let paceNote = "";
  if (paceDiff >= 4) {
    const faster = home.pace > away.pace ? homeAbbrev : awayAbbrev;
    paceNote = `Pace mismatch: ${faster} runs ${paceDiff.toFixed(1)} possessions faster — expect run-and-gun`;
    factors.push(paceNote);
  }

  // Call out elite defenses vs elite offenses
  if (home.defRating <= 110 && away.offRating >= 118) factors.push(`${homeAbbrev} elite defense (${home.defRating}) vs ${awayAbbrev} elite offense — expect half-court slowdown`);
  if (away.defRating <= 110 && home.offRating >= 118) factors.push(`${awayAbbrev} elite defense vs ${homeAbbrev} elite offense`);

  return {
    projectedTotal: Math.round(projectedTotal * 10) / 10,
    expectedPace: Math.round(expectedPace * 10) / 10,
    paceNote,
    factors,
  };
}
