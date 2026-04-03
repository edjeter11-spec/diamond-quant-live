"use client";

import { Shield, TrendingUp, DollarSign, ChevronDown, ChevronUp, Brain, AlertTriangle, Target } from "lucide-react";
import { useState } from "react";

interface QuantVerdictProps {
  game: {
    homeTeam: string;
    awayTeam: string;
  };
  analysis: {
    winProb: number;
    evPercentage: number;
    kellyStake: number;
    confidence: "HIGH" | "MEDIUM" | "LOW" | "NO_EDGE";
    pick: string;
    fairOdds: number;
    marketOdds: number;
    reasoning: string[];
    bookmaker: string;
  } | null;
}

export default function QuantVerdict({ game, analysis }: QuantVerdictProps) {
  const [showReasoning, setShowReasoning] = useState(false);

  if (!analysis) {
    return (
      <div className="glass rounded-xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <Brain className="w-5 h-5 text-electric" />
          <h3 className="text-sm font-semibold text-silver uppercase tracking-wide">Quant Verdict</h3>
        </div>
        <p className="text-mercury text-sm">Select a game to see the model's analysis</p>
      </div>
    );
  }

  const confidenceColors = {
    HIGH: { bg: "bg-neon/10", border: "border-neon/30", text: "text-neon", glow: "glow-neon" },
    MEDIUM: { bg: "bg-electric/10", border: "border-electric/30", text: "text-electric", glow: "glow-electric" },
    LOW: { bg: "bg-amber/10", border: "border-amber/30", text: "text-amber", glow: "" },
    NO_EDGE: { bg: "bg-mercury/10", border: "border-mercury/30", text: "text-mercury", glow: "" },
  };

  const conf = confidenceColors[analysis.confidence];
  const formatOdds = (odds: number) => (odds > 0 ? `+${odds}` : `${odds}`);

  return (
    <div className={`glass rounded-xl overflow-hidden ${analysis.confidence === "HIGH" ? "glow-neon" : ""}`}>
      {/* Header */}
      <div className={`px-4 py-3 border-b border-slate/50 ${conf.bg}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-electric" />
            <h3 className="text-sm font-semibold text-silver uppercase tracking-wide">Quant Verdict</h3>
          </div>
          <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${conf.bg} ${conf.border} ${conf.text} border`}>
            {analysis.confidence} confidence
          </span>
        </div>
      </div>

      {/* Main Verdict */}
      <div className="p-4 sm:p-5">
        <div className="text-center mb-4 sm:mb-6">
          <p className="text-xs sm:text-sm text-mercury mb-1">{game.awayTeam} @ {game.homeTeam}</p>
          <p className={`text-xl sm:text-2xl font-bold ${conf.text} mb-1`}>{analysis.pick}</p>
          <p className="text-[11px] sm:text-xs text-mercury">Best price @ {analysis.bookmaker}</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-4 sm:mb-5">
          {/* Win Prob */}
          <div className="text-center p-2 sm:p-3 rounded-lg bg-gunmetal/50">
            <Target className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-electric mx-auto mb-1" />
            <p className="text-lg sm:text-2xl font-bold font-mono text-silver">
              {(analysis.winProb * 100).toFixed(1)}%
            </p>
            <p className="text-[9px] sm:text-[10px] text-mercury uppercase tracking-wider mt-0.5">Win Prob</p>
          </div>

          {/* EV */}
          <div className="text-center p-2 sm:p-3 rounded-lg bg-gunmetal/50">
            <TrendingUp className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-neon mx-auto mb-1" />
            <p className={`text-lg sm:text-2xl font-bold font-mono ${analysis.evPercentage > 0 ? "text-neon" : "text-danger"}`}>
              {analysis.evPercentage > 0 ? "+" : ""}{analysis.evPercentage.toFixed(1)}%
            </p>
            <p className="text-[9px] sm:text-[10px] text-mercury uppercase tracking-wider mt-0.5">EV Edge</p>
          </div>

          {/* Kelly */}
          <div className="text-center p-2 sm:p-3 rounded-lg bg-gunmetal/50">
            <DollarSign className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-gold mx-auto mb-1" />
            <p className="text-lg sm:text-2xl font-bold font-mono text-gold">
              ${analysis.kellyStake.toFixed(0)}
            </p>
            <p className="text-[9px] sm:text-[10px] text-mercury uppercase tracking-wider mt-0.5">Kelly</p>
          </div>
        </div>

        {/* Odds Comparison */}
        <div className="flex items-center justify-between px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg bg-gunmetal/30 mb-3 sm:mb-4">
          <div className="text-center">
            <p className="text-xs text-mercury">Market</p>
            <p className="text-lg font-mono font-bold text-silver">{formatOdds(analysis.marketOdds)}</p>
          </div>
          <div className="flex flex-col items-center">
            <span className={`text-xs ${analysis.evPercentage > 0 ? "text-neon" : "text-danger"}`}>
              {analysis.evPercentage > 0 ? "VALUE" : "NO EDGE"}
            </span>
            <div className="w-8 h-px bg-slate mt-1" />
          </div>
          <div className="text-center">
            <p className="text-xs text-mercury">Fair</p>
            <p className="text-lg font-mono font-bold text-electric">{formatOdds(analysis.fairOdds)}</p>
          </div>
        </div>

        {/* Reasoning Dropdown */}
        <button
          onClick={() => setShowReasoning(!showReasoning)}
          className="w-full flex items-center justify-between px-4 py-2.5 rounded-lg bg-gunmetal/30 hover:bg-gunmetal/50 transition-colors"
        >
          <span className="text-sm text-mercury font-medium">Why this bet?</span>
          {showReasoning ? (
            <ChevronUp className="w-4 h-4 text-mercury" />
          ) : (
            <ChevronDown className="w-4 h-4 text-mercury" />
          )}
        </button>

        {showReasoning && (
          <div className="mt-2 px-4 py-3 rounded-lg bg-gunmetal/20 space-y-2 animate-slide-up">
            {analysis.reasoning.map((reason, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-neon mt-0.5 text-xs">{'>'}</span>
                <p className="text-sm text-mercury">{reason}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
