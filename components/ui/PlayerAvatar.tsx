"use client";

import { useState } from "react";

interface PlayerAvatarProps {
  name: string;
  photo?: string | null;   // direct URL to headshot
  size?: number;            // px, default 20
  className?: string;
}

function getInitials(name: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.charAt(0).toUpperCase();
}

export default function PlayerAvatar({ name, photo, size = 20, className = "" }: PlayerAvatarProps) {
  const [imgError, setImgError] = useState(false);

  // Show headshot if available and not errored
  if (photo && !imgError) {
    return (
      <img
        src={photo}
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
