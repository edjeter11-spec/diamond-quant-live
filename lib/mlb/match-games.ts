// ──────────────────────────────────────────────────────────
// Robust game matching between MLB Stats API and Odds API
// Handles name variations, abbreviations, relocations
// ──────────────────────────────────────────────────────────

// All known name variants → canonical name
const NAME_ALIASES: Record<string, string> = {
  // Full names
  "arizona diamondbacks": "Arizona Diamondbacks",
  "atlanta braves": "Atlanta Braves",
  "baltimore orioles": "Baltimore Orioles",
  "boston red sox": "Boston Red Sox",
  "chicago cubs": "Chicago Cubs",
  "chicago white sox": "Chicago White Sox",
  "cincinnati reds": "Cincinnati Reds",
  "cleveland guardians": "Cleveland Guardians",
  "colorado rockies": "Colorado Rockies",
  "detroit tigers": "Detroit Tigers",
  "houston astros": "Houston Astros",
  "kansas city royals": "Kansas City Royals",
  "los angeles angels": "Los Angeles Angels",
  "los angeles dodgers": "Los Angeles Dodgers",
  "miami marlins": "Miami Marlins",
  "milwaukee brewers": "Milwaukee Brewers",
  "minnesota twins": "Minnesota Twins",
  "new york mets": "New York Mets",
  "new york yankees": "New York Yankees",
  "oakland athletics": "Athletics",
  "athletics": "Athletics",
  "philadelphia phillies": "Philadelphia Phillies",
  "pittsburgh pirates": "Pittsburgh Pirates",
  "san diego padres": "San Diego Padres",
  "san francisco giants": "San Francisco Giants",
  "seattle mariners": "Seattle Mariners",
  "st. louis cardinals": "St. Louis Cardinals",
  "st louis cardinals": "St. Louis Cardinals",
  "tampa bay rays": "Tampa Bay Rays",
  "texas rangers": "Texas Rangers",
  "toronto blue jays": "Toronto Blue Jays",
  "washington nationals": "Washington Nationals",
  // Abbreviations
  "ari": "Arizona Diamondbacks",
  "atl": "Atlanta Braves",
  "bal": "Baltimore Orioles",
  "bos": "Boston Red Sox",
  "chc": "Chicago Cubs",
  "cws": "Chicago White Sox",
  "cin": "Cincinnati Reds",
  "cle": "Cleveland Guardians",
  "col": "Colorado Rockies",
  "det": "Detroit Tigers",
  "hou": "Houston Astros",
  "kc": "Kansas City Royals",
  "laa": "Los Angeles Angels",
  "lad": "Los Angeles Dodgers",
  "mia": "Miami Marlins",
  "mil": "Milwaukee Brewers",
  "min": "Minnesota Twins",
  "nym": "New York Mets",
  "nyy": "New York Yankees",
  "oak": "Athletics",
  "phi": "Philadelphia Phillies",
  "pit": "Pittsburgh Pirates",
  "sd": "San Diego Padres",
  "sf": "San Francisco Giants",
  "sea": "Seattle Mariners",
  "stl": "St. Louis Cardinals",
  "tb": "Tampa Bay Rays",
  "tex": "Texas Rangers",
  "tor": "Toronto Blue Jays",
  "wsh": "Washington Nationals",
};

// Normalize a team name to canonical form
function normalize(name: string): string {
  const lower = name.toLowerCase().trim();
  if (NAME_ALIASES[lower]) return NAME_ALIASES[lower];

  // Try partial matching (e.g. "Yankees" -> "New York Yankees")
  for (const [alias, canonical] of Object.entries(NAME_ALIASES)) {
    if (alias.includes(lower) || lower.includes(alias)) return canonical;
  }

  // Last word match (e.g. "Dodgers")
  const lastWord = lower.split(" ").pop() ?? "";
  for (const [alias, canonical] of Object.entries(NAME_ALIASES)) {
    if (alias.endsWith(lastWord) && lastWord.length > 3) return canonical;
  }

  return name;
}

// Match a score game to an odds game
export function matchGames(
  scores: Array<{ homeTeam: string; awayTeam: string; homeAbbrev: string; [key: string]: any }>,
  odds: Array<{ homeTeam: string; awayTeam: string; [key: string]: any }>
): Map<string, any> {
  const matched = new Map<string, any>();

  for (const score of scores) {
    const scoreHome = normalize(score.homeTeam);
    const scoreAway = normalize(score.awayTeam);

    const match = odds.find((o) => {
      const oddsHome = normalize(o.homeTeam);
      const oddsAway = normalize(o.awayTeam);
      return scoreHome === oddsHome && scoreAway === oddsAway;
    }) ?? odds.find((o) => {
      // Fallback: just match home team
      return normalize(o.homeTeam) === scoreHome;
    }) ?? odds.find((o) => {
      // Fallback: abbreviation match
      const oddsHomeLast = o.homeTeam?.split(" ").pop()?.toLowerCase() ?? "";
      return score.homeAbbrev.toLowerCase() === oddsHomeLast.slice(0, 3) ||
             o.homeTeam?.toLowerCase().includes(score.homeAbbrev.toLowerCase());
    });

    if (match) {
      matched.set(score.homeTeam, match);
    }
  }

  return matched;
}

export { normalize };
