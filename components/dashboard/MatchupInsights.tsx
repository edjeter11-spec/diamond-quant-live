"use client";

import { useMemo } from "react";
import { TrendingUp, TrendingDown, Minus, Target, Home, Plane, Zap, AlertTriangle } from "lucide-react";

interface MatchupInsightsProps {
  playerName: string;
  market: string;             // e.g. pitcher_strikeouts, player_points
  line: number;
  /** Past games list — different shapes for MLB vs NBA */
  gameLog: Array<Record<string, any>>;
  /** Optional season-level snapshot for context */
  seasonAvg?: number;
  /** Optional vs-opponent summary */
  vsOpponent?: { games: number; avgStat: number; trend: string };
  /** Player bio context */
  position?: string;
  isHomeTonight?: boolean;
}

const MARKET_STAT_KEY: Record<string, string> = {
  pitcher_strikeouts: "strikeouts",
  batter_hits: "hitsB",
  batter_total_bases: "totalBases",
  batter_home_runs: "homeRuns",
  batter_rbis: "rbi",
  batter_runs_scored: "runs",
  player_points: "points",
  player_rebounds: "rebounds",
  player_assists: "assists",
};

function getStat(g: Record<string, any>, market: string): number {
  const key = MARKET_STAT_KEY[market] ?? "value";
  const v = g[key] ?? g["stat"] ?? 0;
  return Number.isFinite(v) ? v : 0;
}

export default function MatchupInsights({
  playerName, market, line, gameLog, seasonAvg, vsOpponent, isHomeTonight,
}: MatchupInsightsProps) {
  const insights = useMemo(() => {
    const log = (gameLog ?? []).filter(Boolean);
    if (log.length === 0) return null;

    const last10 = log.slice(0, 10);
    const last5 = log.slice(0, 5);
    const last3 = log.slice(0, 3);

    const valueList = last10.map(g => getStat(g, market));
    const l10Avg = valueList.reduce((s, v) => s + v, 0) / valueList.length;
    const l5Avg = last5.length > 0 ? last5.reduce((s, g) => s + getStat(g, market), 0) / last5.length : 0;
    const l3Avg = last3.length > 0 ? last3.reduce((s, g) => s + getStat(g, market), 0) / last3.length : 0;

    // Hit rate at this specific line
    const hitL10 = valueList.filter(v => v >= line).length;
    const hitL5 = last5.filter(g => getStat(g, market) >= line).length;

    // Home / Road splits (if game log has isHome flag)
    const homeGames = log.filter(g => g.isHome === true || g.venue?.toLowerCase?.().includes("home"));
    const awayGames = log.filter(g => g.isHome === false);
    const homeAvg = homeGames.length > 0 ? homeGames.reduce((s, g) => s + getStat(g, market), 0) / homeGames.length : null;
    const awayAvg = awayGames.length > 0 ? awayGames.reduce((s, g) => s + getStat(g, market), 0) / awayGames.length : null;

    // Trend — compare last 3 to season
    const seasonReference = seasonAvg ?? l10Avg;
    const trendPct = seasonReference > 0 ? ((l3Avg - seasonReference) / seasonReference) * 100 : 0;

    // Advice bullets — dynamic based on signals
    const advice: string[] = [];

    // Hit-rate signals
    if (hitL10 >= 7) advice.push(`Hot streak: cleared this line in ${hitL10}/${valueList.length} of last games`);
    else if (hitL10 <= 3 && valueList.length >= 6) advice.push(`Cold vs this line: cleared ${hitL10}/${valueList.length} recently`);

    // Trend
    if (trendPct > 15) advice.push(`Recent form ↑ ${trendPct.toFixed(0)}% vs season — hot hand`);
    else if (trendPct < -15) advice.push(`Recent form ↓ ${Math.abs(trendPct).toFixed(0)}% vs season — regression spot`);

    // Home/road split
    if (homeAvg != null && awayAvg != null && Math.abs(homeAvg - awayAvg) > line * 0.15) {
      const strongerAtHome = homeAvg > awayAvg;
      if (isHomeTonight === strongerAtHome) {
        advice.push(`Plays well at ${strongerAtHome ? "home" : "away"}: ${(strongerAtHome ? homeAvg : awayAvg).toFixed(1)} avg (+${Math.abs(homeAvg - awayAvg).toFixed(1)} vs other side)`);
      } else if (isHomeTonight !== undefined) {
        advice.push(`Weaker ${isHomeTonight ? "at home" : "on road"}: ${(isHomeTonight ? homeAvg : awayAvg).toFixed(1)} avg`);
      }
    }

    // vs Opponent
    if (vsOpponent && vsOpponent.games >= 2) {
      const vsLine = vsOpponent.avgStat >= line;
      advice.push(`vs this opponent (${vsOpponent.games}g): averages ${vsOpponent.avgStat.toFixed(1)} — ${vsLine ? "trends OVER" : "trends UNDER"}`);
    }

    // Line consistency check
    const variance = valueList.length > 1
      ? Math.sqrt(valueList.reduce((s, v) => s + Math.pow(v - l10Avg, 2), 0) / valueList.length)
      : 0;
    if (variance > l10Avg * 0.4 && l10Avg > 0) {
      advice.push(`Volatile — swings ±${variance.toFixed(1)} around ${l10Avg.toFixed(1)} avg. Risky either side.`);
    } else if (variance < l10Avg * 0.15 && l10Avg > 0) {
      advice.push(`Consistent producer (low variance) — projection is reliable`);
    }

    return {
      l10Avg: Math.round(l10Avg * 10) / 10,
      l5Avg: Math.round(l5Avg * 10) / 10,
      l3Avg: Math.round(l3Avg * 10) / 10,
      hitL10, hitL5,
      hitRateL10: Math.round((hitL10 / valueList.length) * 100),
      hitRateL5: last5.length > 0 ? Math.round((hitL5 / last5.length) * 100) : 0,
      trendPct: Math.round(trendPct),
      homeAvg: homeAvg != null ? Math.round(homeAvg * 10) / 10 : null,
      awayAvg: awayAvg != null ? Math.round(awayAvg * 10) / 10 : null,
      advice,
      variance: Math.round(variance * 10) / 10,
    };
  }, [gameLog, market, line, seasonAvg, vsOpponent, isHomeTonight]);

  if (!insights) return null;

  const trendIcon = insights.trendPct > 8 ? TrendingUp : insights.trendPct < -8 ? TrendingDown : Minus;
  const TrendIcon = trendIcon;
  const trendColor = insights.trendPct > 8 ? "text-neon" : insights.trendPct < -8 ? "text-danger" : "text-mercury";

  return (
    <div className="rounded-lg bg-gunmetal/30 border border-electric/15 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Target className="w-3.5 h-3.5 text-electric" />
        <p className="text-[11px] text-electric uppercase tracking-wider font-bold">Matchup Insights</p>
      </div>

      {/* Rolling averages */}
      <div className="grid grid-cols-4 gap-1.5 text-center">
        <div className="p-1.5 rounded bg-bunker/60 border border-slate/20">
          <p className="text-[9px] text-mercury/60 uppercase">L3</p>
          <p className={`text-sm font-bold font-mono ${insights.l3Avg >= line ? "text-neon" : "text-mercury"}`}>{insights.l3Avg}</p>
        </div>
        <div className="p-1.5 rounded bg-bunker/60 border border-slate/20">
          <p className="text-[9px] text-mercury/60 uppercase">L5</p>
          <p className={`text-sm font-bold font-mono ${insights.l5Avg >= line ? "text-neon" : "text-mercury"}`}>{insights.l5Avg}</p>
        </div>
        <div className="p-1.5 rounded bg-bunker/60 border border-slate/20">
          <p className="text-[9px] text-mercury/60 uppercase">L10</p>
          <p className={`text-sm font-bold font-mono ${insights.l10Avg >= line ? "text-neon" : "text-mercury"}`}>{insights.l10Avg}</p>
        </div>
        <div className="p-1.5 rounded bg-bunker/60 border border-slate/20">
          <p className="text-[9px] text-mercury/60 uppercase">Line</p>
          <p className="text-sm font-bold font-mono text-electric">{line}</p>
        </div>
      </div>

      {/* Hit rate + trend chips */}
      <div className="flex flex-wrap gap-2">
        <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-bunker/60 border border-slate/20">
          <span className="text-[10px] text-mercury/60">Hit L10:</span>
          <span className={`text-[11px] font-bold font-mono ${
            insights.hitRateL10 >= 70 ? "text-neon" : insights.hitRateL10 >= 50 ? "text-amber" : "text-danger"
          }`}>
            {insights.hitL10}/10 ({insights.hitRateL10}%)
          </span>
        </div>
        <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-bunker/60 border border-slate/20">
          <TrendIcon className={`w-3 h-3 ${trendColor}`} />
          <span className="text-[10px] text-mercury/60">Trend:</span>
          <span className={`text-[11px] font-bold font-mono ${trendColor}`}>
            {insights.trendPct >= 0 ? "+" : ""}{insights.trendPct}%
          </span>
        </div>
        {insights.homeAvg != null && insights.awayAvg != null && (
          <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-bunker/60 border border-slate/20">
            <Home className="w-3 h-3 text-mercury/60" />
            <span className="text-[11px] font-mono text-silver">{insights.homeAvg}</span>
            <Plane className="w-3 h-3 text-mercury/60 ml-1" />
            <span className="text-[11px] font-mono text-silver">{insights.awayAvg}</span>
          </div>
        )}
      </div>

      {/* Dynamic advice bullets */}
      {insights.advice.length > 0 && (
        <div className="pt-2 border-t border-slate/15 space-y-1">
          <div className="flex items-center gap-1.5 mb-1">
            <Zap className="w-3 h-3 text-gold" />
            <p className="text-[10px] text-gold uppercase tracking-wider font-bold">Advice</p>
          </div>
          <ul className="space-y-1">
            {insights.advice.slice(0, 5).map((note, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[11px] text-silver">
                <span className="text-electric mt-0.5">·</span>
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
