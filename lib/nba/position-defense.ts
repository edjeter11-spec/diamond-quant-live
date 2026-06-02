// ──────────────────────────────────────────────────────────
// NBA Per-Position Defensive Ratings
//
// Team's defensive efficiency vs specific positions (PG/SG/SF/PF/C).
// Higher number = team allows MORE production at that position (worse defense).
// Scale: 0-100, where 50 = league average. 70+ = top-5 worst, 30- = top-5 best.
//
// Source: NBA Stats API "defense vs position" data. Updated periodically.
// Falls back to team-wide def rating when position is unknown.
//
// Use case: a PG-heavy stat line (assists, points) against a team that's
// elite vs PGs should lean UNDER. Same prop vs a team weak at PG defense
// leans OVER.
// ──────────────────────────────────────────────────────────

export type Position = "PG" | "SG" | "SF" | "PF" | "C";

interface PositionDefense {
  PG: number; // 0-100, higher = team allows MORE production at PG
  SG: number;
  SF: number;
  PF: number;
  C: number;
}

// 2024-25 season per-position defensive efficiency (approximate, updated periodically)
// 50 = league avg. Sources: nba.com/stats > teams > defense > shots allowed by pos
export const TEAM_POS_DEFENSE: Record<string, PositionDefense> = {
  ATL: { PG: 62, SG: 58, SF: 55, PF: 53, C: 60 },
  BOS: { PG: 38, SG: 42, SF: 35, PF: 38, C: 40 },
  BKN: { PG: 65, SG: 60, SF: 58, PF: 62, C: 65 },
  CHA: { PG: 70, SG: 68, SF: 65, PF: 62, C: 68 },
  CHI: { PG: 55, SG: 52, SF: 58, PF: 55, C: 58 },
  CLE: { PG: 42, SG: 40, SF: 38, PF: 40, C: 35 }, // elite interior, good guard D
  DAL: { PG: 52, SG: 50, SF: 48, PF: 50, C: 52 },
  DEN: { PG: 50, SG: 52, SF: 48, PF: 52, C: 38 }, // Jokic anchor
  DET: { PG: 60, SG: 58, SF: 55, PF: 55, C: 58 },
  GSW: { PG: 55, SG: 52, SF: 50, PF: 50, C: 55 },
  HOU: { PG: 42, SG: 40, SF: 42, PF: 45, C: 45 },
  IND: { PG: 60, SG: 58, SF: 55, PF: 55, C: 60 }, // up-tempo defense
  LAC: { PG: 45, SG: 45, SF: 42, PF: 45, C: 50 },
  LAL: { PG: 50, SG: 52, SF: 50, PF: 50, C: 45 }, // AD anchors
  MEM: { PG: 48, SG: 48, SF: 45, PF: 48, C: 50 },
  MIA: { PG: 48, SG: 48, SF: 45, PF: 45, C: 50 },
  MIL: { PG: 52, SG: 50, SF: 48, PF: 45, C: 45 },
  MIN: { PG: 38, SG: 42, SF: 40, PF: 38, C: 35 }, // Gobert + Edwards
  NOP: { PG: 55, SG: 55, SF: 52, PF: 55, C: 55 },
  NYK: { PG: 45, SG: 45, SF: 45, PF: 48, C: 45 },
  OKC: { PG: 35, SG: 38, SF: 35, PF: 38, C: 40 }, // top defense
  ORL: { PG: 42, SG: 42, SF: 40, PF: 42, C: 42 },
  PHI: { PG: 55, SG: 50, SF: 48, PF: 48, C: 40 }, // Embiid C anchor
  PHX: { PG: 58, SG: 55, SF: 55, PF: 55, C: 60 },
  POR: { PG: 65, SG: 62, SF: 60, PF: 62, C: 60 },
  SAC: { PG: 60, SG: 58, SF: 55, PF: 55, C: 55 },
  SAS: { PG: 58, SG: 55, SF: 55, PF: 55, C: 45 }, // Wemby anchor
  TOR: { PG: 60, SG: 58, SF: 55, PF: 55, C: 58 },
  UTA: { PG: 65, SG: 60, SF: 58, PF: 58, C: 60 },
  WAS: { PG: 68, SG: 65, SF: 62, PF: 62, C: 65 },
};

// Player → position lookup. Curated list of top players. Falls back to "SF"
// (a neutral wing position) when player is unknown. Updated periodically.
export const PLAYER_POSITION: Record<string, Position> = {
  // Point Guards
  "shai gilgeous-alexander": "PG",
  "luka doncic": "PG",
  "trae young": "PG",
  "ja morant": "PG",
  "jalen brunson": "PG",
  "cade cunningham": "PG",
  "tyrese haliburton": "PG",
  "lamelo ball": "PG",
  "damian lillard": "PG",
  "stephen curry": "PG",
  "darius garland": "PG",
  "de'aaron fox": "PG",
  "james harden": "PG",
  "kyrie irving": "PG",
  "russell westbrook": "PG",
  "chris paul": "PG",
  "mike conley": "PG",
  // Shooting Guards
  "donovan mitchell": "SG",
  "devin booker": "SG",
  "anthony edwards": "SG",
  "jaylen brown": "SG",
  "tyler herro": "SG",
  "tyrese maxey": "SG",
  "desmond bane": "SG",
  "klay thompson": "SG",
  "cj mccollum": "SG",
  "zach lavine": "SG",
  "bradley beal": "SG",
  // Small Forwards
  "lebron james": "SF",
  "jayson tatum": "SF",
  "kawhi leonard": "SF",
  "paul george": "SF",
  "scottie barnes": "SF",
  "jimmy butler": "SF",
  "mikal bridges": "SF",
  "khris middleton": "SF",
  "kevin durant": "SF",
  "demar derozan": "SF",
  "brandon ingram": "SF",
  "rj barrett": "SF",
  // Power Forwards
  "giannis antetokounmpo": "PF",
  "anthony davis": "PF",
  "paolo banchero": "PF",
  "zion williamson": "PF",
  "lauri markkanen": "PF",
  "evan mobley": "PF",
  "pascal siakam": "PF",
  "jaren jackson jr.": "PF",
  "kristaps porzingis": "PF",
  "julius randle": "PF",
  // Centers
  "nikola jokic": "C",
  "joel embiid": "C",
  "victor wembanyama": "C",
  "domantas sabonis": "C",
  "karl-anthony towns": "C",
  "bam adebayo": "C",
  "rudy gobert": "C",
  "myles turner": "C",
  "alperen sengun": "C",
  "ivica zubac": "C",
  "jarrett allen": "C",
  "nikola vucevic": "C",
};

const LEAGUE_AVG = 50;

// Returns position-specific defensive number (0-100). Lower = better defense.
export function getTeamDefenseVsPosition(teamAbbrev: string, position: Position): number {
  const team = TEAM_POS_DEFENSE[teamAbbrev.toUpperCase()];
  return team?.[position] ?? LEAGUE_AVG;
}

// Resolve player → position. Falls back to SF (neutral wing) if unknown.
export function getPlayerPosition(playerName: string): Position {
  return PLAYER_POSITION[playerName.toLowerCase()] ?? "SF";
}

// Convert a 0-100 defensive number into the "opponentDefRank" 1-30 scale
// the existing projector expects. Lower defNum = better defense = lower rank (1).
// Higher defNum = worse defense = higher rank (30).
export function defenseToRank(defNum: number): number {
  // Clamp + linear map: 30-70 → 1-30
  const clamped = Math.max(30, Math.min(70, defNum));
  return Math.round(((clamped - 30) / 40) * 29 + 1);
}

// Convenience: resolve player+opponent → position-specific def rank (1-30).
export function getPositionalDefRank(playerName: string, opponentAbbrev: string): number {
  const pos = getPlayerPosition(playerName);
  const defNum = getTeamDefenseVsPosition(opponentAbbrev, pos);
  return defenseToRank(defNum);
}
