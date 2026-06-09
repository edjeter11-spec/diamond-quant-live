// ──────────────────────────────────────────────────────────
// NFL Weather Impact
// Uses OpenWeatherMap (key already in env: OPENWEATHER_API_KEY)
// Returns weather + a 0-100 "passing penalty" score for outdoor games.
//
// Wind, rain, snow, freezing temps all reduce passing efficiency.
// Indoor games always return penalty = 0.
// ──────────────────────────────────────────────────────────

import { getNFLTeam } from "./teams";

export interface NFLWeather {
  tempF: number;
  windMph: number;
  precipProb: number;   // 0-1
  conditions: string;   // "Clear" | "Rain" | "Snow" | etc
  passingPenalty: number; // 0-100, higher = worse for passing
  indoor: boolean;
}

const WEATHER_CACHE = new Map<string, { data: NFLWeather; ts: number }>();
const CACHE_MS = 60 * 60 * 1000; // 1h

export async function getNFLGameWeather(homeAbbrev: string): Promise<NFLWeather | null> {
  const team = getNFLTeam(homeAbbrev);
  if (!team) return null;

  // Indoor games always neutral
  if (team.roof === "dome") {
    return { tempF: 70, windMph: 0, precipProb: 0, conditions: "Indoor", passingPenalty: 0, indoor: true };
  }

  const cached = WEATHER_CACHE.get(homeAbbrev);
  if (cached && Date.now() - cached.ts < CACHE_MS) return cached.data;

  const key = (process.env.OPENWEATHER_API_KEY ?? "").trim();
  if (!key) return null;

  try {
    const res = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${team.lat}&lon=${team.lon}&appid=${key}&units=imperial`,
      { next: { revalidate: 3600 } },
    );
    if (!res.ok) return null;
    const data = await res.json();

    const tempF = Number(data.main?.temp ?? 70);
    const windMph = Number(data.wind?.speed ?? 0);
    const conditions = String(data.weather?.[0]?.main ?? "Clear");
    const precipProb = Number(data.rain?.["1h"] ?? 0) > 0 ? 0.8 : Number(data.snow?.["1h"] ?? 0) > 0 ? 0.9 : 0;

    // Retractable roof: assume open in good weather, closed in bad
    const wouldClose = (precipProb > 0.5 || tempF < 40 || windMph > 25);
    if (team.roof === "retractable" && wouldClose) {
      const result: NFLWeather = { tempF, windMph: 0, precipProb: 0, conditions: "Indoor (roof closed)", passingPenalty: 0, indoor: true };
      WEATHER_CACHE.set(homeAbbrev, { data: result, ts: Date.now() });
      return result;
    }

    // Passing penalty: weighted combo of wind + precip + freezing
    let penalty = 0;
    if (windMph >= 25) penalty += 35;
    else if (windMph >= 18) penalty += 20;
    else if (windMph >= 12) penalty += 10;

    if (precipProb >= 0.7) penalty += 25;
    else if (precipProb >= 0.4) penalty += 12;

    if (tempF <= 20) penalty += 20;
    else if (tempF <= 32) penalty += 10;

    if (conditions === "Snow") penalty += 15;
    if (conditions === "Thunderstorm") penalty += 10;

    const result: NFLWeather = {
      tempF: Math.round(tempF),
      windMph: Math.round(windMph),
      precipProb,
      conditions,
      passingPenalty: Math.min(80, penalty),
      indoor: false,
    };
    WEATHER_CACHE.set(homeAbbrev, { data: result, ts: Date.now() });
    return result;
  } catch {
    return null;
  }
}
