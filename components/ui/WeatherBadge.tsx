"use client";

import { useEffect, useState } from "react";
import { Wind, Droplets, Cloud, Snowflake, Home, Sun } from "lucide-react";

interface Weather {
  temperature: number;
  windSpeed: number;
  windDirection: string;
  humidity: number;
  condition: string;
  hasRoof: boolean;
  hittingImpact: number;
  pitchingImpact: number;
  summary: string;
}

// Module-level cache + in-flight de-dupe, shared across every WeatherBadge
// instance on the page. Weather changes slowly (server already caches 10min
// per team) — without this, every re-render/remount of a game card list
// (tab switch, sport toggle, sidebar refresh) re-fired one fetch per team,
// and with 16 MLB games that's 16 redundant network round-trips each time.
const weatherCache = new Map<string, Weather | null>();
const inFlight = new Map<string, Promise<Weather | null>>();
const CLIENT_TTL_MS = 10 * 60 * 1000;
const cacheStamps = new Map<string, number>();

function getTeamWeather(team: string): Promise<Weather | null> {
  const stamp = cacheStamps.get(team);
  if (weatherCache.has(team) && stamp && Date.now() - stamp < CLIENT_TTL_MS) {
    return Promise.resolve(weatherCache.get(team) ?? null);
  }
  const pending = inFlight.get(team);
  if (pending) return pending;

  const req = fetch(`/api/weather?team=${encodeURIComponent(team)}`)
    .then((r) => r.json())
    .then((data) => {
      const w = data.ok && data.weather ? (data.weather as Weather) : null;
      weatherCache.set(team, w);
      cacheStamps.set(team, Date.now());
      return w;
    })
    .catch(() => null)
    .finally(() => {
      inFlight.delete(team);
    });

  inFlight.set(team, req);
  return req;
}

// Compact weather badge for game cards. Only meaningful for MLB outdoor venues.
// Hides itself silently on roofed/missing/NBA games.
export default function WeatherBadge({
  team,
  sport,
}: {
  team?: string;
  // Plain string, not "mlb" | "nba" — callers were casting currentSport to
  // satisfy that type, which was false for nfl/nhl. The `sport !== "mlb"`
  // guard below is correct for every sport, so widening the type just stops
  // the cast from hiding real mismatches elsewhere.
  sport: string;
}) {
  const [weather, setWeather] = useState<Weather | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (sport !== "mlb" || !team) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    getTeamWeather(team).then((w) => {
      if (cancelled) return;
      if (w) setWeather(w);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [team, sport]);

  if (!loaded || !weather) return null;
  if (weather.hasRoof) return null; // skip indoor games — weather doesn't matter

  const cond = weather.condition.toLowerCase();
  const isRain =
    cond.includes("rain") || cond.includes("drizzle") || cond.includes("storm");
  const isSnow = cond.includes("snow");
  const isCloud = cond.includes("cloud");
  const isWindy = weather.windSpeed >= 12;

  // Pick the most relevant icon — show only the strongest signal
  let Icon = Sun;
  let color = "text-amber/70";
  if (isSnow) {
    Icon = Snowflake;
    color = "text-electric";
  } else if (isRain) {
    Icon = Droplets;
    color = "text-electric";
  } else if (isWindy) {
    Icon = Wind;
    color = "text-mercury";
  } else if (isCloud) {
    Icon = Cloud;
    color = "text-mercury/60";
  }

  // Tooltip text summarizing impact on totals
  const impact = weather.hittingImpact;
  const impactLabel =
    impact > 2 ? "favors OVER" : impact < -2 ? "favors UNDER" : "neutral";
  const tooltip =
    `${Math.round(weather.temperature)}°F, ${Math.round(weather.windSpeed)}mph ${weather.windDirection}, ${weather.condition}` +
    `\n${impactLabel} (${impact > 0 ? "+" : ""}${impact.toFixed(1)})`;

  return (
    <span
      title={tooltip}
      className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-gunmetal/40 border border-slate/20 text-[9px] font-mono ${color}`}
    >
      <Icon className="w-2.5 h-2.5" />
      {isWindy && <span>{Math.round(weather.windSpeed)}mph</span>}
      {!isWindy && (isRain || isSnow) && (
        <span>{Math.round(weather.temperature)}°</span>
      )}
      {!isWindy && !isRain && !isSnow && (
        <span>{Math.round(weather.temperature)}°</span>
      )}
    </span>
  );
}
