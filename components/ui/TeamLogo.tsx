"use client";

import { useState } from "react";
import { getTeamLogoByName, getTeamLogo } from "@/lib/logos";
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

  // If no URL or image failed to load, render a letter circle fallback
  if (!url || imgError) {
    const letter = (team?.charAt(0) || "?").toUpperCase();
    return (
      <div
        className={`flex-shrink-0 rounded-full bg-gunmetal/50 border border-slate/20 flex items-center justify-center text-mercury/70 font-bold ${className}`}
        style={{ width: size, height: size, fontSize: size * 0.45, lineHeight: 1 }}
        title={team}
      >
        {letter}
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
