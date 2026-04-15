"use client";

import { X, MapPin } from "lucide-react";
import TeamLogo from "@/components/ui/TeamLogo";

interface SelectedGameBannerProps {
  game: {
    homeTeam: string;
    awayTeam: string;
    homeAbbrev: string;
    awayAbbrev: string;
    status: "pre" | "live" | "final";
    inning: number;
    inningHalf: string;
    homeScore: number;
    awayScore: number;
    homePitcher: string;
    awayPitcher: string;
    venue: string;
  };
  onDeselect: () => void;
}

export default function SelectedGameBanner({ game, onDeselect }: SelectedGameBannerProps) {
  const isLive = game.status === "live";
  const showScore = game.status === "live" || game.status === "final";

  return (
    <div className="glass border border-neon/20 rounded-xl px-3 py-2 sm:px-4 sm:py-2.5 flex items-center gap-3 sm:gap-4">
      {/* Live indicator */}
      {isLive && (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-danger" />
          </span>
          <span className="text-xs font-semibold text-danger uppercase tracking-wider">
            {game.inningHalf === "top" ? "▲" : "▼"}{game.inning}
          </span>
        </div>
      )}

      {game.status === "final" && (
        <span className="text-xs font-semibold text-mercury uppercase tracking-wider flex-shrink-0">
          Final
        </span>
      )}

      {/* Matchup */}
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-base sm:text-lg font-bold font-mono text-silver whitespace-nowrap">
          <TeamLogo team={game.awayAbbrev} size={20} /> {game.awayAbbrev} @ {game.homeAbbrev} <TeamLogo team={game.homeAbbrev} size={20} />
        </span>
        {showScore && (
          <span className="text-sm sm:text-base font-mono font-semibold text-neon flex-shrink-0">
            {game.awayScore}–{game.homeScore}
          </span>
        )}
      </div>

      {/* Pitchers */}
      <div className="hidden sm:flex items-center gap-1.5 text-xs text-mercury truncate min-w-0">
        <span className="truncate">{game.awayPitcher}</span>
        <span className="text-mercury/50">vs</span>
        <span className="truncate">{game.homePitcher}</span>
      </div>

      {/* Venue */}
      <div className="hidden sm:flex items-center gap-1 text-[11px] text-mercury/70 flex-shrink-0 ml-auto">
        <MapPin className="w-3 h-3" />
        <span className="truncate max-w-[140px]">{game.venue}</span>
      </div>

      {/* Deselect button */}
      <button
        onClick={onDeselect}
        className="flex-shrink-0 ml-auto sm:ml-0 p-1 rounded-md hover:bg-slate/40 transition-colors text-mercury hover:text-silver"
        aria-label="Deselect game"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
