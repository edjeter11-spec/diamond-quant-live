// ──────────────────────────────────────────────────────────
// PARLAY CORRELATION ENGINE
// Detects correlated picks that boost/hurt parlay value
// "Booker Over Points + Suns ML" = positive correlation (both win together)
// "Booker Over Points + Opponent ML" = negative correlation (conflict)
// ──────────────────────────────────────────────────────────

export interface CorrelationResult {
  type: "positive" | "negative" | "neutral";
  strength: number;     // 0-1 (0 = independent, 1 = perfectly correlated)
  explanation: string;
  boostPct: number;     // positive = parlay is better than independent odds suggest
}

interface ParlayLeg {
  game: string;       // "Raptors @ Cavaliers"
  pick: string;       // "Cavaliers ML" or "Booker Over 25.5 Points"
  market: string;     // "moneyline", "total", "spread", "player_points", etc.
  team?: string;
  playerName?: string;
  side?: string;       // "over", "under", "home", "away"
}

// ── Known Correlation Patterns ──
const CORRELATIONS = {
  // Same-game correlations
  TEAM_ML_PLAYER_OVER: { type: "positive" as const, strength: 0.35, boost: 8, desc: "Team wins → star players score more (more competitive minutes)" },
  TEAM_ML_OPPONENT_UNDER: { type: "positive" as const, strength: 0.25, boost: 5, desc: "Team wins → opponent stars score less (garbage time, blowouts)" },
  OVER_TOTAL_PLAYER_OVER: { type: "positive" as const, strength: 0.40, boost: 10, desc: "High-scoring game → more points for everyone" },
  UNDER_TOTAL_PLAYER_UNDER: { type: "positive" as const, strength: 0.35, boost: 8, desc: "Low-scoring game → fewer individual stats" },
  TEAM_ML_PLAYER_UNDER_SAME: { type: "negative" as const, strength: 0.30, boost: -7, desc: "Conflict: picking team to win but their player to underperform" },
  PLAYER_OVER_PLAYER_OVER_SAME_TEAM: { type: "negative" as const, strength: 0.15, boost: -3, desc: "Two players on same team both going over — minutes/touches compete" },
  PLAYER_OVER_PLAYER_OVER_OPP_TEAMS: { type: "neutral" as const, strength: 0.05, boost: 0, desc: "Players on opposing teams are roughly independent" },
};

// ── Extract game info from pick string ──
function parseLeg(leg: ParlayLeg): {
  gameKey: string;
  isML: boolean;
  isTotal: boolean;
  isProp: boolean;
  isOver: boolean;
  teamPicked?: string;
} {
  const pick = leg.pick.toLowerCase();
  const isML = leg.market === "moneyline" || pick.includes(" ml");
  const isTotal = leg.market === "total" || pick.includes("over") || pick.includes("under");
  const isProp = leg.market?.startsWith("player_") || !!leg.playerName;
  const isOver = pick.includes("over") || leg.side === "over";

  // Extract team from ML pick: "Cavaliers ML" → "cavaliers"
  let teamPicked: string | undefined;
  if (isML) {
    teamPicked = pick.replace(/\s*ml\s*/i, "").trim();
  }

  return {
    gameKey: leg.game.toLowerCase(),
    isML, isTotal, isProp, isOver, teamPicked,
  };
}

// ── Analyze correlation between two legs ──
function analyzePair(legA: ParlayLeg, legB: ParlayLeg): CorrelationResult | null {
  const a = parseLeg(legA);
  const b = parseLeg(legB);

  // Different games = mostly independent
  if (a.gameKey !== b.gameKey) {
    return { type: "neutral", strength: 0.02, explanation: "Different games — nearly independent", boostPct: 0 };
  }

  // Same game correlations:

  // 1. Team ML + Player Over (same team) = POSITIVE
  if (a.isML && b.isProp && b.isOver) {
    const teamInPick = a.teamPicked ?? "";
    const playerTeam = (legB.team ?? legB.game.split("@")[1] ?? "").toLowerCase().trim();
    if (playerTeam.includes(teamInPick) || teamInPick.includes(playerTeam)) {
      return { ...CORRELATIONS.TEAM_ML_PLAYER_OVER, explanation: `${legA.pick} + ${legB.pick}: ${CORRELATIONS.TEAM_ML_PLAYER_OVER.desc}`, boostPct: CORRELATIONS.TEAM_ML_PLAYER_OVER.boost };
    }
  }
  if (b.isML && a.isProp && a.isOver) {
    return analyzePair(legB, legA); // swap and retry
  }

  // 2. Game Over + Player Over = POSITIVE
  if (a.isTotal && a.isOver && b.isProp && b.isOver) {
    return { ...CORRELATIONS.OVER_TOTAL_PLAYER_OVER, explanation: `Game over + player over: ${CORRELATIONS.OVER_TOTAL_PLAYER_OVER.desc}`, boostPct: CORRELATIONS.OVER_TOTAL_PLAYER_OVER.boost };
  }
  if (b.isTotal && b.isOver && a.isProp && a.isOver) {
    return { ...CORRELATIONS.OVER_TOTAL_PLAYER_OVER, explanation: `Game over + player over: ${CORRELATIONS.OVER_TOTAL_PLAYER_OVER.desc}`, boostPct: CORRELATIONS.OVER_TOTAL_PLAYER_OVER.boost };
  }

  // 3. Game Under + Player Under = POSITIVE
  if (a.isTotal && !a.isOver && b.isProp && !b.isOver) {
    return { ...CORRELATIONS.UNDER_TOTAL_PLAYER_UNDER, explanation: `Game under + player under: ${CORRELATIONS.UNDER_TOTAL_PLAYER_UNDER.desc}`, boostPct: CORRELATIONS.UNDER_TOTAL_PLAYER_UNDER.boost };
  }

  // 4. Two player overs on same team = SLIGHT NEGATIVE
  if (a.isProp && b.isProp && a.isOver && b.isOver) {
    const teamA = (legA.team ?? "").toLowerCase();
    const teamB = (legB.team ?? "").toLowerCase();
    if (teamA && teamB && teamA === teamB) {
      return { ...CORRELATIONS.PLAYER_OVER_PLAYER_OVER_SAME_TEAM, explanation: `Both ${legA.playerName} and ${legB.playerName} over on same team — usage conflict`, boostPct: CORRELATIONS.PLAYER_OVER_PLAYER_OVER_SAME_TEAM.boost };
    }
  }

  return null;
}

// ── Analyze full parlay for correlations ──
export function analyzeParlay(legs: ParlayLeg[]): {
  correlations: CorrelationResult[];
  overallBoost: number;    // net % boost/penalty
  recommendation: string;  // "Strong correlated parlay" / "Warning: conflicting legs"
  score: number;           // -100 to +100
} {
  const correlations: CorrelationResult[] = [];

  // Check all pairs
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const result = analyzePair(legs[i], legs[j]);
      if (result && result.type !== "neutral") {
        correlations.push(result);
      }
    }
  }

  const overallBoost = correlations.reduce((s, c) => s + c.boostPct, 0);
  const positiveCount = correlations.filter(c => c.type === "positive").length;
  const negativeCount = correlations.filter(c => c.type === "negative").length;

  let recommendation: string;
  let score: number;

  if (positiveCount > 0 && negativeCount === 0) {
    recommendation = `Strong correlated parlay — ${positiveCount} synergies detected`;
    score = Math.min(100, overallBoost * 5);
  } else if (negativeCount > 0 && positiveCount === 0) {
    recommendation = `Warning: ${negativeCount} conflicting legs reduce win probability`;
    score = Math.max(-100, overallBoost * 5);
  } else if (positiveCount > 0 && negativeCount > 0) {
    recommendation = `Mixed: ${positiveCount} synergies but ${negativeCount} conflicts`;
    score = overallBoost * 3;
  } else {
    recommendation = "Independent legs — standard parlay math applies";
    score = 0;
  }

  return { correlations, overallBoost, recommendation, score };
}
