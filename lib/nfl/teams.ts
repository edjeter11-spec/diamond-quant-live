// ──────────────────────────────────────────────────────────
// NFL Teams + Stadiums — abbrev, full name, stadium lat/lon
// for weather lookups, and indoor/outdoor classification.
//
// Indoor / dome / retractable-roof games skip weather adjustments.
// ──────────────────────────────────────────────────────────

export interface NFLTeam {
  abbrev: string;
  name: string;
  city: string;
  stadium: string;
  lat: number;
  lon: number;
  /** "outdoor" | "dome" | "retractable" */
  roof: "outdoor" | "dome" | "retractable";
  /** "grass" | "turf" — affects injury rates */
  surface: "grass" | "turf";
  /** climate zone for weather defaults */
  climate: "warm" | "moderate" | "cold" | "indoor";
}

export const NFL_TEAMS: Record<string, NFLTeam> = {
  ARI: { abbrev: "ARI", name: "Cardinals", city: "Glendale, AZ", stadium: "State Farm Stadium", lat: 33.5277, lon: -112.2626, roof: "retractable", surface: "grass", climate: "warm" },
  ATL: { abbrev: "ATL", name: "Falcons", city: "Atlanta, GA", stadium: "Mercedes-Benz Stadium", lat: 33.7553, lon: -84.4006, roof: "retractable", surface: "turf", climate: "moderate" },
  BAL: { abbrev: "BAL", name: "Ravens", city: "Baltimore, MD", stadium: "M&T Bank Stadium", lat: 39.2779, lon: -76.6227, roof: "outdoor", surface: "grass", climate: "moderate" },
  BUF: { abbrev: "BUF", name: "Bills", city: "Orchard Park, NY", stadium: "Highmark Stadium", lat: 42.7738, lon: -78.7868, roof: "outdoor", surface: "turf", climate: "cold" },
  CAR: { abbrev: "CAR", name: "Panthers", city: "Charlotte, NC", stadium: "Bank of America Stadium", lat: 35.2258, lon: -80.8528, roof: "outdoor", surface: "turf", climate: "moderate" },
  CHI: { abbrev: "CHI", name: "Bears", city: "Chicago, IL", stadium: "Soldier Field", lat: 41.8623, lon: -87.6167, roof: "outdoor", surface: "grass", climate: "cold" },
  CIN: { abbrev: "CIN", name: "Bengals", city: "Cincinnati, OH", stadium: "Paycor Stadium", lat: 39.0954, lon: -84.5160, roof: "outdoor", surface: "turf", climate: "moderate" },
  CLE: { abbrev: "CLE", name: "Browns", city: "Cleveland, OH", stadium: "Cleveland Browns Stadium", lat: 41.5061, lon: -81.6995, roof: "outdoor", surface: "grass", climate: "cold" },
  DAL: { abbrev: "DAL", name: "Cowboys", city: "Arlington, TX", stadium: "AT&T Stadium", lat: 32.7473, lon: -97.0945, roof: "retractable", surface: "turf", climate: "warm" },
  DEN: { abbrev: "DEN", name: "Broncos", city: "Denver, CO", stadium: "Empower Field at Mile High", lat: 39.7439, lon: -105.0201, roof: "outdoor", surface: "grass", climate: "cold" },
  DET: { abbrev: "DET", name: "Lions", city: "Detroit, MI", stadium: "Ford Field", lat: 42.3400, lon: -83.0456, roof: "dome", surface: "turf", climate: "indoor" },
  GB:  { abbrev: "GB",  name: "Packers", city: "Green Bay, WI", stadium: "Lambeau Field", lat: 44.5013, lon: -88.0622, roof: "outdoor", surface: "grass", climate: "cold" },
  HOU: { abbrev: "HOU", name: "Texans", city: "Houston, TX", stadium: "NRG Stadium", lat: 29.6847, lon: -95.4107, roof: "retractable", surface: "turf", climate: "warm" },
  IND: { abbrev: "IND", name: "Colts", city: "Indianapolis, IN", stadium: "Lucas Oil Stadium", lat: 39.7601, lon: -86.1639, roof: "retractable", surface: "turf", climate: "moderate" },
  JAX: { abbrev: "JAX", name: "Jaguars", city: "Jacksonville, FL", stadium: "EverBank Stadium", lat: 30.3239, lon: -81.6373, roof: "outdoor", surface: "grass", climate: "warm" },
  KC:  { abbrev: "KC",  name: "Chiefs", city: "Kansas City, MO", stadium: "GEHA Field at Arrowhead", lat: 39.0489, lon: -94.4839, roof: "outdoor", surface: "grass", climate: "moderate" },
  LV:  { abbrev: "LV",  name: "Raiders", city: "Paradise, NV", stadium: "Allegiant Stadium", lat: 36.0908, lon: -115.1830, roof: "dome", surface: "grass", climate: "indoor" },
  LAC: { abbrev: "LAC", name: "Chargers", city: "Inglewood, CA", stadium: "SoFi Stadium", lat: 33.9534, lon: -118.3392, roof: "dome", surface: "turf", climate: "indoor" },
  LAR: { abbrev: "LAR", name: "Rams", city: "Inglewood, CA", stadium: "SoFi Stadium", lat: 33.9534, lon: -118.3392, roof: "dome", surface: "turf", climate: "indoor" },
  MIA: { abbrev: "MIA", name: "Dolphins", city: "Miami Gardens, FL", stadium: "Hard Rock Stadium", lat: 25.9580, lon: -80.2389, roof: "outdoor", surface: "grass", climate: "warm" },
  MIN: { abbrev: "MIN", name: "Vikings", city: "Minneapolis, MN", stadium: "U.S. Bank Stadium", lat: 44.9737, lon: -93.2580, roof: "dome", surface: "turf", climate: "indoor" },
  NE:  { abbrev: "NE",  name: "Patriots", city: "Foxborough, MA", stadium: "Gillette Stadium", lat: 42.0909, lon: -71.2643, roof: "outdoor", surface: "turf", climate: "cold" },
  NO:  { abbrev: "NO",  name: "Saints", city: "New Orleans, LA", stadium: "Caesars Superdome", lat: 29.9511, lon: -90.0812, roof: "dome", surface: "turf", climate: "indoor" },
  NYG: { abbrev: "NYG", name: "Giants", city: "East Rutherford, NJ", stadium: "MetLife Stadium", lat: 40.8136, lon: -74.0744, roof: "outdoor", surface: "turf", climate: "cold" },
  NYJ: { abbrev: "NYJ", name: "Jets", city: "East Rutherford, NJ", stadium: "MetLife Stadium", lat: 40.8136, lon: -74.0744, roof: "outdoor", surface: "turf", climate: "cold" },
  PHI: { abbrev: "PHI", name: "Eagles", city: "Philadelphia, PA", stadium: "Lincoln Financial Field", lat: 39.9008, lon: -75.1675, roof: "outdoor", surface: "grass", climate: "moderate" },
  PIT: { abbrev: "PIT", name: "Steelers", city: "Pittsburgh, PA", stadium: "Acrisure Stadium", lat: 40.4467, lon: -80.0157, roof: "outdoor", surface: "grass", climate: "cold" },
  SF:  { abbrev: "SF",  name: "49ers", city: "Santa Clara, CA", stadium: "Levi's Stadium", lat: 37.4030, lon: -121.9697, roof: "outdoor", surface: "grass", climate: "warm" },
  SEA: { abbrev: "SEA", name: "Seahawks", city: "Seattle, WA", stadium: "Lumen Field", lat: 47.5952, lon: -122.3316, roof: "outdoor", surface: "turf", climate: "moderate" },
  TB:  { abbrev: "TB",  name: "Buccaneers", city: "Tampa, FL", stadium: "Raymond James Stadium", lat: 27.9759, lon: -82.5033, roof: "outdoor", surface: "grass", climate: "warm" },
  TEN: { abbrev: "TEN", name: "Titans", city: "Nashville, TN", stadium: "Nissan Stadium", lat: 36.1665, lon: -86.7713, roof: "outdoor", surface: "grass", climate: "moderate" },
  WAS: { abbrev: "WAS", name: "Commanders", city: "Landover, MD", stadium: "Northwest Stadium", lat: 38.9077, lon: -76.8645, roof: "outdoor", surface: "grass", climate: "moderate" },
};

const NAME_TO_ABBREV: Record<string, string> = {};
for (const [abbrev, t] of Object.entries(NFL_TEAMS)) {
  NAME_TO_ABBREV[t.name.toLowerCase()] = abbrev;
  NAME_TO_ABBREV[`${t.city.split(",")[0].toLowerCase()} ${t.name.toLowerCase()}`] = abbrev;
}
// Common variations
NAME_TO_ABBREV["la rams"] = "LAR";
NAME_TO_ABBREV["la chargers"] = "LAC";
NAME_TO_ABBREV["new york giants"] = "NYG";
NAME_TO_ABBREV["new york jets"] = "NYJ";
NAME_TO_ABBREV["washington commanders"] = "WAS";
NAME_TO_ABBREV["las vegas raiders"] = "LV";
NAME_TO_ABBREV["jacksonville jaguars"] = "JAX";
NAME_TO_ABBREV["kansas city chiefs"] = "KC";
NAME_TO_ABBREV["san francisco 49ers"] = "SF";
NAME_TO_ABBREV["green bay packers"] = "GB";
NAME_TO_ABBREV["tampa bay buccaneers"] = "TB";
NAME_TO_ABBREV["new england patriots"] = "NE";
NAME_TO_ABBREV["new orleans saints"] = "NO";

export function getNFLTeamAbbrev(name: string): string {
  if (!name) return "";
  const lookup = NAME_TO_ABBREV[name.toLowerCase().trim()];
  if (lookup) return lookup;
  // Try last word match (e.g. "Cardinals" → ARI)
  const parts = name.toLowerCase().trim().split(/\s+/);
  for (let i = 0; i < parts.length; i++) {
    const tail = parts.slice(i).join(" ");
    if (NAME_TO_ABBREV[tail]) return NAME_TO_ABBREV[tail];
  }
  // Direct abbrev?
  if (NFL_TEAMS[name.toUpperCase()]) return name.toUpperCase();
  return "";
}

export function getNFLTeam(abbrev: string): NFLTeam | null {
  return NFL_TEAMS[abbrev.toUpperCase()] ?? null;
}
