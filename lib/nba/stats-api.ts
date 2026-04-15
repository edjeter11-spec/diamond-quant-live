// ──────────────────────────────────────────────────────────
// NBA Stats API — Free endpoints for scores, standings, players
// Uses cdn.nba.com (free, no key) + balldontlie for historical
// ──────────────────────────────────────────────────────────

const NBA_CDN = "https://cdn.nba.com/static/json";
const BALLDONTLIE = "https://api.balldontlie.io/v1";

// Team abbreviation mapping
export const NBA_TEAMS: Record<string, { full: string; abbrev: string; conference: string }> = {
  "Atlanta Hawks": { full: "Atlanta Hawks", abbrev: "ATL", conference: "East" },
  "Boston Celtics": { full: "Boston Celtics", abbrev: "BOS", conference: "East" },
  "Brooklyn Nets": { full: "Brooklyn Nets", abbrev: "BKN", conference: "East" },
  "Charlotte Hornets": { full: "Charlotte Hornets", abbrev: "CHA", conference: "East" },
  "Chicago Bulls": { full: "Chicago Bulls", abbrev: "CHI", conference: "East" },
  "Cleveland Cavaliers": { full: "Cleveland Cavaliers", abbrev: "CLE", conference: "East" },
  "Dallas Mavericks": { full: "Dallas Mavericks", abbrev: "DAL", conference: "West" },
  "Denver Nuggets": { full: "Denver Nuggets", abbrev: "DEN", conference: "West" },
  "Detroit Pistons": { full: "Detroit Pistons", abbrev: "DET", conference: "East" },
  "Golden State Warriors": { full: "Golden State Warriors", abbrev: "GSW", conference: "West" },
  "Houston Rockets": { full: "Houston Rockets", abbrev: "HOU", conference: "West" },
  "Indiana Pacers": { full: "Indiana Pacers", abbrev: "IND", conference: "East" },
  "Los Angeles Clippers": { full: "Los Angeles Clippers", abbrev: "LAC", conference: "West" },
  "Los Angeles Lakers": { full: "Los Angeles Lakers", abbrev: "LAL", conference: "West" },
  "Memphis Grizzlies": { full: "Memphis Grizzlies", abbrev: "MEM", conference: "West" },
  "Miami Heat": { full: "Miami Heat", abbrev: "MIA", conference: "East" },
  "Milwaukee Bucks": { full: "Milwaukee Bucks", abbrev: "MIL", conference: "East" },
  "Minnesota Timberwolves": { full: "Minnesota Timberwolves", abbrev: "MIN", conference: "West" },
  "New Orleans Pelicans": { full: "New Orleans Pelicans", abbrev: "NOP", conference: "West" },
  "New York Knicks": { full: "New York Knicks", abbrev: "NYK", conference: "East" },
  "Oklahoma City Thunder": { full: "Oklahoma City Thunder", abbrev: "OKC", conference: "West" },
  "Orlando Magic": { full: "Orlando Magic", abbrev: "ORL", conference: "East" },
  "Philadelphia 76ers": { full: "Philadelphia 76ers", abbrev: "PHI", conference: "East" },
  "Phoenix Suns": { full: "Phoenix Suns", abbrev: "PHX", conference: "West" },
  "Portland Trail Blazers": { full: "Portland Trail Blazers", abbrev: "POR", conference: "West" },
  "Sacramento Kings": { full: "Sacramento Kings", abbrev: "SAC", conference: "West" },
  "San Antonio Spurs": { full: "San Antonio Spurs", abbrev: "SAS", conference: "West" },
  "Toronto Raptors": { full: "Toronto Raptors", abbrev: "TOR", conference: "East" },
  "Utah Jazz": { full: "Utah Jazz", abbrev: "UTA", conference: "West" },
  "Washington Wizards": { full: "Washington Wizards", abbrev: "WAS", conference: "East" },
};

export function getNBATeamAbbrev(name: string): string {
  const team = NBA_TEAMS[name];
  if (team) return team.abbrev;
  // Fuzzy match by last word
  for (const [full, info] of Object.entries(NBA_TEAMS)) {
    if (name.toLowerCase().includes(full.split(" ").pop()?.toLowerCase() ?? "")) return info.abbrev;
  }
  return name.slice(0, 3).toUpperCase();
}

// Rest/back-to-back factors for NBA
export const REST_FACTORS: Record<string, number> = {
  "b2b_home": -3,     // back-to-back at home: -3% win prob
  "b2b_away": -5,     // back-to-back on road: -5% win prob
  "3_in_4": -4,       // 3 games in 4 nights
  "4_in_5": -7,       // brutal schedule
  "rest_1": 0,        // normal (1 day rest)
  "rest_2": 2,        // 2 days rest: +2%
  "rest_3plus": 3,    // 3+ days rest: +3% (but risk of rust)
};

// NBA venue data
export const NBA_VENUES: Record<string, { name: string; altitude: boolean }> = {
  "DEN": { name: "Ball Arena", altitude: true },  // altitude advantage
  // All others are sea level / normal
};
