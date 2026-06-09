// ──────────────────────────────────────────────────────────
// NHL Rest + Travel Fatigue
// Back-to-backs are HUGE in NHL (esp. for goalies).
// Cross-country travel matters too (jet lag from PT → ET).
// ──────────────────────────────────────────────────────────

import { getNHLTeam } from "./teams";

export interface NHLFatigueState {
  daysOfRest: number;
  isBackToBack: boolean;     // played last night
  isThirdInFour: boolean;    // 3rd game in 4 nights
  travelHours: number;       // time zone diff from last game
  fatigueEdge: number;       // negative = tired, positive = rested
  factors: string[];
}

export function computeNHLFatigue(
  homeAbbrev: string,
  lastGameDate: string | null,
  lastGameLocation: string | null,
  todayDate: string,
  gamesLastFourNights: number = 1,
): NHLFatigueState {
  const factors: string[] = [];

  if (!lastGameDate) {
    return {
      daysOfRest: 3,
      isBackToBack: false,
      isThirdInFour: false,
      travelHours: 0,
      fatigueEdge: 0,
      factors: ["No prior game data"],
    };
  }

  const diffMs = new Date(todayDate).getTime() - new Date(lastGameDate).getTime();
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  const isB2B = days <= 1;
  const isThird = gamesLastFourNights >= 3;

  // Travel: time zone change between last game and today's home
  let travelHours = 0;
  if (lastGameLocation && homeAbbrev) {
    const lastTeam = getNHLTeam(lastGameLocation);
    const homeTeam = getNHLTeam(homeAbbrev);
    if (lastTeam && homeTeam) {
      travelHours = Math.abs(lastTeam.tzOffset - homeTeam.tzOffset);
    }
  }

  let edge = 0;
  if (isB2B) {
    factors.push("Back-to-back game");
    edge -= 0.08; // 8% downgrade
  }
  if (isThird) {
    factors.push("3rd in 4 nights");
    edge -= 0.05;
  }
  if (travelHours >= 3) {
    factors.push(`Long travel (${travelHours}h time zone change)`);
    edge -= 0.04;
  } else if (travelHours >= 2) {
    factors.push(`Moderate travel (${travelHours}h time zone)`);
    edge -= 0.02;
  }
  if (days >= 3) {
    factors.push(`Well-rested (${days} days off)`);
    edge += 0.03;
  } else if (!isB2B && days === 2) {
    factors.push(`Standard rest (${days} days)`);
  }

  return {
    daysOfRest: days,
    isBackToBack: isB2B,
    isThirdInFour: isThird,
    travelHours,
    fatigueEdge: edge,
    factors,
  };
}
