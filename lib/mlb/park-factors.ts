// ──────────────────────────────────────────────────────────
// MLB Park Factors — 2024-25 baseline + weather interactions
//
// Park factor = how much a ballpark inflates/deflates runs or HRs
// relative to league average (1.00 = neutral).
// These are public numbers from FanGraphs / Baseball-Reference.
// We combine them MULTIPLICATIVELY with weather for wind-sensitive
// parks (Wrigley + wind out ≫ just Wrigley alone).
// ──────────────────────────────────────────────────────────

export interface ParkFactor {
  runs: number;    // 1.00 = neutral; 1.05 = 5% more runs than league avg
  hr: number;      // same for home runs
  roof: boolean;
  windSensitive: boolean; // parks where wind direction flips the total significantly
}

// Source: 2024-25 aggregate park factors (Fangraphs, Statcast)
export const PARK_FACTORS: Record<string, ParkFactor> = {
  // Elevation + dry air = massive hitter park
  COL: { runs: 1.15, hr: 1.20, roof: false, windSensitive: false },
  // Pitcher parks
  SD:  { runs: 0.93, hr: 0.88, roof: false, windSensitive: false },
  SF:  { runs: 0.92, hr: 0.82, roof: false, windSensitive: true }, // marine air kills HRs
  OAK: { runs: 0.95, hr: 0.95, roof: false, windSensitive: false },
  SEA: { runs: 0.95, hr: 0.95, roof: true,  windSensitive: false },
  NYM: { runs: 0.97, hr: 0.92, roof: false, windSensitive: false },
  DET: { runs: 0.97, hr: 0.95, roof: false, windSensitive: false },
  CLE: { runs: 0.97, hr: 0.96, roof: false, windSensitive: false },
  LAD: { runs: 0.96, hr: 1.00, roof: false, windSensitive: false },
  PIT: { runs: 0.96, hr: 0.92, roof: false, windSensitive: false },
  MIA: { runs: 0.95, hr: 0.93, roof: true,  windSensitive: false },
  TB:  { runs: 0.97, hr: 0.97, roof: true,  windSensitive: false },
  // Wind-sensitive parks
  CHC: { runs: 1.02, hr: 1.04, roof: false, windSensitive: true }, // Wrigley: wind swing is enormous
  BOS: { runs: 1.04, hr: 1.02, roof: false, windSensitive: true }, // Green Monster + wind tunnel
  // Hitter parks
  CIN: { runs: 1.06, hr: 1.12, roof: false, windSensitive: false }, // Great American
  MIL: { runs: 1.02, hr: 1.06, roof: true,  windSensitive: false },
  PHI: { runs: 1.03, hr: 1.06, roof: false, windSensitive: false },
  TOR: { runs: 1.02, hr: 1.04, roof: true,  windSensitive: false },
  BAL: { runs: 1.04, hr: 1.08, roof: false, windSensitive: false },
  NYY: { runs: 1.02, hr: 1.12, roof: false, windSensitive: false }, // short RF porch
  // Neutral-ish
  HOU: { runs: 1.01, hr: 1.03, roof: true,  windSensitive: false },
  STL: { runs: 1.00, hr: 0.98, roof: false, windSensitive: false },
  MIN: { runs: 1.00, hr: 0.97, roof: false, windSensitive: false },
  WSH: { runs: 1.01, hr: 1.02, roof: false, windSensitive: false },
  ARI: { runs: 1.02, hr: 1.04, roof: true,  windSensitive: false },
  KC:  { runs: 0.98, hr: 0.94, roof: false, windSensitive: false },
  TEX: { runs: 1.00, hr: 1.00, roof: true,  windSensitive: false },
  CWS: { runs: 1.02, hr: 1.04, roof: false, windSensitive: false },
  LAA: { runs: 1.00, hr: 0.97, roof: false, windSensitive: false },
  ATL: { runs: 1.01, hr: 1.02, roof: false, windSensitive: false },
};

export function getParkFactor(abbrev: string): ParkFactor {
  return PARK_FACTORS[(abbrev || "").toUpperCase()] ?? { runs: 1.00, hr: 1.00, roof: false, windSensitive: false };
}

/**
 * Combine park factor with weather multiplicatively for wind-sensitive parks.
 * Returns adjusted hitting/pitching impacts that should replace the raw values.
 */
export function applyParkWeatherInteraction(
  abbrev: string,
  hittingImpact: number,
  pitchingImpact: number,
  windSpeed: number,
  windDirection: string,
  temp: number
): { hittingImpact: number; pitchingImpact: number; notes: string[] } {
  const park = getParkFactor(abbrev);
  const notes: string[] = [];
  let hit = hittingImpact;
  let pitch = pitchingImpact;

  // If roof is closed/stadium is domed, weather doesn't interact
  if (park.roof) {
    return { hittingImpact: hit, pitchingImpact: pitch, notes };
  }

  // Base park adjustment — bake in the run factor as a baseline tilt
  const runsSignal = (park.runs - 1.0) * 10; // 1.15 → +1.5, 0.92 → -0.8
  hit += runsSignal * 0.6;
  pitch -= runsSignal * 0.4;

  // Wind-sensitive × wind blowing out = compounding boost
  const blowingOut = ["S", "SW", "SE"].includes(windDirection) && windSpeed >= 10;
  const blowingIn = ["N", "NW", "NE"].includes(windDirection) && windSpeed >= 10;

  if (park.windSensitive && blowingOut && hit > 0) {
    // Multiplicative boost: Wrigley with 15mph wind out = totals soar
    hit *= 1.5;
    notes.push(`Wind-sensitive park × blowing out — amplifying hitting edge +50%`);
  }
  if (park.windSensitive && blowingIn && pitch > 0) {
    pitch *= 1.3;
    notes.push(`Wind-sensitive park × blowing in — amplifying pitching edge +30%`);
  }

  // Coors × hot weather = extreme
  if (abbrev.toUpperCase() === "COL" && temp >= 80) {
    hit *= 1.3;
    notes.push("Coors Field + heat — ball flies, totals likely +1.5 runs over par");
  }

  // Petco × cold = extreme pitcher park
  if (abbrev.toUpperCase() === "SD" && temp <= 58) {
    pitch *= 1.2;
    notes.push("Petco + cold — marine layer pushes totals even lower");
  }

  return {
    hittingImpact: Math.round(hit * 10) / 10,
    pitchingImpact: Math.round(pitch * 10) / 10,
    notes,
  };
}
