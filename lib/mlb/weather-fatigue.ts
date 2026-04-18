// ──────────────────────────────────────────────────────────
// Weather + Fatigue Intelligence
// Fetches real weather for stadiums, checks schedule for
// back-to-back games, travel fatigue, rest days
// ──────────────────────────────────────────────────────────

const OPENWEATHER_KEY = process.env.OPENWEATHER_API_KEY || "";

// Stadium locations (lat/lon for weather lookup)
const STADIUMS: Record<string, { lat: number; lon: number; name: string; roof: boolean }> = {
  "ARI": { lat: 33.4455, lon: -112.0667, name: "Chase Field", roof: true },
  "ATL": { lat: 33.8907, lon: -84.4677, name: "Truist Park", roof: false },
  "BAL": { lat: 39.2838, lon: -76.6218, name: "Camden Yards", roof: false },
  "BOS": { lat: 42.3467, lon: -71.0972, name: "Fenway Park", roof: false },
  "CHC": { lat: 41.9484, lon: -87.6553, name: "Wrigley Field", roof: false },
  "CWS": { lat: 41.8299, lon: -87.6338, name: "Guaranteed Rate", roof: false },
  "CIN": { lat: 39.0974, lon: -84.5082, name: "Great American", roof: false },
  "CLE": { lat: 41.4962, lon: -81.6852, name: "Progressive Field", roof: false },
  "COL": { lat: 39.7559, lon: -104.9942, name: "Coors Field", roof: false },
  "DET": { lat: 42.3390, lon: -83.0485, name: "Comerica Park", roof: false },
  "HOU": { lat: 29.7573, lon: -95.3555, name: "Minute Maid", roof: true },
  "KC":  { lat: 39.0517, lon: -94.4803, name: "Kauffman Stadium", roof: false },
  "LAA": { lat: 33.8003, lon: -117.8827, name: "Angel Stadium", roof: false },
  "LAD": { lat: 34.0739, lon: -118.2400, name: "Dodger Stadium", roof: false },
  "MIA": { lat: 25.7781, lon: -80.2197, name: "LoanDepot Park", roof: true },
  "MIL": { lat: 43.0280, lon: -87.9712, name: "American Family", roof: true },
  "MIN": { lat: 44.9817, lon: -93.2776, name: "Target Field", roof: false },
  "NYM": { lat: 40.7571, lon: -73.8458, name: "Citi Field", roof: false },
  "NYY": { lat: 40.8296, lon: -73.9262, name: "Yankee Stadium", roof: false },
  "OAK": { lat: 37.7516, lon: -122.2005, name: "Sutter Health Park", roof: false },
  "PHI": { lat: 39.9061, lon: -75.1665, name: "Citizens Bank", roof: false },
  "PIT": { lat: 40.4469, lon: -80.0058, name: "PNC Park", roof: false },
  "SD":  { lat: 32.7076, lon: -117.1570, name: "Petco Park", roof: false },
  "SF":  { lat: 37.7786, lon: -122.3893, name: "Oracle Park", roof: false },
  "SEA": { lat: 47.5914, lon: -122.3325, name: "T-Mobile Park", roof: true },
  "STL": { lat: 38.6226, lon: -90.1928, name: "Busch Stadium", roof: false },
  "TB":  { lat: 27.7682, lon: -82.6534, name: "Tropicana Field", roof: true },
  "TEX": { lat: 32.7512, lon: -97.0832, name: "Globe Life Field", roof: true },
  "TOR": { lat: 43.6414, lon: -79.3894, name: "Rogers Centre", roof: true },
  "WSH": { lat: 38.8731, lon: -77.0074, name: "Nationals Park", roof: false },
};

export interface WeatherReport {
  temperature: number;    // fahrenheit
  windSpeed: number;      // mph
  windDirection: string;  // compass
  humidity: number;
  condition: string;
  hasRoof: boolean;
  // Impact analysis
  hittingImpact: number;  // -10 to +10 (positive = more runs)
  pitchingImpact: number; // -10 to +10 (positive = favors pitchers)
  summary: string;
}

export interface FatigueReport {
  team: string;
  gamesInLast3Days: number;
  gamesInLast7Days: number;
  isBackToBack: boolean;
  isBackToBackToBack: boolean;
  travelMiles: number;      // estimated recent travel
  restDays: number;         // days since last game
  fatigueScore: number;     // 0-100 (100 = very fatigued)
  summary: string;
}

// ── Fetch Weather for a Stadium ──

export async function getGameWeather(homeAbbrev: string): Promise<WeatherReport | null> {
  const stadium = STADIUMS[homeAbbrev];
  if (!stadium) return null;
  if (!OPENWEATHER_KEY) return null;

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${stadium.lat}&lon=${stadium.lon}&appid=${OPENWEATHER_KEY}&units=imperial`;
    const res = await fetch(url, { next: { revalidate: 600 } });
    if (!res.ok) return null;

    const data = await res.json();
    const temp = data.main?.temp ?? 72;
    const windSpeed = data.wind?.speed ?? 0;
    const windDeg = data.wind?.deg ?? 0;
    const humidity = data.main?.humidity ?? 50;
    const condition = data.weather?.[0]?.main ?? "Clear";

    // Convert wind degrees to compass
    const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    const windDirection = dirs[Math.round(windDeg / 45) % 8];

    // Calculate impact
    let hittingImpact = 0;
    let pitchingImpact = 0;

    if (!stadium.roof) {
      // Temperature: >85F = more runs, <55F = fewer
      if (temp > 85) hittingImpact += 3;
      else if (temp > 75) hittingImpact += 1;
      else if (temp < 55) { pitchingImpact += 3; hittingImpact -= 2; }
      else if (temp < 65) pitchingImpact += 1;

      // Wind: strong wind out = HRs, in = pitcher's park
      if (windSpeed > 12) {
        if (["S", "SW", "SE"].includes(windDirection)) {
          hittingImpact += 4; // blowing out
        } else if (["N", "NW", "NE"].includes(windDirection)) {
          pitchingImpact += 3; // blowing in
          hittingImpact -= 2;
        }
      }

      // Humidity: high = ball carries
      if (humidity > 75) hittingImpact += 1;

      // Rain risk
      if (condition === "Rain" || condition === "Drizzle") {
        pitchingImpact += 2; // wet ball harder to grip
      }
    }

    // Park × weather interaction (multiplicative for wind-sensitive parks,
    // plus baked-in park-factor baseline). Replaces the old "+5 for Coors"
    // hard-coded hack with a 30-park table.
    try {
      const { applyParkWeatherInteraction } = await import("@/lib/mlb/park-factors");
      const adjusted = applyParkWeatherInteraction(
        homeAbbrev, hittingImpact, pitchingImpact,
        windSpeed, windDirection, temp
      );
      hittingImpact = adjusted.hittingImpact;
      pitchingImpact = adjusted.pitchingImpact;
    } catch {}

    const summary = buildWeatherSummary(temp, windSpeed, windDirection, humidity, condition, stadium, hittingImpact, pitchingImpact);

    return {
      temperature: Math.round(temp),
      windSpeed: Math.round(windSpeed),
      windDirection,
      humidity,
      condition,
      hasRoof: stadium.roof,
      hittingImpact,
      pitchingImpact,
      summary,
    };
  } catch {
    return null;
  }
}

function buildWeatherSummary(
  temp: number, windSpeed: number, windDir: string, humidity: number,
  condition: string, stadium: any, hitImpact: number, pitchImpact: number
): string {
  if (stadium.roof) return `${stadium.name} has a retractable roof — weather is neutralized.`;

  const parts: string[] = [];
  parts.push(`${Math.round(temp)}°F at ${stadium.name}`);

  if (windSpeed > 10) {
    parts.push(`${Math.round(windSpeed)}mph winds from the ${windDir}`);
    if (["S", "SW", "SE"].includes(windDir)) parts.push("— blowing out, expect more fly balls to carry");
    else if (["N", "NW", "NE"].includes(windDir)) parts.push("— blowing in, holds fly balls in the park");
  }

  if (temp > 85) parts.push("Hot day — ball carries further, expect more offense");
  else if (temp < 55) parts.push("Cold and heavy air — favors pitchers");

  if (condition === "Rain") parts.push("Rain expected — slick balls, possible delays");

  if (hitImpact > pitchImpact) parts.push(`Net: +${hitImpact - pitchImpact} hitter-friendly`);
  else if (pitchImpact > hitImpact) parts.push(`Net: +${pitchImpact - hitImpact} pitcher-friendly`);

  return parts.join(". ") + ".";
}

// ── Fatigue Analysis from MLB Schedule ──

const MLB_API = "https://statsapi.mlb.com/api/v1";

// Team ID lookup
const TEAM_IDS: Record<string, number> = {
  "Arizona Diamondbacks": 109, "Atlanta Braves": 144, "Baltimore Orioles": 110,
  "Boston Red Sox": 111, "Chicago Cubs": 112, "Chicago White Sox": 145,
  "Cincinnati Reds": 113, "Cleveland Guardians": 114, "Colorado Rockies": 115,
  "Detroit Tigers": 116, "Houston Astros": 117, "Kansas City Royals": 118,
  "Los Angeles Angels": 108, "Los Angeles Dodgers": 119, "Miami Marlins": 146,
  "Milwaukee Brewers": 158, "Minnesota Twins": 142, "New York Mets": 121,
  "New York Yankees": 147, "Athletics": 133, "Oakland Athletics": 133,
  "Philadelphia Phillies": 143, "Pittsburgh Pirates": 134, "San Diego Padres": 135,
  "San Francisco Giants": 137, "Seattle Mariners": 136, "St. Louis Cardinals": 138,
  "Tampa Bay Rays": 139, "Texas Rangers": 140, "Toronto Blue Jays": 141,
  "Washington Nationals": 120,
};

export async function getTeamFatigue(teamName: string): Promise<FatigueReport | null> {
  const teamId = TEAM_IDS[teamName];
  if (!teamId) return null;

  try {
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const url = `${MLB_API}/schedule?sportId=1&teamId=${teamId}&startDate=${weekAgo.toISOString().split("T")[0]}&endDate=${today.toISOString().split("T")[0]}&gameType=R`;
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return null;

    const data = await res.json();
    const recentGames: string[] = [];

    for (const dateEntry of data.dates ?? []) {
      for (const game of dateEntry.games ?? []) {
        if (game.status?.statusCode === "F" || game.status?.statusCode === "O") {
          recentGames.push(dateEntry.date);
        }
      }
    }

    const last3Days = recentGames.filter((d) => {
      const diff = (today.getTime() - new Date(d).getTime()) / (1000 * 60 * 60 * 24);
      return diff <= 3;
    }).length;

    const last7Days = recentGames.length;

    // Days since last game
    const sortedDates = recentGames.sort().reverse();
    const lastGameDate = sortedDates[0] ? new Date(sortedDates[0]) : today;
    const restDays = Math.floor((today.getTime() - lastGameDate.getTime()) / (1000 * 60 * 60 * 24));

    const isB2B = last3Days >= 3;
    const isB2B2B = last3Days >= 3 && last7Days >= 6;

    // Fatigue score: 0-100
    let fatigueScore = 0;
    if (isB2B2B) fatigueScore += 40;
    else if (isB2B) fatigueScore += 25;
    if (last7Days >= 6) fatigueScore += 20;
    if (restDays === 0) fatigueScore += 15; // playing today after yesterday
    fatigueScore = Math.min(fatigueScore, 100);

    const summary = buildFatigueSummary(teamName, last3Days, last7Days, isB2B, isB2B2B, restDays, fatigueScore);

    return {
      team: teamName,
      gamesInLast3Days: last3Days,
      gamesInLast7Days: last7Days,
      isBackToBack: isB2B,
      isBackToBackToBack: isB2B2B,
      travelMiles: 0, // would need city-to-city distance calculation
      restDays,
      fatigueScore,
      summary,
    };
  } catch {
    return null;
  }
}

function buildFatigueSummary(
  team: string, last3: number, last7: number,
  b2b: boolean, b2b2b: boolean, rest: number, fatigue: number
): string {
  const parts: string[] = [];

  if (b2b2b) parts.push(`${team} on a grueling stretch — ${last3} games in 3 days, ${last7} in the last week`);
  else if (b2b) parts.push(`${team} playing back-to-back — ${last3} games in 3 days`);
  else parts.push(`${team} has played ${last7} games in the past week`);

  if (rest === 0) parts.push("No rest day — playing consecutive games");
  else if (rest >= 2) parts.push(`${rest} days rest — fresh legs`);

  if (fatigue > 50) parts.push("HIGH fatigue risk — bullpen likely taxed, expect more runs late");
  else if (fatigue > 25) parts.push("Moderate fatigue — monitor bullpen usage");
  else parts.push("Low fatigue — team is well rested");

  return parts.join(". ") + ".";
}
