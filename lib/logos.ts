// ──────────────────────────────────────────────────────────
// Team Logos + Player Photos
// Free CDN sources for MLB and NBA
// ──────────────────────────────────────────────────────────

// MLB Team IDs for logo URLs
const MLB_TEAM_IDS: Record<string, number> = {
  "ARI": 109, "ATL": 144, "BAL": 110, "BOS": 111, "CHC": 112,
  "CWS": 145, "CIN": 113, "CLE": 114, "COL": 115, "DET": 116,
  "HOU": 117, "KC": 118, "LAA": 108, "LAD": 119, "MIA": 146,
  "MIL": 158, "MIN": 142, "NYM": 121, "NYY": 147, "OAK": 133,
  "PHI": 143, "PIT": 134, "SD": 135, "SF": 137, "SEA": 136,
  "STL": 138, "TB": 139, "TEX": 140, "TOR": 141, "WSH": 120,
};

// NBA Team IDs for logo URLs
const NBA_TEAM_IDS: Record<string, number> = {
  "ATL": 1610612737, "BOS": 1610612738, "BKN": 1610612751, "CHA": 1610612766,
  "CHI": 1610612741, "CLE": 1610612739, "DAL": 1610612742, "DEN": 1610612743,
  "DET": 1610612765, "GSW": 1610612744, "HOU": 1610612745, "IND": 1610612754,
  "LAC": 1610612746, "LAL": 1610612747, "MEM": 1610612763, "MIA": 1610612748,
  "MIL": 1610612749, "MIN": 1610612750, "NOP": 1610612740, "NYK": 1610612752,
  "OKC": 1610612760, "ORL": 1610612753, "PHI": 1610612755, "PHX": 1610612756,
  "POR": 1610612757, "SAC": 1610612758, "SAS": 1610612759, "TOR": 1610612761,
  "UTA": 1610612762, "WAS": 1610612764,
};

// Get team logo URL
export function getTeamLogo(abbrev: string, sport: "mlb" | "nba" = "mlb"): string {
  if (sport === "nba") {
    const id = NBA_TEAM_IDS[abbrev];
    if (id) return `https://cdn.nba.com/logos/nba/${id}/primary/L/logo.svg`;
    return "";
  }
  const id = MLB_TEAM_IDS[abbrev];
  if (id) return `https://midfield.mlbstatic.com/t_gen_default_100/team-logos/${id}.svg`;
  return "";
}

// Get team logo from full name
export function getTeamLogoByName(teamName: string, sport: "mlb" | "nba" = "mlb"): string {
  const abbrev = teamNameToAbbrev(teamName, sport);
  return getTeamLogo(abbrev, sport);
}

// Convert full team name to abbreviation
function teamNameToAbbrev(name: string, sport: "mlb" | "nba"): string {
  const lower = name.toLowerCase();
  const lookup = sport === "nba" ? NBA_NAME_TO_ABBREV : MLB_NAME_TO_ABBREV;
  for (const [key, abbrev] of Object.entries(lookup)) {
    if (lower.includes(key)) return abbrev;
  }
  // Fallback: last word
  return name.split(" ").pop()?.slice(0, 3).toUpperCase() ?? "";
}

const MLB_NAME_TO_ABBREV: Record<string, string> = {
  "diamondbacks": "ARI", "braves": "ATL", "orioles": "BAL", "red sox": "BOS",
  "cubs": "CHC", "white sox": "CWS", "reds": "CIN", "guardians": "CLE",
  "rockies": "COL", "tigers": "DET", "astros": "HOU", "royals": "KC",
  "angels": "LAA", "dodgers": "LAD", "marlins": "MIA", "brewers": "MIL",
  "twins": "MIN", "mets": "NYM", "yankees": "NYY", "athletics": "OAK",
  "phillies": "PHI", "pirates": "PIT", "padres": "SD", "giants": "SF",
  "mariners": "SEA", "cardinals": "STL", "rays": "TB", "rangers": "TEX",
  "blue jays": "TOR", "nationals": "WSH",
};

const NBA_NAME_TO_ABBREV: Record<string, string> = {
  "hawks": "ATL", "celtics": "BOS", "nets": "BKN", "hornets": "CHA",
  "bulls": "CHI", "cavaliers": "CLE", "mavericks": "DAL", "nuggets": "DEN",
  "pistons": "DET", "warriors": "GSW", "rockets": "HOU", "pacers": "IND",
  "clippers": "LAC", "lakers": "LAL", "grizzlies": "MEM", "heat": "MIA",
  "bucks": "MIL", "timberwolves": "MIN", "pelicans": "NOP", "knicks": "NYK",
  "thunder": "OKC", "magic": "ORL", "76ers": "PHI", "suns": "PHX",
  "trail blazers": "POR", "blazers": "POR", "kings": "SAC", "spurs": "SAS",
  "raptors": "TOR", "jazz": "UTA", "wizards": "WAS",
};

// Player headshot URLs
export function getMLBPlayerPhoto(playerId: number): string {
  return `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_80,q_auto:best/v1/people/${playerId}/headshot/67/current`;
}

export function getNBAPlayerPhoto(playerId: number): string {
  return `https://cdn.nba.com/headshots/nba/latest/260x190/${playerId}.png`;
}

// Abbreviation → Full team name
const MLB_ABBREV_TO_FULL: Record<string, string> = {
  "ARI": "Arizona Diamondbacks", "ATL": "Atlanta Braves", "BAL": "Baltimore Orioles",
  "BOS": "Boston Red Sox", "CHC": "Chicago Cubs", "CWS": "Chicago White Sox",
  "CIN": "Cincinnati Reds", "CLE": "Cleveland Guardians", "COL": "Colorado Rockies",
  "DET": "Detroit Tigers", "HOU": "Houston Astros", "KC": "Kansas City Royals",
  "LAA": "Los Angeles Angels", "LAD": "Los Angeles Dodgers", "MIA": "Miami Marlins",
  "MIL": "Milwaukee Brewers", "MIN": "Minnesota Twins", "NYM": "New York Mets",
  "NYY": "New York Yankees", "OAK": "Oakland Athletics", "PHI": "Philadelphia Phillies",
  "PIT": "Pittsburgh Pirates", "SD": "San Diego Padres", "SF": "San Francisco Giants",
  "SEA": "Seattle Mariners", "STL": "St. Louis Cardinals", "TB": "Tampa Bay Rays",
  "TEX": "Texas Rangers", "TOR": "Toronto Blue Jays", "WSH": "Washington Nationals",
};

const NBA_ABBREV_TO_FULL: Record<string, string> = {
  "ATL": "Atlanta Hawks", "BOS": "Boston Celtics", "BKN": "Brooklyn Nets",
  "CHA": "Charlotte Hornets", "CHI": "Chicago Bulls", "CLE": "Cleveland Cavaliers",
  "DAL": "Dallas Mavericks", "DEN": "Denver Nuggets", "DET": "Detroit Pistons",
  "GSW": "Golden State Warriors", "HOU": "Houston Rockets", "IND": "Indiana Pacers",
  "LAC": "Los Angeles Clippers", "LAL": "Los Angeles Lakers", "MEM": "Memphis Grizzlies",
  "MIA": "Miami Heat", "MIL": "Milwaukee Bucks", "MIN": "Minnesota Timberwolves",
  "NOP": "New Orleans Pelicans", "NYK": "New York Knicks", "OKC": "Oklahoma City Thunder",
  "ORL": "Orlando Magic", "PHI": "Philadelphia 76ers", "PHX": "Phoenix Suns",
  "POR": "Portland Trail Blazers", "SAC": "Sacramento Kings", "SAS": "San Antonio Spurs",
  "TOR": "Toronto Raptors", "UTA": "Utah Jazz", "WAS": "Washington Wizards",
};

export function getFullTeamName(abbrev: string, sport: "mlb" | "nba" = "mlb"): string {
  if (sport === "nba") return NBA_ABBREV_TO_FULL[abbrev] ?? abbrev;
  return MLB_ABBREV_TO_FULL[abbrev] ?? abbrev;
}

// Get just the mascot/nickname from abbreviation (e.g. "NYY" → "Yankees")
export function getTeamNickname(abbrev: string, sport: "mlb" | "nba" = "mlb"): string {
  const full = getFullTeamName(abbrev, sport);
  if (full === abbrev) return abbrev;
  // Last word, or last two for "Red Sox", "White Sox", "Blue Jays", "Trail Blazers"
  const twoWord = ["Red Sox", "White Sox", "Blue Jays", "Trail Blazers"];
  for (const tw of twoWord) {
    if (full.endsWith(tw)) return tw;
  }
  return full.split(" ").pop() ?? abbrev;
}
