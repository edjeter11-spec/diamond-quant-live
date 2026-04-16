"use client";
import { Brain, TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { BrainReasoning } from "@/lib/bot/prop-reasoning";

interface Props {
  reasoning: BrainReasoning;
  seasonAvg?: number;
  last5Avg?: number;
  projectedValue?: number;
  probability?: number;
}

export default function BrainPickDetail({ reasoning, projectedValue, probability }: Props) {
  const visibleFactors = reasoning.factors.filter(f => Math.abs(f.signal) > 0.05);
  const maxSignal = Math.max(...visibleFactors.map(f => Math.abs(f.signal)), 0.01);

  return (
    <div className="rounded-lg bg-gunmetal/30 border border-purple/15 p-3 space-y-2.5">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Brain className="w-3.5 h-3.5 text-purple flex-shrink-0" />
        <p className={`text-xs font-semibold ${reasoning.side === "over" ? "text-neon" : "text-purple"}`}>
          {reasoning.summary}
        </p>
      </div>

      {/* Key numbers */}
      <div className="grid grid-cols-3 gap-1.5">
        <div className="text-center p-1.5 rounded bg-bunker/50">
          <p className="text-sm font-bold font-mono text-silver">{reasoning.seasonAvg.toFixed(1)}</p>
          <p className="text-[9px] text-mercury/60 uppercase">Season Avg</p>
        </div>
        <div className="text-center p-1.5 rounded bg-bunker/50">
          <p className="text-sm font-bold font-mono text-silver">{reasoning.line}</p>
          <p className="text-[9px] text-mercury/60 uppercase">Line</p>
        </div>
        {projectedValue !== undefined ? (
          <div className="text-center p-1.5 rounded bg-bunker/50">
            <p className={`text-sm font-bold font-mono ${reasoning.side === "over" ? "text-neon" : "text-purple"}`}>
              {projectedValue.toFixed(1)}
            </p>
            <p className="text-[9px] text-mercury/60 uppercase">Projected</p>
          </div>
        ) : probability !== undefined ? (
          <div className="text-center p-1.5 rounded bg-bunker/50">
            <p className={`text-sm font-bold font-mono ${reasoning.side === "over" ? "text-neon" : "text-purple"}`}>
              {Math.round(probability * 100)}%
            </p>
            <p className="text-[9px] text-mercury/60 uppercase">Prob</p>
          </div>
        ) : null}
      </div>

      {/* Factor bars */}
      {visibleFactors.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[9px] text-mercury/50 uppercase tracking-wider font-semibold">Factor Breakdown</p>
          {visibleFactors.map(f => {
            const pct = Math.round((Math.abs(f.signal) / maxSignal) * 50);
            const isOver = f.direction === "over";
            const isUnder = f.direction === "under";
            return (
              <div key={f.name} className="space-y-0.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1 min-w-0">
                    {isOver ? (
                      <TrendingUp className="w-3 h-3 text-neon flex-shrink-0" />
                    ) : isUnder ? (
                      <TrendingDown className="w-3 h-3 text-purple flex-shrink-0" />
                    ) : (
                      <Minus className="w-3 h-3 text-mercury/40 flex-shrink-0" />
                    )}
                    <span className="text-[9px] text-mercury/70 truncate">{f.label}</span>
                  </div>
                  <span className={`text-[9px] font-mono flex-shrink-0 ${isOver ? "text-neon" : isUnder ? "text-purple" : "text-mercury/40"}`}>
                    {f.signal > 0 ? "+" : ""}{f.signal.toFixed(2)}
                  </span>
                </div>
                {/* Bar: centered, extends left (under) or right (over) */}
                <div className="flex items-center gap-0.5 h-1.5">
                  <div className="flex-1 flex justify-end">
                    {isUnder && (
                      <div
                        className="h-full rounded-l bg-purple/70"
                        style={{ width: `${pct}%` }}
                      />
                    )}
                  </div>
                  <div className="w-px h-full bg-slate/40 flex-shrink-0" />
                  <div className="flex-1">
                    {isOver && (
                      <div
                        className="h-full rounded-r bg-neon/70"
                        style={{ width: `${pct}%` }}
                      />
                    )}
                  </div>
                </div>
                <p className="text-[8px] text-mercury/40 leading-tight">{f.explanation}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
