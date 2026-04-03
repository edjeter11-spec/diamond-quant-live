"use client";

import { useStore } from "@/lib/store";
import { Clock, MapPin, Cloud, ChevronRight, TrendingUp, Zap } from "lucide-react";

interface GameCardProps {
  game: {
    id: string;
    homeTeam: string;
    homeAbbrev: string;
    awayTeam: string;
    awayAbbrev: string;
    homeScore: number;
    awayScore: number;
    status: "pre" | "live" | "final";
    inning: number;
    inningHalf: string;
    outs: number;
    startTime: string;
    venue: string;
    homePitcher: string;
    awayPitcher: string;
    weather: { temp?: string; wind?: string; condition?: string } | null;
    detailedStatus: string;
  };
  oddsInfo?: {
    bestHomeML?: { bookmaker: string; odds: number };
    bestAwayML?: { bookmaker: string; odds: number };
    arbCount?: number;
    topEV?: number;
  };
}

export default function GameCard({ game, oddsInfo }: GameCardProps) {
  const { selectedGameId, selectGame } = useStore();
  const isSelected = selectedGameId === game.id;

  const formatTime = (iso: string) => {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };

  const formatOdds = (odds: number) => (odds > 0 ? `+${odds}` : `${odds}`);

  return (
    <button
      onClick={() => selectGame(isSelected ? null : game.id)}
      className={`w-full text-left rounded-xl transition-all duration-200 ${
        isSelected
          ? "glass glow-neon border-neon/30"
          : "glass glass-hover"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate/30">
        <div className="flex items-center gap-2">
          {game.status === "live" ? (
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-danger" />
              </span>
              <span className="text-xs font-semibold text-danger uppercase tracking-wider">
                {game.inningHalf === "top" ? "▲" : "▼"} {game.inning}
              </span>
              <span className="text-xs text-mercury">{game.outs} out{game.outs !== 1 ? "s" : ""}</span>
            </div>
          ) : game.status === "final" ? (
            <span className="text-xs font-semibold text-mercury uppercase tracking-wider">Final</span>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-mercury">
              <Clock className="w-3 h-3" />
              {formatTime(game.startTime)}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {oddsInfo?.arbCount && oddsInfo.arbCount > 0 && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 bg-gold/15 border border-gold/30 rounded text-gold text-[10px] font-bold">
              <Zap className="w-2.5 h-2.5" />
              ARB
            </span>
          )}
          {oddsInfo?.topEV && oddsInfo.topEV > 3 && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 bg-neon/10 border border-neon/25 rounded text-neon text-[10px] font-bold">
              <TrendingUp className="w-2.5 h-2.5" />
              +EV
            </span>
          )}
          <ChevronRight className={`w-4 h-4 text-mercury transition-transform ${isSelected ? "rotate-90" : ""}`} />
        </div>
      </div>

      {/* Matchup */}
      <div className="px-4 py-3 space-y-2">
        {/* Away Team */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold font-mono text-silver w-10">{game.awayAbbrev}</span>
            <span className="text-sm text-mercury truncate max-w-[120px]">{game.awayPitcher}</span>
          </div>
          <div className="flex items-center gap-4">
            {oddsInfo?.bestAwayML && (
              <span className={`text-sm font-mono font-semibold ${
                oddsInfo.bestAwayML.odds > 0 ? "text-neon" : "text-silver"
              }`}>
                {formatOdds(oddsInfo.bestAwayML.odds)}
              </span>
            )}
            {game.status !== "pre" && (
              <span className={`text-xl font-bold font-mono w-8 text-right ${
                game.awayScore > game.homeScore ? "text-neon" : "text-silver"
              }`}>
                {game.awayScore}
              </span>
            )}
          </div>
        </div>

        {/* Home Team */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold font-mono text-silver w-10">{game.homeAbbrev}</span>
            <span className="text-sm text-mercury truncate max-w-[120px]">{game.homePitcher}</span>
          </div>
          <div className="flex items-center gap-4">
            {oddsInfo?.bestHomeML && (
              <span className={`text-sm font-mono font-semibold ${
                oddsInfo.bestHomeML.odds > 0 ? "text-neon" : "text-silver"
              }`}>
                {formatOdds(oddsInfo.bestHomeML.odds)}
              </span>
            )}
            {game.status !== "pre" && (
              <span className={`text-xl font-bold font-mono w-8 text-right ${
                game.homeScore > game.awayScore ? "text-neon" : "text-silver"
              }`}>
                {game.homeScore}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-3 px-4 py-2 border-t border-slate/30 text-[11px] text-mercury/70">
        <div className="flex items-center gap-1">
          <MapPin className="w-3 h-3" />
          {game.venue}
        </div>
        {game.weather && (
          <div className="flex items-center gap-1">
            <Cloud className="w-3 h-3" />
            {game.weather.temp}° {game.weather.wind}
          </div>
        )}
      </div>
    </button>
  );
}
