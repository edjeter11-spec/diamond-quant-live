"use client";

import { useState, useEffect } from "react";
import { useStore } from "@/lib/store";
import {
  Ghost, Trophy, TrendingUp, TrendingDown, ChevronDown,
  Zap, Target, Shield, CheckCircle, XCircle, Minus, Clock,
  ArrowRightLeft, Crosshair, BarChart3, Crown,
} from "lucide-react";
import {
  loadGhostSystem, saveGhostSystem, generateGhostPicks,
  settleGhostPicks, checkForSwap, GHOST_STRATEGIES,
  type GhostSystemState, type GhostPick,
} from "@/lib/bot/ghost-bots";

const STRATEGY_ICONS: Record<string, any> = {
  volume: Zap,
  balanced: Shield,
  sniper: Crosshair,
};

const STRATEGY_COLORS: Record<string, string> = {
  volume: "text-amber",
  balanced: "text-electric",
  sniper: "text-purple",
};

export default function GhostBots() {
  const { oddsData, scores } = useStore();
  const [system, setSystem] = useState<GhostSystemState>(loadGhostSystem);
  const [expandedGhost, setExpandedGhost] = useState<string | null>(null);

  // Auto-generate picks for all ghosts when odds load
  useEffect(() => {
    if (oddsData.length === 0) return;
    const today = new Date().toISOString().split("T")[0];
    const needsPicks = system.ghosts.some((g) => g.picks.filter((p) => p.date === today).length === 0);
    if (needsPicks) {
      const updated = generateGhostPicks(oddsData, system);
      saveGhostSystem(updated);
      setSystem(updated);
    }
  }, [oddsData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-settle + check for swap
  useEffect(() => {
    if (scores.length === 0) return;
    let updated = settleGhostPicks(system, scores);
    updated = checkForSwap(updated);
    if (updated !== system) {
      saveGhostSystem(updated);
      setSystem(updated);
    }
  }, [scores]); // eslint-disable-line react-hooks/exhaustive-deps

  const formatOdds = (odds: number) => (odds > 0 ? `+${odds}` : `${odds}`);
  const today = new Date().toISOString().split("T")[0];

  // Sort: live bot first, then by ROI
  const sortedGhosts = [...system.ghosts].sort((a, b) => {
    if (a.isLive) return -1;
    if (b.isLive) return 1;
    return b.roi - a.roi;
  });

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="glass rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <Ghost className="w-5 h-5 text-purple" />
          <h2 className="text-sm font-bold text-silver uppercase tracking-wider">Ghost Bots</h2>
          <span className="text-[10px] text-mercury/50 ml-auto">3 strategies competing</span>
        </div>
        <p className="text-xs text-mercury">
          Three shadow bots run different strategies in parallel. Whichever has the best ROI
          after enough data automatically becomes the <span className="text-neon font-semibold">Live Bot</span> that
          powers the main Board picks.
        </p>

        {/* Swap history */}
        {system.swapHistory.length > 0 && (
          <div className="mt-2 flex items-center gap-2 px-2 py-1.5 rounded bg-neon/5 border border-neon/15">
            <ArrowRightLeft className="w-3.5 h-3.5 text-neon flex-shrink-0" />
            <p className="text-[10px] text-neon">
              Last swap: {system.swapHistory[system.swapHistory.length - 1].reason}
            </p>
          </div>
        )}
      </div>

      {/* Comparison Table */}
      <div className="glass rounded-xl overflow-hidden">
        <div className="grid grid-cols-4 gap-px bg-slate/10">
          <div className="bg-bunker px-3 py-2">
            <p className="text-[9px] text-mercury uppercase">Strategy</p>
          </div>
          <div className="bg-bunker px-3 py-2 text-center">
            <p className="text-[9px] text-mercury uppercase">Record</p>
          </div>
          <div className="bg-bunker px-3 py-2 text-center">
            <p className="text-[9px] text-mercury uppercase">ROI</p>
          </div>
          <div className="bg-bunker px-3 py-2 text-center">
            <p className="text-[9px] text-mercury uppercase">Bankroll</p>
          </div>

          {sortedGhosts.map((ghost) => {
            const Icon = STRATEGY_ICONS[ghost.id] ?? Shield;
            const color = STRATEGY_COLORS[ghost.id] ?? "text-mercury";
            const strategy = GHOST_STRATEGIES.find((s) => s.id === ghost.id);
            return (
              <div key={ghost.id} className="contents">
                <div className={`bg-bunker/50 px-3 py-2.5 flex items-center gap-1.5 ${ghost.isLive ? "border-l-2 border-neon" : ""}`}>
                  <Icon className={`w-3.5 h-3.5 ${color}`} />
                  <div>
                    <span className="text-xs font-semibold text-silver">{ghost.name}</span>
                    {ghost.isLive && <Crown className="w-3 h-3 text-neon inline ml-1" />}
                  </div>
                </div>
                <div className="bg-bunker/50 px-3 py-2.5 text-center">
                  <span className="text-xs font-mono text-silver">{ghost.wins}W-{ghost.losses}L</span>
                </div>
                <div className="bg-bunker/50 px-3 py-2.5 text-center">
                  <span className={`text-xs font-mono font-bold ${ghost.roi >= 0 ? "text-neon" : "text-danger"}`}>
                    {ghost.roi >= 0 ? "+" : ""}{ghost.roi.toFixed(1)}%
                  </span>
                </div>
                <div className="bg-bunker/50 px-3 py-2.5 text-center">
                  <span className={`text-xs font-mono ${ghost.bankroll >= 5000 ? "text-neon" : "text-danger"}`}>
                    ${ghost.bankroll.toFixed(0)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Individual Ghost Details */}
      {sortedGhosts.map((ghost) => {
        const Icon = STRATEGY_ICONS[ghost.id] ?? Shield;
        const color = STRATEGY_COLORS[ghost.id] ?? "text-mercury";
        const strategy = GHOST_STRATEGIES.find((s) => s.id === ghost.id);
        const isExpanded = expandedGhost === ghost.id;
        const todayPicks = ghost.picks.filter((p) => p.date === today);
        const recentPicks = ghost.picks.filter((p) => p.result !== "pending").slice(-5);

        return (
          <div key={ghost.id} className={`glass rounded-xl overflow-hidden ${ghost.isLive ? "border border-neon/20" : ""}`}>
            <button
              onClick={() => setExpandedGhost(isExpanded ? null : ghost.id)}
              className="w-full px-3 sm:px-4 py-3 flex items-center gap-2 hover:bg-gunmetal/20 transition-colors text-left"
            >
              <Icon className={`w-4 h-4 ${color} flex-shrink-0`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold text-silver">{ghost.name}</span>
                  {ghost.isLive && (
                    <span className="text-[9px] px-1.5 py-0.5 bg-neon/15 text-neon rounded font-bold">LIVE</span>
                  )}
                </div>
                <p className="text-[10px] text-mercury/60">{strategy?.description}</p>
              </div>
              <div className="text-right flex-shrink-0 mr-2">
                <p className={`text-sm font-mono font-bold ${ghost.profit >= 0 ? "text-neon" : "text-danger"}`}>
                  {ghost.profit >= 0 ? "+" : ""}${ghost.profit.toFixed(0)}
                </p>
                <p className="text-[9px] text-mercury">min {strategy?.minEdge}% edge</p>
              </div>
              <ChevronDown className={`w-4 h-4 text-mercury/40 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
            </button>

            {isExpanded && (
              <div className="px-3 sm:px-4 pb-3 animate-slide-up space-y-3">
                {/* Strategy params */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="text-center p-2 rounded bg-gunmetal/40">
                    <p className="text-sm font-bold font-mono text-silver">{strategy?.minEdge}%</p>
                    <p className="text-[8px] text-mercury uppercase">Min Edge</p>
                  </div>
                  <div className="text-center p-2 rounded bg-gunmetal/40">
                    <p className="text-sm font-bold font-mono text-silver">{strategy?.maxBetsPerDay}</p>
                    <p className="text-[8px] text-mercury uppercase">Max/Day</p>
                  </div>
                  <div className="text-center p-2 rounded bg-gunmetal/40">
                    <p className="text-sm font-bold font-mono text-silver">{((strategy?.kellyFraction ?? 0.25) * 100).toFixed(0)}%</p>
                    <p className="text-[8px] text-mercury uppercase">Kelly</p>
                  </div>
                </div>

                {/* Today's picks */}
                {todayPicks.length > 0 && (
                  <div>
                    <p className="text-[9px] text-mercury uppercase tracking-wider mb-1.5 font-semibold">Today's Picks</p>
                    <div className="space-y-1">
                      {todayPicks.map((pick) => (
                        <GhostPickRow key={pick.id} pick={pick} formatOdds={formatOdds} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Recent results */}
                {recentPicks.length > 0 && (
                  <div>
                    <p className="text-[9px] text-mercury uppercase tracking-wider mb-1.5 font-semibold">Recent</p>
                    <div className="flex gap-1">
                      {recentPicks.map((p, i) => (
                        <div key={i} className={`flex-1 h-5 rounded flex items-center justify-center text-[8px] font-bold ${
                          p.result === "win" ? "bg-neon/15 text-neon" : p.result === "loss" ? "bg-danger/15 text-danger" : "bg-mercury/10 text-mercury"
                        }`}>
                          {p.result === "win" ? "W" : p.result === "loss" ? "L" : "P"}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function GhostPickRow({ pick, formatOdds }: { pick: GhostPick; formatOdds: (n: number) => string }) {
  const resultStyles: Record<string, string> = {
    win: "text-neon", loss: "text-danger", push: "text-mercury", pending: "text-amber",
  };

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-gunmetal/30">
      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
        pick.result === "pending" ? "bg-amber animate-pulse" :
        pick.result === "win" ? "bg-neon" : pick.result === "loss" ? "bg-danger" : "bg-mercury"
      }`} />
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-silver truncate">{pick.pick}</p>
        <p className="text-[9px] text-mercury/50 truncate">{pick.game}</p>
      </div>
      <span className="text-[10px] font-mono text-mercury">{formatOdds(pick.odds)}</span>
      <span className="text-[10px] font-mono text-neon">+{pick.evEdge}%</span>
      {pick.result !== "pending" && (
        <span className={`text-[10px] font-mono font-bold ${resultStyles[pick.result]}`}>
          {pick.payout - pick.stake >= 0 ? "+" : ""}${(pick.payout - pick.stake).toFixed(0)}
        </span>
      )}
    </div>
  );
}
