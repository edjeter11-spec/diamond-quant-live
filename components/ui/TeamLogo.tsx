"use client";

import { getTeamLogoByName, getTeamLogo } from "@/lib/logos";
import { useSport } from "@/lib/sport-context";

interface TeamLogoProps {
  team: string;        // full name or abbreviation
  size?: number;       // px, default 20
  className?: string;
}

export default function TeamLogo({ team, size = 20, className = "" }: TeamLogoProps) {
  const { currentSport } = useSport();

  // Try abbreviation first, then full name
  let url = getTeamLogo(team, currentSport);
  if (!url) url = getTeamLogoByName(team, currentSport);
  if (!url) return null;

  return (
    <img
      src={url}
      alt={team}
      width={size}
      height={size}
      className={`flex-shrink-0 ${className}`}
      style={{ width: size, height: size }}
      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
    />
  );
}
