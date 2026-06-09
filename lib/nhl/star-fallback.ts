// ──────────────────────────────────────────────────────────
// NHL_STAR_FALLBACK — top players per team with 2024-25 averages.
// ──────────────────────────────────────────────────────────

import type { NHLPosition } from "./position-defense";

export interface NHLStarPlayer {
  playerName: string;
  team: string;
  position: NHLPosition;
  goalsPerGame?: number;
  assistsPerGame?: number;
  pointsPerGame?: number;
  shotsPerGame?: number;
  // Goalie stats
  savesPerGame?: number;
  savePct?: number;
}

export const NHL_STAR_FALLBACK: NHLStarPlayer[] = [
  // ── Elite forwards (top scorers) ──
  { playerName: "Connor McDavid",        team: "EDM", position: "F", goalsPerGame: 0.55, assistsPerGame: 1.05, pointsPerGame: 1.60, shotsPerGame: 4.0 },
  { playerName: "Leon Draisaitl",        team: "EDM", position: "F", goalsPerGame: 0.60, assistsPerGame: 0.85, pointsPerGame: 1.45, shotsPerGame: 3.5 },
  { playerName: "Nathan MacKinnon",      team: "COL", position: "F", goalsPerGame: 0.50, assistsPerGame: 0.95, pointsPerGame: 1.45, shotsPerGame: 4.2 },
  { playerName: "Nikita Kucherov",       team: "TBL", position: "F", goalsPerGame: 0.42, assistsPerGame: 1.00, pointsPerGame: 1.42, shotsPerGame: 3.3 },
  { playerName: "Auston Matthews",       team: "TOR", position: "F", goalsPerGame: 0.65, assistsPerGame: 0.50, pointsPerGame: 1.15, shotsPerGame: 4.5 },
  { playerName: "David Pastrnak",        team: "BOS", position: "F", goalsPerGame: 0.50, assistsPerGame: 0.60, pointsPerGame: 1.10, shotsPerGame: 4.0 },
  { playerName: "Mitch Marner",          team: "TOR", position: "F", goalsPerGame: 0.30, assistsPerGame: 0.85, pointsPerGame: 1.15, shotsPerGame: 2.5 },
  { playerName: "Mikko Rantanen",        team: "COL", position: "F", goalsPerGame: 0.45, assistsPerGame: 0.70, pointsPerGame: 1.15, shotsPerGame: 3.4 },
  { playerName: "Jack Hughes",           team: "NJD", position: "F", goalsPerGame: 0.45, assistsPerGame: 0.70, pointsPerGame: 1.15, shotsPerGame: 4.0 },
  { playerName: "Sidney Crosby",         team: "PIT", position: "F", goalsPerGame: 0.40, assistsPerGame: 0.70, pointsPerGame: 1.10, shotsPerGame: 3.0 },
  { playerName: "Aleksander Barkov",     team: "FLA", position: "F", goalsPerGame: 0.40, assistsPerGame: 0.55, pointsPerGame: 0.95, shotsPerGame: 2.8 },
  { playerName: "Brayden Point",         team: "TBL", position: "F", goalsPerGame: 0.45, assistsPerGame: 0.45, pointsPerGame: 0.90, shotsPerGame: 2.9 },
  { playerName: "Matthew Tkachuk",       team: "FLA", position: "F", goalsPerGame: 0.40, assistsPerGame: 0.55, pointsPerGame: 0.95, shotsPerGame: 3.0 },
  { playerName: "Brad Marchand",         team: "FLA", position: "F", goalsPerGame: 0.35, assistsPerGame: 0.50, pointsPerGame: 0.85, shotsPerGame: 2.8 },
  { playerName: "Jason Robertson",       team: "DAL", position: "F", goalsPerGame: 0.40, assistsPerGame: 0.55, pointsPerGame: 0.95, shotsPerGame: 3.2 },
  { playerName: "Sebastian Aho",         team: "CAR", position: "F", goalsPerGame: 0.40, assistsPerGame: 0.55, pointsPerGame: 0.95, shotsPerGame: 3.0 },
  { playerName: "Filip Forsberg",        team: "NSH", position: "F", goalsPerGame: 0.42, assistsPerGame: 0.50, pointsPerGame: 0.92, shotsPerGame: 3.0 },
  { playerName: "Mark Scheifele",        team: "WPG", position: "F", goalsPerGame: 0.42, assistsPerGame: 0.55, pointsPerGame: 0.97, shotsPerGame: 2.9 },
  { playerName: "Kyle Connor",           team: "WPG", position: "F", goalsPerGame: 0.45, assistsPerGame: 0.50, pointsPerGame: 0.95, shotsPerGame: 3.0 },
  { playerName: "William Nylander",      team: "TOR", position: "F", goalsPerGame: 0.45, assistsPerGame: 0.55, pointsPerGame: 1.00, shotsPerGame: 3.2 },
  { playerName: "Artemi Panarin",        team: "NYR", position: "F", goalsPerGame: 0.40, assistsPerGame: 0.70, pointsPerGame: 1.10, shotsPerGame: 3.3 },
  { playerName: "Mika Zibanejad",        team: "NYR", position: "F", goalsPerGame: 0.35, assistsPerGame: 0.45, pointsPerGame: 0.80, shotsPerGame: 2.6 },
  { playerName: "Jack Eichel",           team: "VGK", position: "F", goalsPerGame: 0.35, assistsPerGame: 0.65, pointsPerGame: 1.00, shotsPerGame: 3.0 },
  { playerName: "Mark Stone",            team: "VGK", position: "F", goalsPerGame: 0.35, assistsPerGame: 0.50, pointsPerGame: 0.85, shotsPerGame: 2.5 },
  { playerName: "Sam Reinhart",          team: "FLA", position: "F", goalsPerGame: 0.55, assistsPerGame: 0.40, pointsPerGame: 0.95, shotsPerGame: 2.6 },
  { playerName: "Aleksander Holtz",      team: "NJD", position: "F", goalsPerGame: 0.25, assistsPerGame: 0.30, pointsPerGame: 0.55, shotsPerGame: 2.0 },
  { playerName: "Dylan Larkin",          team: "DET", position: "F", goalsPerGame: 0.35, assistsPerGame: 0.50, pointsPerGame: 0.85, shotsPerGame: 2.8 },
  { playerName: "Tim Stutzle",           team: "OTT", position: "F", goalsPerGame: 0.30, assistsPerGame: 0.55, pointsPerGame: 0.85, shotsPerGame: 2.8 },
  { playerName: "Brady Tkachuk",         team: "OTT", position: "F", goalsPerGame: 0.40, assistsPerGame: 0.35, pointsPerGame: 0.75, shotsPerGame: 3.0 },
  { playerName: "Travis Konecny",        team: "PHI", position: "F", goalsPerGame: 0.35, assistsPerGame: 0.50, pointsPerGame: 0.85, shotsPerGame: 2.9 },
  { playerName: "Anze Kopitar",          team: "LAK", position: "F", goalsPerGame: 0.25, assistsPerGame: 0.55, pointsPerGame: 0.80, shotsPerGame: 2.0 },
  { playerName: "Adrian Kempe",          team: "LAK", position: "F", goalsPerGame: 0.40, assistsPerGame: 0.40, pointsPerGame: 0.80, shotsPerGame: 2.8 },
  { playerName: "Elias Pettersson",      team: "VAN", position: "F", goalsPerGame: 0.35, assistsPerGame: 0.55, pointsPerGame: 0.90, shotsPerGame: 2.8 },
  { playerName: "Quinn Hughes",          team: "VAN", position: "D", goalsPerGame: 0.15, assistsPerGame: 0.85, pointsPerGame: 1.00, shotsPerGame: 2.5 },
  { playerName: "Brock Boeser",          team: "VAN", position: "F", goalsPerGame: 0.45, assistsPerGame: 0.40, pointsPerGame: 0.85, shotsPerGame: 3.0 },
  { playerName: "J.T. Miller",           team: "VAN", position: "F", goalsPerGame: 0.35, assistsPerGame: 0.65, pointsPerGame: 1.00, shotsPerGame: 2.6 },
  { playerName: "Roope Hintz",           team: "DAL", position: "F", goalsPerGame: 0.35, assistsPerGame: 0.50, pointsPerGame: 0.85, shotsPerGame: 2.8 },
  { playerName: "Tage Thompson",         team: "BUF", position: "F", goalsPerGame: 0.40, assistsPerGame: 0.40, pointsPerGame: 0.80, shotsPerGame: 3.5 },
  { playerName: "Clayton Keller",        team: "UTA", position: "F", goalsPerGame: 0.30, assistsPerGame: 0.55, pointsPerGame: 0.85, shotsPerGame: 2.5 },

  // ── Top defensemen ──
  { playerName: "Cale Makar",            team: "COL", position: "D", goalsPerGame: 0.25, assistsPerGame: 0.85, pointsPerGame: 1.10, shotsPerGame: 3.5 },
  { playerName: "Roman Josi",            team: "NSH", position: "D", goalsPerGame: 0.20, assistsPerGame: 0.60, pointsPerGame: 0.80, shotsPerGame: 2.8 },
  { playerName: "Adam Fox",              team: "NYR", position: "D", goalsPerGame: 0.15, assistsPerGame: 0.65, pointsPerGame: 0.80, shotsPerGame: 2.0 },
  { playerName: "Victor Hedman",         team: "TBL", position: "D", goalsPerGame: 0.15, assistsPerGame: 0.60, pointsPerGame: 0.75, shotsPerGame: 2.3 },
  { playerName: "Miro Heiskanen",        team: "DAL", position: "D", goalsPerGame: 0.15, assistsPerGame: 0.55, pointsPerGame: 0.70, shotsPerGame: 2.2 },
  { playerName: "Rasmus Dahlin",         team: "BUF", position: "D", goalsPerGame: 0.20, assistsPerGame: 0.55, pointsPerGame: 0.75, shotsPerGame: 2.5 },

  // ── Starting goalies (top 12) ──
  { playerName: "Sergei Bobrovsky",      team: "FLA", position: "G", savesPerGame: 25, savePct: 0.918 },
  { playerName: "Connor Hellebuyck",     team: "WPG", position: "G", savesPerGame: 27, savePct: 0.925 },
  { playerName: "Ilya Sorokin",          team: "NYI", position: "G", savesPerGame: 28, savePct: 0.912 },
  { playerName: "Andrei Vasilevskiy",    team: "TBL", position: "G", savesPerGame: 25, savePct: 0.915 },
  { playerName: "Jake Oettinger",        team: "DAL", position: "G", savesPerGame: 26, savePct: 0.916 },
  { playerName: "Jeremy Swayman",        team: "BOS", position: "G", savesPerGame: 25, savePct: 0.918 },
  { playerName: "Igor Shesterkin",       team: "NYR", position: "G", savesPerGame: 26, savePct: 0.920 },
  { playerName: "Frederik Andersen",     team: "CAR", position: "G", savesPerGame: 24, savePct: 0.912 },
  { playerName: "Stuart Skinner",        team: "EDM", position: "G", savesPerGame: 26, savePct: 0.905 },
  { playerName: "Logan Thompson",        team: "WSH", position: "G", savesPerGame: 25, savePct: 0.914 },
  { playerName: "Linus Ullmark",         team: "OTT", position: "G", savesPerGame: 27, savePct: 0.910 },
  { playerName: "Filip Gustavsson",      team: "MIN", position: "G", savesPerGame: 27, savePct: 0.912 },
];

export function getNHLStarsForTeams(teamAbbrevs: Set<string>): NHLStarPlayer[] {
  return NHL_STAR_FALLBACK.filter((p) => teamAbbrevs.has(p.team.toUpperCase()));
}
