"use client";

import { useEffect, useMemo, useState } from "react";
import { Zap, Trophy, RefreshCw } from "lucide-react";
import { useStore } from "@/lib/store";
import type { ArbitrageOpportunity } from "@/lib/model/types";

const formatOdds = (odds: number) => (odds > 0 ? `+${odds}` : `${odds}`);

export default function ArbBoard() {
  const { oddsData } = useStore();
  const [refreshTick, setRefreshTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [fallbackArbs, setFallbackArbs] = useState<ArbitrageOpportunity[] | null>(null);

  // Flatten arbs from already-fetched odds data
  const storeArbs: ArbitrageOpportunity[] = useMemo(() => {
    return oddsData.flatMap((g: any) => g.arbitrage ?? []);
  }, [oddsData]);

  // If store is empty (e.g. user hits the tab before main fetch), pull from API directly
  useEffect(() => {
    if (oddsData.length > 0) {
      setFallbackArbs(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setRefreshing(true);
      try {
        const [nbaRes, mlbRes] = await Promise.all([
          fetch("/api/odds?sport=basketball_nba").then((r) => r.json()).catch(() => ({ games: [] })),
          fetch("/api/odds?sport=baseball_mlb").then((r) => r.json()).catch(() => ({ games: [] })),
        ]);
        if (cancelled) return;
        const merged: ArbitrageOpportunity[] = [
          ...((nbaRes.games ?? []).flatMap((g: any) => g.arbitrage ?? [])),
          ...((mlbRes.games ?? []).flatMap((g: any) => g.arbitrage ?? [])),
        ];
        setFallbackArbs(merged);
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [oddsData.length, refreshTick]);

  // Auto-refresh every 60s
  useEffect(() => {
    const id = setInterval(() => setRefreshTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Manual refresh fires the global event the page listens for, so the store
  // refills and we get fresh arb data without duplicating fetch logic.
  const manualRefresh = () => {
    setRefreshing(true);
    try {
      window.dispatchEvent(new Event("dq-refresh"));
    } catch {}
    setRefreshTick((t) => t + 1);
    setTimeout(() => setRefreshing(false), 1500);
  };

  const arbs = (storeArbs.length > 0 ? storeArbs : fallbackArbs ?? [])
    .slice()
    .sort((a, b) => b.profit - a.profit);

  return (
    <div className="max-w-6xl mx-auto space-y-3">
      {/* Header */}
      <div className="glass rounded-xl px-4 py-3 flex items-center justify-between border border-gold/20">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-gold" />
          <h2 className="text-sm font-bold text-silver uppercase tracking-wider">Arbitrage Board</h2>
          <span className="text-[10px] text-gold/70 font-mono">
            {arbs.length} {arbs.length === 1 ? "opp" : "opps"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden sm:block text-[10px] text-mercury/50 font-mono">Auto-refresh 60s</span>
          <button
            onClick={manualRefresh}
            disabled={refreshing}
            className="p-1.5 rounded-lg hover:bg-gunmetal/50 transition-colors"
            title="Refresh now"
          >
            <RefreshCw className={`w-4 h-4 text-mercury ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Body */}
      {arbs.length === 0 ? (
        <div className="glass rounded-xl p-10 text-center border border-slate/20">
          <Trophy className="w-8 h-8 text-mercury/40 mx-auto mb-3" />
          <p className="text-sm text-silver font-semibold mb-1">No arbs right now — books are sharp</p>
          <p className="text-[11px] text-mercury/60">
            We scan every market every poll. New opportunities will surface here automatically.
          </p>
        </div>
      ) : (
        <div className="glass rounded-xl overflow-hidden border border-gold/10">
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-bunker/80 border-b border-slate/20">
                <tr className="text-left">
                  <th className="px-3 py-2 font-semibold text-mercury uppercase tracking-wider text-[10px]">Game</th>
                  <th className="px-3 py-2 font-semibold text-mercury uppercase tracking-wider text-[10px]">Side A</th>
                  <th className="px-3 py-2 font-semibold text-mercury uppercase tracking-wider text-[10px]">Side B</th>
                  <th className="px-3 py-2 font-semibold text-mercury uppercase tracking-wider text-[10px] text-right">Stake (per $100)</th>
                  <th className="px-3 py-2 font-semibold text-gold uppercase tracking-wider text-[10px] text-right">Locked Profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate/10">
                {arbs.map((arb, i) => (
                  <tr key={i} className="hover:bg-gold/5 transition-colors">
                    <td className="px-3 py-2.5">
                      <p className="text-silver font-medium truncate max-w-[220px]">{arb.game}</p>
                      <p className="text-[10px] text-mercury/50 uppercase tracking-wider">{arb.type}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="text-silver">{arb.side1.pick}</p>
                      <p className="text-[10px] text-mercury/60 font-mono">
                        {arb.side1.bookmaker} <span className="text-neon">{formatOdds(arb.side1.odds)}</span>
                      </p>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="text-silver">{arb.side2.pick}</p>
                      <p className="text-[10px] text-mercury/60 font-mono">
                        {arb.side2.bookmaker} <span className="text-neon">{formatOdds(arb.side2.odds)}</span>
                      </p>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-mercury">
                      ${arb.stake1.toFixed(2)} / ${arb.stake2.toFixed(2)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <p className="text-gold font-mono font-bold text-sm">${arb.profit.toFixed(2)}</p>
                      <p className="text-[10px] text-gold/60 font-mono">+{arb.profit.toFixed(2)}%</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-slate/10">
            {arbs.map((arb, i) => (
              <div key={i} className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-silver font-medium truncate">{arb.game}</p>
                    <p className="text-[9px] text-mercury/50 uppercase tracking-wider">{arb.type}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm text-gold font-mono font-bold">${arb.profit.toFixed(2)}</p>
                    <p className="text-[9px] text-gold/60 font-mono">+{arb.profit.toFixed(2)}%</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-lg bg-bunker/60 border border-slate/10 p-2">
                    <p className="text-silver truncate">{arb.side1.pick}</p>
                    <p className="text-[9px] text-mercury/60 font-mono">
                      {arb.side1.bookmaker} <span className="text-neon">{formatOdds(arb.side1.odds)}</span>
                    </p>
                    <p className="text-[10px] text-mercury/70 font-mono mt-1">${arb.stake1.toFixed(2)}</p>
                  </div>
                  <div className="rounded-lg bg-bunker/60 border border-slate/10 p-2">
                    <p className="text-silver truncate">{arb.side2.pick}</p>
                    <p className="text-[9px] text-mercury/60 font-mono">
                      {arb.side2.bookmaker} <span className="text-neon">{formatOdds(arb.side2.odds)}</span>
                    </p>
                    <p className="text-[10px] text-mercury/70 font-mono mt-1">${arb.stake2.toFixed(2)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-[10px] text-mercury/40 text-center font-mono px-4">
        Stake split assumes a $100 total wager. Profit shown is guaranteed regardless of outcome — check book limits & line availability before placing.
      </p>
    </div>
  );
}
