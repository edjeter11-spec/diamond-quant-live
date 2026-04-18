"use client";

import { useState } from "react";
import { getTeamLogoByName, getTeamLogo, teamNameToAbbrev, getMlbLogoFallback } from "@/lib/logos";
import { useSport } from "@/lib/sport-context";

interface TeamLogoProps {
  team: string;        // full name or abbreviation
  size?: number;       // px, default 20
  className?: string;
}

export default function TeamLogo({ team, size = 20, className = "" }: TeamLogoProps) {
  const { currentSport } = useSport();
  const [primaryError, setPrimaryError] = useState(false);
  const [fallbackError, setFallbackError] = useState(false);

  // Resolve to a canonical abbreviation first so any downstream lookup is consistent.
  const abbrev = teamNameToAbbrev(team || "", currentSport as "mlb" | "nba");

  // Primary URL — try abbrev; if that fails, try by name.
  let primary = getTeamLogo(abbrev || team, currentSport);
  if (!primary) primary = getTeamLogoByName(team, currentSport);

  // MLB has a second URL (ESPN CDN) to fall back to before we give up on images
  const fallback = currentSport === "mlb" && abbrev ? getMlbLogoFallback(abbrev) : "";

  // Serve primary; on error swap to fallback; on both errors render text badge.
  if (primary && !primaryError) {
    return (
      <img
        src={primary}
        alt={team}
        width={size}
        height={size}
        className={`flex-shrink-0 ${className}`}
        style={{ width: size, height: size }}
        onError={() => setPrimaryError(true)}
      />
    );
  }
  if (fallback && !fallbackError) {
    return (
      <img
        src={fallback}
        alt={team}
        width={size}
        height={size}
        className={`flex-shrink-0 ${className}`}
        style={{ width: size, height: size }}
        onError={() => setFallbackError(true)}
      />
    );
  }

  // Final fallback — 3-letter text badge
  const label = (abbrev && abbrev.length <= 4 ? abbrev : (team || "?").slice(0, 3)).toUpperCase();
  return (
    <div
      className={`flex-shrink-0 rounded-full bg-gunmetal/50 border border-slate/30 flex items-center justify-center text-silver font-bold tracking-tight ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.32, lineHeight: 1 }}
      title={team}
    >
      {label}
    </div>
  );
}
