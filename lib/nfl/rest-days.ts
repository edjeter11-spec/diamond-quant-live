// ──────────────────────────────────────────────────────────
// NFL Rest Days — short week vs bye week tracking.
// Edge for prop projections: tired starters underperform.
// ──────────────────────────────────────────────────────────

export interface NFLRestState {
  daysOfRest: number;        // since last game
  isShortWeek: boolean;      // Thu/Fri after Sun = <6 days
  isPostBye: boolean;        // 13+ days
  isWell: boolean;           // 7+ days
  /** Rest edge in EPA units (positive = well-rested) */
  edge: number;
  factors: string[];
}

export function computeNFLRest(lastGameDate: string | null, gameDate: string): NFLRestState {
  if (!lastGameDate) {
    return { daysOfRest: 7, isShortWeek: false, isPostBye: false, isWell: true, edge: 0, factors: ["No prior game data"] };
  }
  const diffMs = new Date(gameDate).getTime() - new Date(lastGameDate).getTime();
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  const isShortWeek = days <= 5;
  const isPostBye = days >= 13;
  const isWell = days >= 7;

  const factors: string[] = [];
  let edge = 0;

  if (isPostBye) {
    factors.push(`Coming off bye (${days} days rest)`);
    edge += 0.04; // +4% offensive efficiency typically
  } else if (isShortWeek) {
    factors.push(`Short week (${days} days)`);
    edge -= 0.05; // -5% efficiency
  } else if (isWell) {
    factors.push(`Standard week (${days} days)`);
  } else {
    factors.push(`Short rest (${days} days)`);
    edge -= 0.03;
  }

  return { daysOfRest: days, isShortWeek, isPostBye, isWell, edge, factors };
}
