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

// Compact weather badge for game cards. Only meaningful for MLB outdoor venues.
// Hides itself silently on roofed/missing/NBA games.
export default function WeatherBadge({ team, sport }: { team?: string; sport: "mlb" | "nba" }) {
  const [weather, setWeather] = useState<Weather | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (sport !== "mlb" || !team) { setLoaded(true); return; }
    let cancelled = false;
    fetch(`/api/weather?team=${encodeURIComponent(team)}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        if (data.ok && data.weather) setWeather(data.weather);
        setLoaded(true);
      })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [team, sport]);

  if (!loaded || !weather) return null;
  if (weather.hasRoof) return null; // skip indoor games — weather doesn't matter

  const cond = weather.condition.toLowerCase();
  const isRain = cond.includes("rain") || cond.includes("drizzle") || cond.includes("storm");
  const isSnow = cond.includes("snow");
  const isCloud = cond.includes("cloud");
  const isWindy = weather.windSpeed >= 12;

  // Pick the most relevant icon — show only the strongest signal
  let Icon = Sun;
  let color = "text-amber/70";
  if (isSnow) { Icon = Snowflake; color = "text-electric"; }
  else if (isRain) { Icon = Droplets; color = "text-electric"; }
  else if (isWindy) { Icon = Wind; color = "text-mercury"; }
  else if (isCloud) { Icon = Cloud; color = "text-mercury/60"; }

  // Tooltip text summarizing impact on totals
  const impact = weather.hittingImpact;
  const impactLabel = impact > 2 ? "favors OVER" : impact < -2 ? "favors UNDER" : "neutral";
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
      {!isWindy && (isRain || isSnow) && <span>{Math.round(weather.temperature)}°</span>}
      {!isWindy && !isRain && !isSnow && <span>{Math.round(weather.temperature)}°</span>}
    </span>
  );
}
