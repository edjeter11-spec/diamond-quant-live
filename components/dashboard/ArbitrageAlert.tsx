"use client";

import { Zap, DollarSign, ArrowRight, Trophy } from "lucide-react";
import type { ArbitrageOpportunity } from "@/lib/model/types";

interface ArbitrageAlertProps {
  arbitrage: ArbitrageOpportunity[];
}

export default function ArbitrageAlert({ arbitrage }: ArbitrageAlertProps) {
  if (arbitrage.length === 0) {
    return (
      <div className="glass rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Zap className="w-5 h-5 text-gold" />
          <h3 className="text-sm font-semibold text-silver uppercase tracking-wide">Arbitrage Scanner</h3>
        </div>
        <div className="text-center py-6">
          <div className="w-12 h-12 rounded-full bg-gunmetal flex items-center justify-center mx-auto mb-3">
            <Zap className="w-6 h-6 text-mercury/50" />
          </div>
          <p className="text-sm text-mercury">No arbitrage opportunities found</p>
          <p className="text-xs text-mercury/60 mt-1">Scanning every 30 seconds</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl overflow-hidden arb-alert">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gold/20 bg-gold/5 flex items-center gap-2">
        <div className="relative">
          <Zap className="w-5 h-5 text-gold" />
          <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-gold opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-gold" />
          </span>
        </div>
        <h3 className="text-sm font-bold text-gold uppercase tracking-wider">
          GOLDEN ARBITRAGE DETECTED
        </h3>
        <span className="ml-auto text-xs font-mono text-gold/80">
          {arbitrage.length} {arbitrage.length === 1 ? "opp" : "opps"} found
        </span>
      </div>

      {/* Arb Cards */}
      <div className="p-3 space-y-3">
        {arbitrage.map((arb, i) => (
          <div key={i} className="bg-bunker/60 rounded-lg p-4 border border-gold/10">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-mercury">{arb.game}</span>
              <div className="flex items-center gap-1.5">
                <Trophy className="w-3.5 h-3.5 text-gold" />
                <span className="text-sm font-bold text-gold font-mono">
                  +{arb.profit.toFixed(2)}% guaranteed
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4">
              {/* Side 1 */}
              <div className="flex-1 p-3 rounded-lg bg-gunmetal/50 text-center">
                <p className="text-xs text-mercury mb-1">{arb.side1.bookmaker}</p>
                <p className="text-sm font-semibold text-silver">{arb.side1.pick}</p>
                <p className="text-lg font-bold font-mono text-neon">
                  {arb.side1.odds > 0 ? "+" : ""}{arb.side1.odds}
                </p>
                <p className="text-xs text-mercury mt-1">
                  <DollarSign className="w-3 h-3 inline" />{arb.stake1.toFixed(2)}
                </p>
              </div>

              <ArrowRight className="w-4 h-4 text-gold/50 flex-shrink-0" />

              {/* Side 2 */}
              <div className="flex-1 p-3 rounded-lg bg-gunmetal/50 text-center">
                <p className="text-xs text-mercury mb-1">{arb.side2.bookmaker}</p>
                <p className="text-sm font-semibold text-silver">{arb.side2.pick}</p>
                <p className="text-lg font-bold font-mono text-neon">
                  {arb.side2.odds > 0 ? "+" : ""}{arb.side2.odds}
                </p>
                <p className="text-xs text-mercury mt-1">
                  <DollarSign className="w-3 h-3 inline" />{arb.stake2.toFixed(2)}
                </p>
              </div>
            </div>

            <div className="mt-2 text-center">
              <span className="text-[10px] text-mercury/50">
                Hold: {arb.holdPercentage.toFixed(2)}% | Type: {arb.type}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
