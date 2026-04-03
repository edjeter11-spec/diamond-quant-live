"use client";

import { useState, useEffect } from "react";
import { Brain, Cpu, TrendingUp, Target, Zap, RefreshCw, BarChart3 } from "lucide-react";
import { loadLearningState, type LearningState } from "@/lib/bot/learning";

export default function ModelBrain() {
  const [state, setState] = useState<LearningState | null>(null);

  useEffect(() => {
    setState(loadLearningState());
  }, []);

  if (!state) return null;

  const markets = Object.values(state.marketAccuracy).filter((m) => m.totalBets > 0);
  const totalBets = markets.reduce((s, m) => s + m.totalBets, 0);

  // Don't show if no data yet
  if (totalBets === 0 && state.epoch === 0) return null;

  const timeSinceOptimized = state.lastOptimized
    ? Math.floor((Date.now() - new Date(state.lastOptimized).getTime()) / 60000)
    : 0;

  return (
    <div className="glass rounded-xl overflow-hidden border border-electric/10">
      {/* Header */}
      <div className="px-3 sm:px-4 py-2.5 border-b border-slate/30 bg-electric/5 flex items-center gap-2">
        <div className="relative">
          <Cpu className="w-4 h-4 text-electric" />
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-neon rounded-full animate-pulse" />
        </div>
        <div className="flex-1">
          <span className="text-xs font-bold text-silver uppercase tracking-wider">Model Intelligence</span>
        </div>
        <span className="text-[10px] font-mono text-electric">{state.version}</span>
      </div>

      <div className="px-3 sm:px-4 py-3 space-y-3">
        {/* Status line */}
        <div className="flex items-center gap-3 text-[11px]">
          <div className="flex items-center gap-1 text-mercury">
            <Brain className="w-3 h-3 text-electric" />
            <span>Trained on <span className="text-silver font-semibold">{state.gamesLearned}</span> bets</span>
          </div>
          <div className="flex items-center gap-1 text-mercury">
            <RefreshCw className="w-3 h-3 text-neon" />
            <span>Optimized {timeSinceOptimized < 60 ? `${timeSinceOptimized}m ago` : `${Math.floor(timeSinceOptimized / 60)}h ago`}</span>
          </div>
          <div className="flex items-center gap-1 text-mercury">
            <Zap className="w-3 h-3 text-amber" />
            <span>Epoch {state.epoch}</span>
          </div>
        </div>

        {/* Market accuracy breakdown */}
        {markets.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[9px] text-mercury uppercase tracking-wider font-semibold">Accuracy by Market (auto-adjusting thresholds)</p>
            {markets.map((m) => {
              const winRate = m.totalBets > 0 ? (m.wins / m.totalBets) * 100 : 0;
              const isGood = winRate > 52;
              return (
                <div key={m.market} className="flex items-center gap-2">
                  <span className="text-[10px] text-mercury w-20 truncate capitalize">{m.market.replace("_", " ")}</span>
                  <div className="flex-1 h-1.5 bg-gunmetal rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${isGood ? "bg-neon/60" : "bg-amber/60"}`}
                      style={{ width: `${Math.min(winRate, 100)}%` }}
                    />
                  </div>
                  <span className={`text-[10px] font-mono w-10 text-right ${isGood ? "text-neon" : "text-amber"}`}>
                    {winRate.toFixed(0)}%
                  </span>
                  <span className="text-[9px] text-mercury/50 w-14 text-right">
                    min {m.dynamicThreshold.toFixed(1)}%
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Weight visualization */}
        <div>
          <p className="text-[9px] text-mercury uppercase tracking-wider font-semibold mb-1.5">Current Model Weights</p>
          <div className="flex gap-1">
            {Object.entries(state.weights).map(([key, val]) => (
              <div key={key} className="flex-1 text-center">
                <div className="h-8 flex items-end justify-center">
                  <div
                    className="w-full rounded-t bg-electric/40"
                    style={{ height: `${val * 300}%` }}
                  />
                </div>
                <p className="text-[7px] text-mercury/50 mt-0.5 truncate">{key.slice(0, 4)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
