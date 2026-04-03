"use client";

import { useStore } from "@/lib/store";
import { TrendingUp, Star, DollarSign, Shield, ChevronDown } from "lucide-react";
import { useState } from "react";
import type { EVBet } from "@/lib/model/types";

export default function EVBoard() {
  const { oddsData, addParlayLeg } = useStore();
  const [showAll, setShowAll] = useState(false);

  // Collect all EV bets across games
  const allEV: (EVBet & { gameId: string })[] = [];
  for (const game of oddsData) {
    if (game.evBets) {
      for (const bet of game.evBets) {
        allEV.push({ ...bet, gameId: game.id });
      }
    }
  }

  // Sort by EV
  allEV.sort((a, b) => b.evPercentage - a.evPercentage);
  const displayBets = showAll ? allEV : allEV.slice(0, 8);

  const formatOdds = (odds: number) => (odds > 0 ? `+${odds}` : `${odds}`);

  const confidenceIcon = (conf: string) => {
    switch (conf) {
      case "HIGH": return <Star className="w-3.5 h-3.5 text-gold fill-gold" />;
      case "MEDIUM": return <Star className="w-3.5 h-3.5 text-electric" />;
      case "LOW": return <Star className="w-3.5 h-3.5 text-mercury/50" />;
      default: return null;
    }
  };

  const handleAddToParlay = (bet: EVBet) => {
    addParlayLeg({
      game: bet.game,
      market: bet.market as any,
      pick: bet.pick,
      odds: bet.odds,
      fairProb: bet.fairProb / 100,
      bookmaker: bet.bookmaker,
    });
  };

  return (
    <div className="glass rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-neon" />
          <h3 className="text-sm font-semibold text-silver uppercase tracking-wide">+EV Board</h3>
          {allEV.length > 0 && (
            <span className="px-1.5 py-0.5 bg-neon/15 text-neon text-[10px] font-bold rounded">
              {allEV.length} edges
            </span>
          )}
        </div>
      </div>

      {allEV.length === 0 ? (
        <div className="p-6 text-center">
          <TrendingUp className="w-6 h-6 text-mercury/30 mx-auto mb-2" />
          <p className="text-sm text-mercury">No +EV opportunities found</p>
          <p className="text-xs text-mercury/60 mt-1">Model scanning all available lines</p>
        </div>
      ) : (
        <>
          <div className="divide-y divide-slate/10">
            {displayBets.map((bet, i) => (
              <button
                key={i}
                onClick={() => handleAddToParlay(bet)}
                className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gunmetal/30 transition-colors text-left group"
              >
                {/* Rank */}
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  i < 3 ? "bg-gold/15 text-gold" : "bg-gunmetal text-mercury"
                }`}>
                  {i + 1}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {confidenceIcon(bet.confidence)}
                    <p className="text-sm font-medium text-silver truncate">{bet.pick}</p>
                  </div>
                  <p className="text-xs text-mercury/60 truncate">{bet.game} • {bet.bookmaker}</p>
                </div>

                {/* Odds & EV */}
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-mono font-semibold text-silver">
                    {formatOdds(bet.odds)}
                  </p>
                  <p className="text-xs font-mono text-neon font-semibold">
                    +{bet.evPercentage.toFixed(1)}% EV
                  </p>
                </div>

                {/* Kelly */}
                <div className="text-right flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <p className="text-xs text-mercury">Kelly</p>
                  <p className="text-xs font-mono text-gold">${bet.kellyStake.toFixed(0)}</p>
                </div>
              </button>
            ))}
          </div>

          {allEV.length > 8 && (
            <button
              onClick={() => setShowAll(!showAll)}
              className="w-full px-4 py-2.5 border-t border-slate/30 flex items-center justify-center gap-1 text-xs text-mercury hover:text-silver transition-colors"
            >
              {showAll ? "Show less" : `Show all ${allEV.length} edges`}
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAll ? "rotate-180" : ""}`} />
            </button>
          )}
        </>
      )}
    </div>
  );
}
