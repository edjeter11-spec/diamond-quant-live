// ──────────────────────────────────────────────────────────
// NHL Teams + arenas (all 32 teams)
// All games indoor — no weather, but arena/altitude/travel matter.
// ──────────────────────────────────────────────────────────

export interface NHLTeam {
  abbrev: string;
  name: string;
  city: string;
  arena: string;
  conference: "Eastern" | "Western";
  division: "Atlantic" | "Metropolitan" | "Central" | "Pacific";
  /** Time zone offset from ET (hours). Used for travel fatigue calc */
  tzOffset: number;
}

export const NHL_TEAMS: Record<string, NHLTeam> = {
  ANA: { abbrev: "ANA", name: "Ducks",        city: "Anaheim, CA",      arena: "Honda Center",            conference: "Western", division: "Pacific",      tzOffset: -3 },
  ARI: { abbrev: "UTA", name: "Hockey Club",  city: "Salt Lake City",   arena: "Delta Center",            conference: "Western", division: "Central",      tzOffset: -2 },
  UTA: { abbrev: "UTA", name: "Hockey Club",  city: "Salt Lake City",   arena: "Delta Center",            conference: "Western", division: "Central",      tzOffset: -2 },
  BOS: { abbrev: "BOS", name: "Bruins",       city: "Boston, MA",       arena: "TD Garden",               conference: "Eastern", division: "Atlantic",     tzOffset:  0 },
  BUF: { abbrev: "BUF", name: "Sabres",       city: "Buffalo, NY",      arena: "KeyBank Center",          conference: "Eastern", division: "Atlantic",     tzOffset:  0 },
  CGY: { abbrev: "CGY", name: "Flames",       city: "Calgary, AB",      arena: "Scotiabank Saddledome",   conference: "Western", division: "Pacific",      tzOffset: -2 },
  CAR: { abbrev: "CAR", name: "Hurricanes",   city: "Raleigh, NC",      arena: "Lenovo Center",           conference: "Eastern", division: "Metropolitan", tzOffset:  0 },
  CHI: { abbrev: "CHI", name: "Blackhawks",   city: "Chicago, IL",      arena: "United Center",           conference: "Western", division: "Central",      tzOffset: -1 },
  COL: { abbrev: "COL", name: "Avalanche",    city: "Denver, CO",       arena: "Ball Arena",              conference: "Western", division: "Central",      tzOffset: -2 },
  CBJ: { abbrev: "CBJ", name: "Blue Jackets", city: "Columbus, OH",     arena: "Nationwide Arena",        conference: "Eastern", division: "Metropolitan", tzOffset:  0 },
  DAL: { abbrev: "DAL", name: "Stars",        city: "Dallas, TX",       arena: "American Airlines Center",conference: "Western", division: "Central",      tzOffset: -1 },
  DET: { abbrev: "DET", name: "Red Wings",    city: "Detroit, MI",      arena: "Little Caesars Arena",    conference: "Eastern", division: "Atlantic",     tzOffset:  0 },
  EDM: { abbrev: "EDM", name: "Oilers",       city: "Edmonton, AB",     arena: "Rogers Place",            conference: "Western", division: "Pacific",      tzOffset: -2 },
  FLA: { abbrev: "FLA", name: "Panthers",     city: "Sunrise, FL",      arena: "Amerant Bank Arena",      conference: "Eastern", division: "Atlantic",     tzOffset:  0 },
  LAK: { abbrev: "LAK", name: "Kings",        city: "Los Angeles, CA",  arena: "Crypto.com Arena",        conference: "Western", division: "Pacific",      tzOffset: -3 },
  MIN: { abbrev: "MIN", name: "Wild",         city: "St. Paul, MN",     arena: "Xcel Energy Center",      conference: "Western", division: "Central",      tzOffset: -1 },
  MTL: { abbrev: "MTL", name: "Canadiens",    city: "Montreal, QC",     arena: "Bell Centre",             conference: "Eastern", division: "Atlantic",     tzOffset:  0 },
  NSH: { abbrev: "NSH", name: "Predators",    city: "Nashville, TN",    arena: "Bridgestone Arena",       conference: "Western", division: "Central",      tzOffset: -1 },
  NJD: { abbrev: "NJD", name: "Devils",       city: "Newark, NJ",       arena: "Prudential Center",       conference: "Eastern", division: "Metropolitan", tzOffset:  0 },
  NYI: { abbrev: "NYI", name: "Islanders",    city: "Elmont, NY",       arena: "UBS Arena",               conference: "Eastern", division: "Metropolitan", tzOffset:  0 },
  NYR: { abbrev: "NYR", name: "Rangers",      city: "New York, NY",     arena: "Madison Square Garden",   conference: "Eastern", division: "Metropolitan", tzOffset:  0 },
  OTT: { abbrev: "OTT", name: "Senators",     city: "Ottawa, ON",       arena: "Canadian Tire Centre",    conference: "Eastern", division: "Atlantic",     tzOffset:  0 },
  PHI: { abbrev: "PHI", name: "Flyers",       city: "Philadelphia, PA", arena: "Wells Fargo Center",      conference: "Eastern", division: "Metropolitan", tzOffset:  0 },
  PIT: { abbrev: "PIT", name: "Penguins",     city: "Pittsburgh, PA",   arena: "PPG Paints Arena",        conference: "Eastern", division: "Metropolitan", tzOffset:  0 },
  SJS: { abbrev: "SJS", name: "Sharks",       city: "San Jose, CA",     arena: "SAP Center",              conference: "Western", division: "Pacific",      tzOffset: -3 },
  SEA: { abbrev: "SEA", name: "Kraken",       city: "Seattle, WA",      arena: "Climate Pledge Arena",    conference: "Western", division: "Pacific",      tzOffset: -3 },
  STL: { abbrev: "STL", name: "Blues",        city: "St. Louis, MO",    arena: "Enterprise Center",       conference: "Western", division: "Central",      tzOffset: -1 },
  TBL: { abbrev: "TBL", name: "Lightning",    city: "Tampa, FL",        arena: "Amalie Arena",            conference: "Eastern", division: "Atlantic",     tzOffset:  0 },
  TOR: { abbrev: "TOR", name: "Maple Leafs",  city: "Toronto, ON",      arena: "Scotiabank Arena",        conference: "Eastern", division: "Atlantic",     tzOffset:  0 },
  VAN: { abbrev: "VAN", name: "Canucks",      city: "Vancouver, BC",    arena: "Rogers Arena",            conference: "Western", division: "Pacific",      tzOffset: -3 },
  VGK: { abbrev: "VGK", name: "Golden Knights",city:"Las Vegas, NV",    arena: "T-Mobile Arena",          conference: "Western", division: "Pacific",      tzOffset: -3 },
  WSH: { abbrev: "WSH", name: "Capitals",     city: "Washington, DC",   arena: "Capital One Arena",       conference: "Eastern", division: "Metropolitan", tzOffset:  0 },
  WPG: { abbrev: "WPG", name: "Jets",         city: "Winnipeg, MB",     arena: "Canada Life Centre",      conference: "Western", division: "Central",      tzOffset: -1 },
};

const NAME_TO_ABBREV: Record<string, string> = {};
for (const [abbrev, t] of Object.entries(NHL_TEAMS)) {
  NAME_TO_ABBREV[t.name.toLowerCase()] = abbrev;
  NAME_TO_ABBREV[`${t.city.split(",")[0].toLowerCase()} ${t.name.toLowerCase()}`] = abbrev;
}
NAME_TO_ABBREV["la kings"] = "LAK";
NAME_TO_ABBREV["los angeles kings"] = "LAK";
NAME_TO_ABBREV["new york rangers"] = "NYR";
NAME_TO_ABBREV["new york islanders"] = "NYI";
NAME_TO_ABBREV["new jersey devils"] = "NJD";
NAME_TO_ABBREV["san jose sharks"] = "SJS";
NAME_TO_ABBREV["st louis blues"] = "STL";
NAME_TO_ABBREV["tampa bay lightning"] = "TBL";
NAME_TO_ABBREV["vegas golden knights"] = "VGK";
NAME_TO_ABBREV["winnipeg jets"] = "WPG";
NAME_TO_ABBREV["utah hockey club"] = "UTA";
NAME_TO_ABBREV["utah mammoth"] = "UTA";

export function getNHLTeamAbbrev(name: string): string {
  if (!name) return "";
  const lookup = NAME_TO_ABBREV[name.toLowerCase().trim()];
  if (lookup) return lookup;
  const parts = name.toLowerCase().trim().split(/\s+/);
  for (let i = 0; i < parts.length; i++) {
    const tail = parts.slice(i).join(" ");
    if (NAME_TO_ABBREV[tail]) return NAME_TO_ABBREV[tail];
  }
  if (NHL_TEAMS[name.toUpperCase()]) return name.toUpperCase();
  return "";
}

export function getNHLTeam(abbrev: string): NHLTeam | null {
  return NHL_TEAMS[abbrev.toUpperCase()] ?? null;
}
