"use client";

import { useState, useEffect } from "react";
import { useStore } from "@/lib/store";
import { useSport } from "@/lib/sport-context";
import {
  Bot, Brain, TrendingUp, BarChart3, Target, ChevronDown,
  RefreshCw, CheckCircle, XCircle, Minus, AlertTriangle,
  Zap, Shield, Activity, Clock, ExternalLink, Crown,
} from "lucide-react";
import { getDeepLink } from "@/lib/odds/sportsbooks";
import TeamLogo from "@/components/ui/TeamLogo";
import type { GameAnalysis, GamePick } from "@/lib/bot/three-models";

export default function ThreeModelBot() {
  const { currentSport, config } = useSport();
  const [analyses, setAnalyses] = useState<GameAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedGame, setExpandedGame] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchAnalysis();
  }, [currentSport]);

  async function fetchAnalysis() {
    setLoading(true);
    setError("");
    try {
      const url = currentSport === "nba" ? "/api/nba-analysis" : "/api/bot-analysis";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Analysis failed");
      const data = await res.json();
      setAnalyses(data.analyses ?? []);
    } catch (err: any) {
      setError(err.message ?? "Failed to load");
    }
    setLoading(false);
  }

  const formatOdds = (odds: number) => {
    if (odds === 0 || odds === -999) return "—";
    return odds > 0 ? `+${odds}` : `${odds}`;
  };

  const confColors: Record<string, { bg: string; text: string; border: string }> = {
    HIGH: { bg: "bg-neon/10", text: "text-neon", border: "border-neon/20" },
    MEDIUM: { bg: "bg-electric/10", text: "text-electric", border: "border-electric/20" },
    LOW: { bg: "bg-amber/10", text: "text-amber", border: "border-amber/20" },
    NO_PLAY: { bg: "bg-mercury/10", text: "text-mercury", border: "border-mercury/20" },
  };

  if (loading) {
    return (
      <div className="glass rounded-xl p-8 text-center">
        <div className="flex items-center justify-center gap-3 mb-3">
          <Brain className="w-5 h-5 text-electric animate-pulse" />
          <BarChart3 className="w-5 h-5 text-purple animate-pulse" />
          <TrendingUp className="w-5 h-5 text-neon animate-pulse" />
        </div>
        <p className="text-sm text-silver font-medium">Running 3 models on every game...</p>
        <p className="text-[10px] text-mercury/60 mt-1">Net Rating + Market consensus + Power ranking analysis</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="glass rounded-xl p-4 border border-electric/15">
        <div className="flex items-center gap-2 mb-2">
          <Bot className="w-5 h-5 text-electric" />
          <h2 className="text-sm font-bold text-silver uppercase tracking-wider">3-Model Analysis</h2>
          <button onClick={fetchAnalysis} className="ml-auto p-1.5 hover:bg-gunmetal/30 rounded transition-colors">
            <RefreshCw className={`w-3.5 h-3.5 text-mercury ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
        <div className="flex items-center gap-4 text-[10px]">
          <div className="flex items-center gap-1">
            <Brain className="w-3 h-3 text-purple" />
            <span className="text-mercury">{config.model1Label} Model</span>
          </div>
          <div className="flex items-center gap-1">
            <BarChart3 className="w-3 h-3 text-electric" />
            <span className="text-mercury">Market Model</span>
          </div>
          <div className="flex items-center gap-1">
            <TrendingUp className="w-3 h-3 text-neon" />
            <span className="text-mercury">{config.model3Label} Model</span>
          </div>
        </div>
        <p className="text-[10px] text-mercury/50 mt-1">
          When all 3 agree → HIGH confidence. When they disagree → that's where the edge is.
        </p>
      </div>

      {error && (
        <div className="glass rounded-xl p-4 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-danger" />
          <p className="text-xs text-danger">{error}</p>
        </div>
      )}

      {analyses.length === 0 && !error && (
        <div className="glass rounded-xl p-6 text-center">
          <p className="text-sm text-mercury">No games to analyze right now</p>
          <p className="text-[10px] text-mercury/50 mt-1">Check back when today's slate has odds posted</p>
        </div>
      )}

      {/* Game Cards */}
      {analyses.map((game) => {
        const isExpanded = expandedGame === game.gameId;
        const conf = confColors[game.consensus.confidence] ?? confColors.LOW;
        const topPick = game.picks[0];

        return (
          <div key={game.gameId} className={`glass rounded-xl overflow-hidden ${game.consensus.confidence === "HIGH" ? "border border-neon/15" : ""}`}>
            {/* Game Row */}
            <button
              onClick={() => setExpandedGame(isExpanded ? null : game.gameId)}
              className="w-full px-3 sm:px-4 py-3 flex items-center gap-2 hover:bg-gunmetal/20 transition-colors text-left"
            >
              {/* Confidence dot */}
              <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                game.consensus.confidence === "HIGH" ? "bg-neon" :
                game.consensus.confidence === "MEDIUM" ? "bg-electric" :
                game.consensus.confidence === "NO_PLAY" ? "bg-mercury/30" : "bg-amber"
              }`} />

              {/* Matchup */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-xs sm:text-sm font-semibold text-silver truncate">
                    <TeamLogo team={game.awayTeam} size={16} />
                    {game.awayTeam} @ {game.homeTeam}
                    <TeamLogo team={game.homeTeam} size={16} />
                  </p>
                  {game.consensus.confidence === "HIGH" && <Crown className="w-3 h-3 text-gold flex-shrink-0" />}
                  {!game.consensus.modelsAgree && (
                    <span className="text-[8px] px-1 py-0.5 rounded bg-amber/10 text-amber font-bold flex-shrink-0">SPLIT</span>
                  )}
                </div>
                <p className="text-[9px] sm:text-[10px] text-mercury/60">
                  {new Date(game.commenceTime).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  {game.homePitcher && game.awayPitcher && ` — ${game.awayPitcher.name} vs ${game.homePitcher.name}`}
                </p>
              </div>

              {/* Model scores preview */}
              <div className="hidden sm:flex items-center gap-1 flex-shrink-0">
                <span className="text-[9px] font-mono text-purple" title={config.model1Label}>{(game.pitcherModel.homeWinProb * 100).toFixed(0)}%</span>
                <span className="text-mercury/30">|</span>
                <span className="text-[9px] font-mono text-electric" title="Market Model">{(game.marketModel.homeWinProb * 100).toFixed(0)}%</span>
                <span className="text-mercury/30">|</span>
                <span className="text-[9px] font-mono text-neon" title="Trend Model">{(game.trendModel.homeWinProb * 100).toFixed(0)}%</span>
              </div>

              {/* Best pick */}
              {topPick && (
                <div className="text-right flex-shrink-0">
                  <p className="text-xs font-mono font-bold text-silver">{formatOdds(topPick.odds)}</p>
                  <p className={`text-[9px] font-bold ${conf.text}`}>{game.consensus.confidence}</p>
                </div>
              )}

              <ChevronDown className={`w-3.5 h-3.5 text-mercury/40 flex-shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
            </button>

            {/* Expanded Analysis */}
            {isExpanded && (
              <div className="px-3 sm:px-4 pb-4 animate-slide-up space-y-3">
                {/* 3 Model Comparison */}
                <div className="grid grid-cols-3 gap-2">
                  <ModelCard
                    name="Pitcher"
                    icon={Brain}
                    color="text-purple"
                    model={game.pitcherModel}
                  />
                  <ModelCard
                    name="Market"
                    icon={BarChart3}
                    color="text-electric"
                    model={game.marketModel}
                  />
                  <ModelCard
                    name="Trend"
                    icon={TrendingUp}
                    color="text-neon"
                    model={game.trendModel}
                  />
                </div>

                {/* Consensus */}
                <div className={`p-3 rounded-lg ${conf.bg} border ${conf.border}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs font-bold ${conf.text}`}>
                      CONSENSUS: {(game.consensus.homeWinProb * 100).toFixed(1)}% {game.homeTeam}
                    </span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${conf.bg} ${conf.text}`}>
                      {game.consensus.confidence}
                    </span>
                  </div>
                  <p className="text-[10px] text-mercury">
                    {game.consensus.modelsAgree
                      ? "All 3 models agree on the same side"
                      : `Models disagree (spread: ${(game.consensus.disagreementLevel * 100).toFixed(0)}%) — be cautious`
                    }
                  </p>
                </div>

                {/* Pitcher Matchup */}
                {(game.homePitcher || game.awayPitcher) && (
                  <div className="rounded-lg bg-gunmetal/20 p-3">
                    <p className="text-[9px] text-mercury uppercase tracking-wider mb-2 font-semibold">Pitcher Matchup</p>
                    <div className="grid grid-cols-2 gap-3">
                      {game.awayPitcher && (
                        <PitcherCard pitcher={game.awayPitcher} team={game.awayTeam} side="Away" />
                      )}
                      {game.homePitcher && (
                        <PitcherCard pitcher={game.homePitcher} team={game.homeTeam} side="Home" />
                      )}
                    </div>
                  </div>
                )}

                {/* All Factors */}
                <div className="rounded-lg bg-gunmetal/20 p-3">
                  <p className="text-[9px] text-mercury uppercase tracking-wider mb-2 font-semibold flex items-center gap-1">
                    <Target className="w-3 h-3" /> All Factors
                  </p>
                  <div className="space-y-0.5 max-h-40 overflow-y-auto">
                    {[...game.pitcherModel.factors, ...game.marketModel.factors, ...game.trendModel.factors].map((f, i) => (
                      <p key={i} className="text-[11px] text-mercury flex gap-1">
                        <span className="text-electric">{'>'}</span> {f}
                      </p>
                    ))}
                  </div>
                </div>

                {/* Picks */}
                {game.picks.map((pick, i) => (
                  <div key={i} className="flex gap-2">
                    {getDeepLink(pick.bookmaker) && (
                      <a
                        href={getDeepLink(pick.bookmaker)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 py-2.5 rounded-lg bg-electric/10 border border-electric/20 text-electric text-xs font-semibold hover:bg-electric/20 transition-all flex items-center justify-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        {pick.pick} ({formatOdds(pick.odds)}) @ {pick.bookmaker.split(" ")[0]}
                      </a>
                    )}
                    <button
                      onClick={() => {
                        const { addParlayLeg } = useStore.getState();
                        addParlayLeg({
                          game: `${game.awayTeam} @ ${game.homeTeam}`,
                          market: pick.market as any,
                          pick: pick.pick,
                          odds: pick.odds,
                          fairProb: pick.fairProb / 100,
                          bookmaker: pick.bookmaker,
                        });
                      }}
                      className="px-4 py-2.5 rounded-lg bg-neon/10 border border-neon/20 text-neon text-xs font-semibold hover:bg-neon/20 transition-all flex-shrink-0"
                    >
                      + Parlay
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ModelCard({ name, icon: Icon, color, model }: {
  name: string; icon: any; color: string; model: any;
}) {
  return (
    <div className="p-2 rounded-lg bg-gunmetal/30 text-center">
      <Icon className={`w-3.5 h-3.5 ${color} mx-auto mb-1`} />
      <p className="text-[9px] text-mercury uppercase">{name}</p>
      <p className={`text-base font-bold font-mono ${color}`}>
        {(model.homeWinProb * 100).toFixed(0)}%
      </p>
      <p className="text-[8px] text-mercury/50">home</p>
      <div className="w-full h-1 bg-gunmetal rounded-full mt-1 overflow-hidden">
        <div className={`h-full rounded-full ${color === "text-purple" ? "bg-purple/50" : color === "text-electric" ? "bg-electric/50" : "bg-neon/50"}`} style={{ width: `${model.confidence}%` }} />
      </div>
    </div>
  );
}

function PitcherCard({ pitcher, team, side }: { pitcher: any; team: string; side: string }) {
  return (
    <div>
      <p className="text-[10px] text-mercury/50 uppercase mb-0.5">{side}</p>
      <p className="text-xs font-semibold text-silver">{pitcher.name}</p>
      <div className="grid grid-cols-2 gap-1 mt-1 text-[9px]">
        <span className="text-mercury">ERA: <span className="text-silver font-mono">{pitcher.era.toFixed(2)}</span></span>
        <span className="text-mercury">WHIP: <span className="text-silver font-mono">{pitcher.whip.toFixed(2)}</span></span>
        <span className="text-mercury">K/9: <span className="text-silver font-mono">{pitcher.k9.toFixed(1)}</span></span>
        <span className="text-mercury">Rec: <span className="text-silver font-mono">{pitcher.record}</span></span>
      </div>
      {pitcher.vsOpponent && (
        <p className="text-[9px] text-electric mt-1">vs opponent: {pitcher.vsOpponent.era.toFixed(2)} ERA ({pitcher.vsOpponent.games}G)</p>
      )}
      {pitcher.fatigueRisk && (
        <p className="text-[9px] text-danger mt-0.5">Fatigue risk</p>
      )}
    </div>
  );
}
