"use client";

import { useState } from "react";
import { getTeamLogoByName, getTeamLogo, teamNameToAbbrev } from "@/lib/logos";
import { useSport } from "@/lib/sport-context";

interface TeamLogoProps {
  team: string;        // full name or abbreviation
  size?: number;       // px, default 20
  className?: string;
}

export default function TeamLogo({ team, size = 20, className = "" }: TeamLogoProps) {
  const { currentSport } = useSport();
  const [imgError, setImgError] = useState(false);

  // Try abbreviation first, then full name
  let url = getTeamLogo(team, currentSport);
  if (!url) url = getTeamLogoByName(team, currentSport);

  // If no URL or image failed to load, render a 3-letter abbreviation fallback
  // (single-letter looked like a cryptic status code in tight UI rows)
  if (!url || imgError) {
    const abbrev = teamNameToAbbrev(team || "", currentSport as "mlb" | "nba");
    const label = (abbrev && abbrev.length <= 4 ? abbrev : (team || "?").slice(0, 3)).toUpperCase();
    return (
      <div
        className={`flex-shrink-0 rounded-full bg-gunmetal/50 border border-slate/20 flex items-center justify-center text-mercury/80 font-bold tracking-tight ${className}`}
        style={{ width: size, height: size, fontSize: size * 0.32, lineHeight: 1 }}
        title={team}
      >
        {label}
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={team}
      width={size}
      height={size}
      className={`flex-shrink-0 ${className}`}
      style={{ width: size, height: size }}
      onError={() => setImgError(true)}
    />
  );
}
