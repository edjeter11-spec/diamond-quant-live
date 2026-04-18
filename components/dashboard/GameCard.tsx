"use client";

import { useStore } from "@/lib/store";
import { useSport } from "@/lib/sport-context";
import { Clock, MapPin, Cloud, ChevronRight, TrendingUp, Zap } from "lucide-react";
import TeamLogo from "@/components/ui/TeamLogo";
import PlayerAvatar from "@/components/ui/PlayerAvatar";
import WeatherBadge from "@/components/ui/WeatherBadge";
import { getFullTeamName } from "@/lib/logos";

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
    homePitcherId?: number;
    awayPitcherId?: number;
    // NBA-specific
    isNBA?: boolean;
    period?: number;
    periodLabel?: string;
    timeRemaining?: string;
  };
  oddsInfo?: {
    bestHomeML?: { bookmaker: string; odds: number };
    bestAwayML?: { bookmaker: string; odds: number };
    arbCount?: number;
    topEV?: number;
  };
}

// Pitcher headshot — uses PlayerAvatar with MLB CDN photo or initials fallback
function PitcherFace({ name, pitcherId }: { name: string; pitcherId?: number }) {
  if (!name || name === "TBD") {
    return <span className="text-[9px] sm:text-[10px] text-mercury/40 italic truncate">TBD</span>;
  }

  const photoUrl = pitcherId
    ? `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_40,q_auto:best/v1/people/${pitcherId}/headshot/67/current`
    : undefined;

  return (
    <div className="flex items-center gap-1 min-w-0">
      <PlayerAvatar name={name} photo={photoUrl} size={18} className="sm:!w-5 sm:!h-5" />
      <span className="text-[9px] sm:text-[10px] text-mercury/70 truncate">{name}</span>
    </div>
  );
}

export default function GameCard({ game, oddsInfo }: GameCardProps) {
  const { selectedGameId, selectGame } = useStore();
  const { currentSport } = useSport();
  const isSelected = selectedGameId === game.id;
  const isNBA = game.isNBA || currentSport === "nba";

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    } catch { return ""; }
  };

  const formatOdds = (odds: number) => (odds > 0 ? `+${odds}` : `${odds}`);

  // Full names for desktop, abbreviations for mobile
  const awayFull = getFullTeamName(game.awayAbbrev, currentSport);
  const homeFull = getFullTeamName(game.homeAbbrev, currentSport);

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
      <div className="flex items-center justify-between px-3 sm:px-4 py-2 border-b border-slate/30">
        <div className="flex items-center gap-2">
          {game.status === "live" && (((game.awayScore ?? 0) + (game.homeScore ?? 0)) > 0
              || (game.inning ?? 0) > 1 || (game.period ?? 0) > 1 || (game.outs ?? 0) > 0) ? (
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-danger" />
              </span>
              {isNBA ? (
                <span className="text-xs font-semibold text-danger uppercase tracking-wider">
                  {game.periodLabel || `Q${game.period}`}
                  {game.timeRemaining ? ` ${game.timeRemaining}` : ""}
                </span>
              ) : (
                <>
                  <span className="text-xs font-semibold text-danger uppercase tracking-wider">
                    {game.inningHalf === "top" ? "▲" : "▼"} {game.inning}
                  </span>
                  <span className="text-[10px] text-mercury">{game.outs} out{game.outs !== 1 ? "s" : ""}</span>
                </>
              )}
            </div>
          ) : game.status === "final" ? (
            <span className="text-xs font-semibold text-mercury uppercase tracking-wider">Final</span>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-mercury">
              <Clock className="w-3 h-3" />
              {game.startTime ? formatTime(game.startTime) : "TBD"}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <WeatherBadge team={game.homeAbbrev} sport={(currentSport as "mlb" | "nba")} />
          {oddsInfo?.arbCount && oddsInfo.arbCount > 0 && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 bg-gold/15 border border-gold/30 rounded text-gold text-[10px] font-bold">
              <Zap className="w-2.5 h-2.5" /> ARB
            </span>
          )}
          {oddsInfo?.topEV && oddsInfo.topEV > 3 && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 bg-neon/10 border border-neon/25 rounded text-neon text-[10px] font-bold">
              <TrendingUp className="w-2.5 h-2.5" /> +EV
            </span>
          )}
          <ChevronRight className={`w-4 h-4 text-mercury transition-transform ${isSelected ? "rotate-90" : ""}`} />
        </div>
      </div>

      {/* Matchup */}
      <div className="px-3 sm:px-4 py-2.5 sm:py-3 space-y-2 sm:space-y-2.5">
        {/* Away Team */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 flex-1">
            <TeamLogo team={game.awayAbbrev} size={24} className="sm:!w-7 sm:!h-7" />
            <div className="min-w-0 flex-1">
              <p className="text-sm sm:text-base font-bold text-silver leading-tight truncate">
                <span className="sm:hidden">{game.awayAbbrev}</span>
                <span className="hidden sm:inline">{awayFull}</span>
              </p>
              {!isNBA && <div className="hidden sm:block"><PitcherFace name={game.awayPitcher} pitcherId={game.awayPitcherId} /></div>}
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            {oddsInfo?.bestAwayML && (
              <span className={`text-[11px] sm:text-sm font-mono font-semibold ${
                oddsInfo.bestAwayML.odds > 0 ? "text-neon" : "text-silver"
              }`}>
                {formatOdds(oddsInfo.bestAwayML.odds)}
              </span>
            )}
            {(game.status === "live" || game.status === "final") && (
              <span className={`text-lg sm:text-xl font-bold font-mono w-6 sm:w-8 text-right ${
                game.awayScore > game.homeScore ? "text-neon" : "text-silver"
              }`}>
                {game.awayScore}
              </span>
            )}
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-slate/15 mx-1" />

        {/* Home Team */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 flex-1">
            <TeamLogo team={game.homeAbbrev} size={24} className="sm:!w-7 sm:!h-7" />
            <div className="min-w-0 flex-1">
              <p className="text-sm sm:text-base font-bold text-silver leading-tight truncate">
                <span className="sm:hidden">{game.homeAbbrev}</span>
                <span className="hidden sm:inline">{homeFull}</span>
              </p>
              {!isNBA && <div className="hidden sm:block"><PitcherFace name={game.homePitcher} pitcherId={game.homePitcherId} /></div>}
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            {oddsInfo?.bestHomeML && (
              <span className={`text-[11px] sm:text-sm font-mono font-semibold ${
                oddsInfo.bestHomeML.odds > 0 ? "text-neon" : "text-silver"
              }`}>
                {formatOdds(oddsInfo.bestHomeML.odds)}
              </span>
            )}
            {(game.status === "live" || game.status === "final") && (
              <span className={`text-lg sm:text-xl font-bold font-mono w-6 sm:w-8 text-right ${
                game.homeScore > game.awayScore ? "text-neon" : "text-silver"
              }`}>
                {game.homeScore}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Footer — desktop only; mobile hides venue for density */}
      {(game.venue || (!isNBA && game.weather)) && (
        <div className="hidden sm:flex items-center gap-3 px-4 py-2 border-t border-slate/30 text-[11px] text-mercury/60">
          {game.venue ? (
            <div className="flex items-center gap-1 truncate">
              <MapPin className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{game.venue}</span>
            </div>
          ) : null}
          {!isNBA && game.weather && (
            <div className="flex items-center gap-1 flex-shrink-0">
              <Cloud className="w-3 h-3" />
              {game.weather.temp}° {game.weather.wind}
            </div>
          )}
        </div>
      )}
    </button>
  );
}
