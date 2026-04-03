"use client";

import { Zap, DollarSign, Trophy } from "lucide-react";
import type { ArbitrageOpportunity } from "@/lib/model/types";
import { useState } from "react";

interface ArbitrageAlertProps {
  arbitrage: ArbitrageOpportunity[];
}

export default function ArbitrageAlert({ arbitrage }: ArbitrageAlertProps) {
  const [expanded, setExpanded] = useState(false);

  if (arbitrage.length === 0) return null;

  const formatOdds = (odds: number) => (odds > 0 ? `+${odds}` : `${odds}`);

  return (
    <div className="glass rounded-xl overflow-hidden border border-gold/20">
      {/* Compact header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 sm:px-4 py-2 flex items-center gap-2 bg-gold/5 hover:bg-gold/10 transition-colors"
      >
        <div className="relative flex-shrink-0">
          <Zap className="w-4 h-4 text-gold" />
          <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-gold opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-gold" />
          </span>
        </div>
        <span className="text-xs font-bold text-gold uppercase tracking-wider">ARB ALERT</span>
        <span className="text-[10px] text-gold/70">{arbitrage.length} {arbitrage.length === 1 ? "opp" : "opps"}</span>

        {/* Preview of best arb inline */}
        <div className="hidden sm:flex items-center gap-2 ml-auto">
          <span className="text-[11px] text-mercury truncate max-w-[200px]">{arbitrage[0].game}</span>
          <span className="text-xs font-bold font-mono text-gold">+{arbitrage[0].profit.toFixed(2)}%</span>
        </div>

        <span className="text-[10px] text-mercury/50 ml-auto sm:ml-2">{expanded ? "Hide" : "Details"}</span>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="p-2.5 sm:p-3 space-y-2 animate-slide-up border-t border-gold/10">
          {arbitrage.map((arb, i) => (
            <div key={i} className="flex items-center gap-2 sm:gap-3 px-2.5 py-2 rounded-lg bg-bunker/60 border border-gold/10">
              <Trophy className="w-3.5 h-3.5 text-gold flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-mercury truncate">{arb.game}</p>
                <p className="text-[10px] text-mercury/50">
                  {arb.side1.pick} @ {arb.side1.bookmaker} ({formatOdds(arb.side1.odds)}) vs {arb.side2.pick} @ {arb.side2.bookmaker} ({formatOdds(arb.side2.odds)})
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-xs font-bold font-mono text-gold">+{arb.profit.toFixed(2)}%</p>
                <p className="text-[9px] text-mercury/50">${arb.stake1.toFixed(0)} / ${arb.stake2.toFixed(0)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
