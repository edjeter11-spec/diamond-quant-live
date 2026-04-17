"use client";

import { useState } from "react";

interface PlayerAvatarProps {
  name: string;
  photo?: string | null;      // direct URL to headshot
  playerId?: number | string | null; // auto-builds URL if sport given
  sport?: "mlb" | "nba" | null;
  size?: number;              // px, default 20
  className?: string;
}

function getInitials(name: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.charAt(0).toUpperCase();
}

// Build the official headshot URL for a player id + sport.
function buildHeadshotUrl(playerId: string | number, sport: "mlb" | "nba"): string {
  if (sport === "nba") {
    return `https://cdn.nba.com/headshots/nba/latest/260x190/${playerId}.png`;
  }
  // MLB stats API
  return `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${playerId}/headshot/67/current`;
}

export default function PlayerAvatar({ name, photo, playerId, sport, size = 20, className = "" }: PlayerAvatarProps) {
  const [imgError, setImgError] = useState(false);

  // Prefer an explicit photo URL. Fall back to auto-built URL when we have id + sport.
  const resolved = photo ?? (playerId && sport ? buildHeadshotUrl(playerId, sport) : null);

  if (resolved && !imgError) {
    return (
      <img
        src={resolved}
        alt={name}
        width={size}
        height={size}
        className={`flex-shrink-0 rounded-full object-cover bg-gunmetal/30 ${className}`}
        style={{ width: size, height: size }}
        onError={() => setImgError(true)}
      />
    );
  }

  // Fallback: initials in a gray circle
  const initials = getInitials(name);
  return (
    <div
      className={`flex-shrink-0 rounded-full bg-gunmetal/40 border border-slate/20 flex items-center justify-center text-mercury/50 font-semibold ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.38, lineHeight: 1 }}
      title={name}
    >
      {initials}
    </div>
  );
}
