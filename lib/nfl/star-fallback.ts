// ──────────────────────────────────────────────────────────
// NFL_STAR_FALLBACK — top players per team with 2024 season averages.
// Used when live Odds API props are empty. Auto-filtered by team
// playing today + injury status.
// ──────────────────────────────────────────────────────────

import type { NFLPosition } from "./position-defense";

export interface NFLStarPlayer {
  playerName: string;
  team: string;
  position: NFLPosition;
  // Per-game averages
  passYds?: number;
  passTds?: number;
  passAttempts?: number;
  rushYds?: number;
  rushAttempts?: number;
  receptions?: number;
  receivingYds?: number;
}

// 2024-25 season averages (regular season).
// Includes top fantasy/betting names — covers most prop markets.
export const NFL_STAR_FALLBACK: NFLStarPlayer[] = [
  // ── QBs (top 12 by passing yards/TDs) ──
  { playerName: "Patrick Mahomes",    team: "KC",  position: "QB", passYds: 264, passTds: 1.8, passAttempts: 35 },
  { playerName: "Josh Allen",          team: "BUF", position: "QB", passYds: 252, passTds: 2.1, passAttempts: 33, rushYds: 31, rushAttempts: 7 },
  { playerName: "Lamar Jackson",       team: "BAL", position: "QB", passYds: 240, passTds: 2.2, passAttempts: 30, rushYds: 55, rushAttempts: 8 },
  { playerName: "Joe Burrow",          team: "CIN", position: "QB", passYds: 290, passTds: 2.5, passAttempts: 39 },
  { playerName: "Jared Goff",          team: "DET", position: "QB", passYds: 273, passTds: 2.0, passAttempts: 36 },
  { playerName: "Jalen Hurts",         team: "PHI", position: "QB", passYds: 220, passTds: 1.5, passAttempts: 28, rushYds: 38, rushAttempts: 9 },
  { playerName: "Brock Purdy",         team: "SF",  position: "QB", passYds: 248, passTds: 1.6, passAttempts: 32 },
  { playerName: "C.J. Stroud",         team: "HOU", position: "QB", passYds: 245, passTds: 1.5, passAttempts: 34 },
  { playerName: "Justin Herbert",      team: "LAC", position: "QB", passYds: 235, passTds: 1.5, passAttempts: 33 },
  { playerName: "Bo Nix",              team: "DEN", position: "QB", passYds: 230, passTds: 1.7, passAttempts: 32 },
  { playerName: "Caleb Williams",      team: "CHI", position: "QB", passYds: 215, passTds: 1.3, passAttempts: 31 },
  { playerName: "Baker Mayfield",      team: "TB",  position: "QB", passYds: 265, passTds: 2.0, passAttempts: 35 },
  { playerName: "Kyler Murray",        team: "ARI", position: "QB", passYds: 235, passTds: 1.6, passAttempts: 32, rushYds: 28, rushAttempts: 6 },
  { playerName: "Sam Darnold",         team: "SEA", position: "QB", passYds: 240, passTds: 1.8, passAttempts: 33 },
  { playerName: "Geno Smith",          team: "LV",  position: "QB", passYds: 245, passTds: 1.5, passAttempts: 35 },

  // ── RBs (top 12 by yards) ──
  { playerName: "Saquon Barkley",      team: "PHI", position: "RB", rushYds: 124, rushAttempts: 22, receptions: 2, receivingYds: 18 },
  { playerName: "Derrick Henry",       team: "BAL", position: "RB", rushYds: 115, rushAttempts: 19, receptions: 1, receivingYds: 8 },
  { playerName: "Jahmyr Gibbs",        team: "DET", position: "RB", rushYds: 80, rushAttempts: 15, receptions: 3, receivingYds: 26 },
  { playerName: "Bijan Robinson",      team: "ATL", position: "RB", rushYds: 90, rushAttempts: 17, receptions: 4, receivingYds: 32 },
  { playerName: "Josh Jacobs",         team: "GB",  position: "RB", rushYds: 88, rushAttempts: 18, receptions: 2, receivingYds: 18 },
  { playerName: "James Cook",          team: "BUF", position: "RB", rushYds: 73, rushAttempts: 14, receptions: 2, receivingYds: 16 },
  { playerName: "Kyren Williams",      team: "LAR", position: "RB", rushYds: 80, rushAttempts: 17, receptions: 3, receivingYds: 22 },
  { playerName: "Joe Mixon",           team: "HOU", position: "RB", rushYds: 75, rushAttempts: 17, receptions: 2, receivingYds: 18 },
  { playerName: "Aaron Jones",         team: "MIN", position: "RB", rushYds: 70, rushAttempts: 15, receptions: 3, receivingYds: 24 },
  { playerName: "Chuba Hubbard",       team: "CAR", position: "RB", rushYds: 75, rushAttempts: 16, receptions: 2, receivingYds: 16 },
  { playerName: "James Conner",        team: "ARI", position: "RB", rushYds: 76, rushAttempts: 16, receptions: 3, receivingYds: 22 },
  { playerName: "Alvin Kamara",        team: "NO",  position: "RB", rushYds: 65, rushAttempts: 13, receptions: 5, receivingYds: 38 },
  { playerName: "Bucky Irving",        team: "TB",  position: "RB", rushYds: 70, rushAttempts: 14, receptions: 3, receivingYds: 22 },

  // ── WRs (top 15) ──
  { playerName: "Ja'Marr Chase",       team: "CIN", position: "WR", receptions: 8, receivingYds: 110 },
  { playerName: "Justin Jefferson",    team: "MIN", position: "WR", receptions: 7, receivingYds: 105 },
  { playerName: "Amon-Ra St. Brown",   team: "DET", position: "WR", receptions: 7, receivingYds: 88 },
  { playerName: "Puka Nacua",          team: "LAR", position: "WR", receptions: 6, receivingYds: 95 },
  { playerName: "Brian Thomas Jr.",    team: "JAX", position: "WR", receptions: 5, receivingYds: 85 },
  { playerName: "Drake London",        team: "ATL", position: "WR", receptions: 6, receivingYds: 80 },
  { playerName: "Nico Collins",        team: "HOU", position: "WR", receptions: 5, receivingYds: 85 },
  { playerName: "Garrett Wilson",      team: "NYJ", position: "WR", receptions: 6, receivingYds: 75 },
  { playerName: "Mike Evans",          team: "TB",  position: "WR", receptions: 5, receivingYds: 80 },
  { playerName: "A.J. Brown",          team: "PHI", position: "WR", receptions: 5, receivingYds: 78 },
  { playerName: "DeVonta Smith",       team: "PHI", position: "WR", receptions: 5, receivingYds: 65 },
  { playerName: "DK Metcalf",          team: "SEA", position: "WR", receptions: 4, receivingYds: 70 },
  { playerName: "CeeDee Lamb",         team: "DAL", position: "WR", receptions: 6, receivingYds: 88 },
  { playerName: "Cooper Kupp",         team: "LAR", position: "WR", receptions: 5, receivingYds: 65 },
  { playerName: "Davante Adams",       team: "NYJ", position: "WR", receptions: 6, receivingYds: 75 },
  { playerName: "Tee Higgins",         team: "CIN", position: "WR", receptions: 5, receivingYds: 70 },
  { playerName: "Jaxon Smith-Njigba",  team: "SEA", position: "WR", receptions: 5, receivingYds: 70 },
  { playerName: "Chris Olave",         team: "NO",  position: "WR", receptions: 5, receivingYds: 65 },
  { playerName: "Stefon Diggs",        team: "NE",  position: "WR", receptions: 5, receivingYds: 60 },
  { playerName: "Terry McLaurin",      team: "WAS", position: "WR", receptions: 5, receivingYds: 72 },
  { playerName: "DJ Moore",            team: "CHI", position: "WR", receptions: 5, receivingYds: 60 },

  // ── TEs (top 8) ──
  { playerName: "Travis Kelce",        team: "KC",  position: "TE", receptions: 6, receivingYds: 60 },
  { playerName: "Trey McBride",        team: "ARI", position: "TE", receptions: 7, receivingYds: 75 },
  { playerName: "George Kittle",       team: "SF",  position: "TE", receptions: 4, receivingYds: 65 },
  { playerName: "Brock Bowers",        team: "LV",  position: "TE", receptions: 6, receivingYds: 70 },
  { playerName: "Sam LaPorta",         team: "DET", position: "TE", receptions: 4, receivingYds: 50 },
  { playerName: "Mark Andrews",        team: "BAL", position: "TE", receptions: 4, receivingYds: 55 },
  { playerName: "T.J. Hockenson",      team: "MIN", position: "TE", receptions: 5, receivingYds: 60 },
  { playerName: "Dalton Kincaid",      team: "BUF", position: "TE", receptions: 4, receivingYds: 45 },
];

export function getStarsForTeams(teamAbbrevs: Set<string>): NFLStarPlayer[] {
  return NFL_STAR_FALLBACK.filter((p) => teamAbbrevs.has(p.team.toUpperCase()));
}
