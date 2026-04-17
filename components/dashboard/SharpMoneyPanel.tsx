"use client";

import { useEffect, useState, useCallback } from "react";
import { useStore } from "@/lib/store";
import { useSport } from "@/lib/sport-context";
import {
  TrendingUp, TrendingDown, Activity, Calculator, DollarSign,
  BarChart2, Download, RefreshCw, AlertTriangle, Zap, Clock,
} from "lucide-react";
import { kellyStake, americanToDecimal, americanToImpliedProb } from "@/lib/model/kelly";
import { BOOK_DISPLAY } from "@/lib/odds/the-odds-api";

// ── Types ────────────────────────────────────────────────

interface Movement {
  game: string;
  game_id: string;
  bookmaker: string;
  market: string;
  from: number;
  to: number;
  delta: number;
  direction: "up" | "down";
  minutes_ago: number;
  is_sharp: boolean;
  prob_delta?: number;
}

type SubTab = "sharp" | "kelly" | "pnl" | "heatmap";

// ── Kelly sub-section ────────────────────────────────────

function KellyCalc({ bankroll }: { bankroll: number }) {
  const [odds, setOdds] = useState("110");
  const [edge, setEdge] = useState("5");
  const [fraction, setFraction] = useState("0.25");
  const [result, setResult] = useState<{ stake: number; fullKelly: number; ev: number } | null>(null);

  const calc = () => {
    const o = parseInt(odds, 10);
    const edgePct = parseFloat(edge) / 100;
    const f = parseFloat(fraction);
    if (isNaN(o) || isNaN(edgePct) || isNaN(f)) return;
    const dec = americanToDecimal(o);
    const impliedP = americanToImpliedProb(o);
    const fairP = impliedP + edgePct * impliedP; // edge on top of implied
    const stake = kellyStake(fairP, dec, bankroll, f);
    const fullKelly = kellyStake(fairP, dec, bankroll, 1);
    const ev = stake * (dec - 1) * fairP - stake * (1 - fairP);
    setResult({ stake, fullKelly, ev });
  };

  const fractionLabel = (f: string) => {
    const v = parseFloat(f);
    if (v <= 0.1) return "1/10 Kelly (ultra safe)";
    if (v <= 0.25) return "1/4 Kelly (conservative)";
    if (v <= 0.5) return "1/2 Kelly (moderate)";
    return "Full Kelly (aggressive)";
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="text-[10px] text-mercury/60 uppercase tracking-wide font-semibold block mb-1">
            American Odds
          </label>
          <input
            type="number"
            value={odds}
            onChange={(e) => setOdds(e.target.value)}
            className="w-full bg-gunmetal/60 border border-slate/30 rounded-lg px-3 py-2 text-sm text-silver focus:outline-none focus:border-neon/50"
            placeholder="-110"
          />
        </div>
        <div>
          <label className="text-[10px] text-mercury/60 uppercase tracking-wide font-semibold block mb-1">
            Edge %
          </label>
          <input
            type="number"
            value={edge}
            onChange={(e) => setEdge(e.target.value)}
            step="0.5"
            className="w-full bg-gunmetal/60 border border-slate/30 rounded-lg px-3 py-2 text-sm text-silver focus:outline-none focus:border-neon/50"
            placeholder="5"
          />
        </div>
        <div>
          <label className="text-[10px] text-mercury/60 uppercase tracking-wide font-semibold block mb-1">
            Bankroll (${bankroll.toLocaleString()})
          </label>
          <select
            value={fraction}
            onChange={(e) => setFraction(e.target.value)}
            className="w-full bg-gunmetal/60 border border-slate/30 rounded-lg px-3 py-2 text-sm text-silver focus:outline-none focus:border-neon/50"
          >
            <option value="0.1">1/10 Kelly</option>
            <option value="0.25">1/4 Kelly</option>
            <option value="0.5">1/2 Kelly</option>
            <option value="1">Full Kelly</option>
          </select>
        </div>
      </div>

      <button
        onClick={calc}
        className="w-full py-2.5 rounded-xl bg-neon/15 text-neon border border-neon/30 font-semibold text-sm hover:bg-neon/25 transition-colors"
      >
        Calculate Bet Size
      </button>

      {result && (
        <div className="grid grid-cols-3 gap-3">
          <div className="glass rounded-xl p-3 text-center">
            <p className="text-[10px] text-mercury/60 uppercase tracking-wide mb-1">Bet Size</p>
            <p className="text-lg font-bold text-neon">${result.stake.toFixed(2)}</p>
            <p className="text-[10px] text-mercury/50">{((result.stake / bankroll) * 100).toFixed(1)}% of bank</p>
          </div>
          <div className="glass rounded-xl p-3 text-center">
            <p className="text-[10px] text-mercury/60 uppercase tracking-wide mb-1">Full Kelly</p>
            <p className="text-lg font-bold text-electric">${result.fullKelly.toFixed(2)}</p>
            <p className="text-[10px] text-mercury/50">{fractionLabel(fraction)}</p>
          </div>
          <div className={`glass rounded-xl p-3 text-center ${result.ev >= 0 ? "border border-neon/20" : "border border-red-500/20"}`}>
            <p className="text-[10px] text-mercury/60 uppercase tracking-wide mb-1">Exp. Value</p>
            <p className={`text-lg font-bold ${result.ev >= 0 ? "text-neon" : "text-red-400"}`}>
              {result.ev >= 0 ? "+" : ""}${result.ev.toFixed(2)}
            </p>
            <p className="text-[10px] text-mercury/50">on this bet</p>
          </div>
        </div>
      )}

      <div className="glass rounded-xl p-3 text-[11px] text-mercury/60 space-y-1">
        <p className="font-semibold text-mercury/80">How to use:</p>
        <p>Enter the odds you&apos;re getting and your estimated edge (how much better your true probability is vs the implied odds). Kelly outputs the mathematically optimal stake.</p>
        <p className="text-mercury/50 italic">Recommended: 1/4 Kelly to reduce variance. Never exceed 5% of bankroll on any single bet.</p>
      </div>
    </div>
  );
}

// ── P&L sub-section ───────────────────────────────────────

function LivePnL({ betHistory, bankroll }: { betHistory: any[]; bankroll: any }) {
  const settled = betHistory.filter((b) => b.result !== "pending");
  const pending = betHistory.filter((b) => b.result === "pending");

  const profitLoss = bankroll.currentBankroll - bankroll.startingBankroll;
  const roi = bankroll.startingBankroll > 0
    ? ((profitLoss / bankroll.totalStaked) * 100) || 0
    : 0;

  // Running P&L by day (last 14 days)
  const byDay: Record<string, { profit: number; bets: number }> = {};
  for (const b of settled) {
    const day = (b.timestamp ?? "").slice(0, 10);
    if (!day) continue;
    if (!byDay[day]) byDay[day] = { profit: 0, bets: 0 };
    const p = b.result === "win" ? (b.payout ?? 0) - (b.stake ?? 0)
      : b.result === "loss" ? -(b.stake ?? 0) : 0;
    byDay[day].profit += p;
    byDay[day].bets++;
  }

  const dayEntries = Object.entries(byDay).sort().slice(-14);

  // CLV score: how often bet vs closing line
  const clvWins = settled.filter((b) => (b.evAtPlacement ?? 0) > 0).length;
  const clvPct = settled.length > 0 ? (clvWins / settled.length) * 100 : 0;

  const handleExportBets = () => {
    const encoded = encodeURIComponent(JSON.stringify(betHistory));
    window.open(`/api/export-csv?type=bets&bets=${encoded}`, "_blank");
  };

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="glass rounded-xl p-3">
          <p className="text-[10px] text-mercury/60 uppercase tracking-wide mb-1">Total P&L</p>
          <p className={`text-xl font-bold ${profitLoss >= 0 ? "text-neon" : "text-red-400"}`}>
            {profitLoss >= 0 ? "+" : ""}${profitLoss.toFixed(2)}
          </p>
          <p className="text-[10px] text-mercury/50">from ${bankroll.startingBankroll.toLocaleString()} start</p>
        </div>
        <div className="glass rounded-xl p-3">
          <p className="text-[10px] text-mercury/60 uppercase tracking-wide mb-1">ROI</p>
          <p className={`text-xl font-bold ${roi >= 0 ? "text-electric" : "text-red-400"}`}>
            {roi >= 0 ? "+" : ""}{roi.toFixed(1)}%
          </p>
          <p className="text-[10px] text-mercury/50">${bankroll.totalStaked.toFixed(0)} staked</p>
        </div>
        <div className="glass rounded-xl p-3">
          <p className="text-[10px] text-mercury/60 uppercase tracking-wide mb-1">Record</p>
          <p className="text-xl font-bold text-silver">
            {bankroll.wins}W-{bankroll.losses}L
            {bankroll.pushes > 0 ? `-${bankroll.pushes}P` : ""}
          </p>
          <p className="text-[10px] text-mercury/50">
            {bankroll.wins + bankroll.losses > 0
              ? ((bankroll.wins / (bankroll.wins + bankroll.losses)) * 100).toFixed(1)
              : "0.0"}% win rate
          </p>
        </div>
        <div className="glass rounded-xl p-3">
          <p className="text-[10px] text-mercury/60 uppercase tracking-wide mb-1">+EV Rate</p>
          <p className={`text-xl font-bold ${clvPct >= 50 ? "text-neon" : "text-amber-400"}`}>
            {clvPct.toFixed(0)}%
          </p>
          <p className="text-[10px] text-mercury/50">bets with edge at placement</p>
        </div>
      </div>

      {/* Daily P&L bar chart */}
      {dayEntries.length > 0 && (
        <div className="glass rounded-xl p-4">
          <p className="text-[10px] text-mercury/60 uppercase tracking-wide font-semibold mb-3">Daily P&L (last {dayEntries.length} days)</p>
          <div className="flex items-end gap-1 h-20">
            {dayEntries.map(([day, data]) => {
              const maxAbs = Math.max(...dayEntries.map(([, d]) => Math.abs(d.profit)), 1);
              const height = Math.max((Math.abs(data.profit) / maxAbs) * 72, 2);
              return (
                <div key={day} className="flex-1 flex flex-col items-center justify-end gap-0.5" title={`${day}: ${data.profit >= 0 ? "+" : ""}$${data.profit.toFixed(2)}`}>
                  <div
                    className={`w-full rounded-sm ${data.profit >= 0 ? "bg-neon/70" : "bg-red-500/70"}`}
                    style={{ height: `${height}px` }}
                  />
                  <span className="text-[7px] text-mercury/40 rotate-90 origin-center">{day.slice(5)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pending bets */}
      {pending.length > 0 && (
        <div className="glass rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate/30">
            <p className="text-xs font-semibold text-mercury uppercase tracking-wide">Pending ({pending.length})</p>
          </div>
          <div className="divide-y divide-slate/20">
            {pending.slice(0, 5).map((b) => (
              <div key={b.id} className="px-4 py-2.5 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-silver">{b.pick}</p>
                  <p className="text-[10px] text-mercury/60">{b.game}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold text-amber-400">${b.stake?.toFixed(2)}</p>
                  <p className="text-[10px] text-mercury/50">{b.odds > 0 ? "+" : ""}{b.odds}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Export button */}
      <button
        onClick={handleExportBets}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-slate/30 text-sm text-mercury hover:text-silver hover:bg-gunmetal/30 transition-colors"
      >
        <Download className="w-4 h-4" />
        Export Bet History CSV
      </button>
    </div>
  );
}

// ── Heatmap sub-section ───────────────────────────────────

function BettingHeatmap({ betHistory }: { betHistory: any[] }) {
  const settled = betHistory.filter((b) => b.result !== "pending" && b.result !== "push");
  const sports = ["MLB", "NBA"];
  const markets = ["moneyline", "spreads", "totals", "props", "parlay"];

  // Build matrix: sport x market -> { wins, losses, profit }
  const matrix: Record<string, Record<string, { wins: number; losses: number; profit: number; bets: number }>> = {};
  for (const sport of sports) {
    matrix[sport] = {};
    for (const mkt of markets) {
      matrix[sport][mkt] = { wins: 0, losses: 0, profit: 0, bets: 0 };
    }
  }

  for (const b of settled) {
    // Infer sport from game name (simple heuristic)
    const sport = (b.game ?? "").match(/\b(NBA|Celtics|Lakers|Bulls|Warriors|Heat|Bucks|Nets|Knicks|76ers|Suns|Mavs|Thunder|Nuggets|Clippers|Raptors|Pistons|Pacers|Hawks|Hornets|Wizards|Magic|Cavaliers|Trail Blazers|Timberwolves|Jazz|Kings|Spurs|Rockets|Pelicans|Grizzlies)\b/i)
      ? "NBA" : "MLB";
    const mkt = (b.market ?? "moneyline").toLowerCase();
    const normalizedMkt = markets.includes(mkt) ? mkt : "moneyline";

    if (!matrix[sport]?.[normalizedMkt]) continue;

    const cell = matrix[sport][normalizedMkt];
    cell.bets++;
    if (b.result === "win") {
      cell.wins++;
      cell.profit += (b.payout ?? 0) - (b.stake ?? 0);
    } else {
      cell.losses++;
      cell.profit -= b.stake ?? 0;
    }
  }

  const cellColor = (cell: { wins: number; losses: number; profit: number; bets: number }) => {
    if (cell.bets === 0) return "bg-gunmetal/30 text-mercury/20";
    const wr = cell.wins / (cell.wins + cell.losses);
    if (wr >= 0.6) return "bg-neon/25 text-neon";
    if (wr >= 0.5) return "bg-neon/10 text-neon/70";
    if (wr >= 0.4) return "bg-amber-500/10 text-amber-400";
    return "bg-red-500/15 text-red-400";
  };

  const marketLabel: Record<string, string> = {
    moneyline: "ML",
    spreads: "Spread",
    totals: "O/U",
    props: "Props",
    parlay: "Parlay",
  };

  const totalBets = settled.length;
  const totalProfit = settled.reduce((sum, b) => {
    if (b.result === "win") return sum + (b.payout ?? 0) - (b.stake ?? 0);
    return sum - (b.stake ?? 0);
  }, 0);

  return (
    <div className="space-y-4">
      {totalBets === 0 ? (
        <div className="glass rounded-xl p-8 text-center">
          <BarChart2 className="w-8 h-8 text-mercury/30 mx-auto mb-2" />
          <p className="text-sm text-mercury/60">No settled bets yet</p>
          <p className="text-xs text-mercury/40 mt-1">Log bets via the Bankroll tab to populate the heatmap</p>
        </div>
      ) : (
        <>
          <div className="glass rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate/30 flex items-center justify-between">
              <p className="text-xs font-semibold text-mercury uppercase tracking-wide">Performance Heatmap</p>
              <p className="text-[10px] text-mercury/50">{totalBets} settled bets • {totalProfit >= 0 ? "+" : ""}${totalProfit.toFixed(2)}</p>
            </div>
            <div className="p-3 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="text-left py-1 pr-3 text-mercury/50 font-medium w-16">Sport</th>
                    {markets.map((m) => (
                      <th key={m} className="text-center py-1 px-2 text-mercury/50 font-medium">{marketLabel[m]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="space-y-1">
                  {sports.map((sport) => (
                    <tr key={sport}>
                      <td className="py-1 pr-3 font-semibold text-silver">{sport}</td>
                      {markets.map((mkt) => {
                        const cell = matrix[sport][mkt];
                        return (
                          <td key={mkt} className="py-1 px-1 text-center">
                            <div
                              className={`rounded px-1 py-1.5 ${cellColor(cell)}`}
                              title={cell.bets > 0 ? `${cell.wins}W-${cell.losses}L  ${cell.profit >= 0 ? "+" : ""}$${cell.profit.toFixed(0)}` : "No data"}
                            >
                              {cell.bets === 0 ? (
                                <span className="text-[9px]">—</span>
                              ) : (
                                <>
                                  <div className="font-bold text-[10px]">
                                    {cell.wins + cell.losses > 0
                                      ? `${((cell.wins / (cell.wins + cell.losses)) * 100).toFixed(0)}%`
                                      : "—"}
                                  </div>
                                  <div className="text-[8px] opacity-70">
                                    {cell.profit >= 0 ? "+" : ""}${cell.profit.toFixed(0)}
                                  </div>
                                </>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[9px] text-mercury/40 mt-2 text-right">Cell: win rate % / profit $. Green ≥60% | Yellow ≥50% | Red &lt;40%</p>
            </div>
          </div>

          {/* Top performers */}
          <div className="glass rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate/30">
              <p className="text-xs font-semibold text-mercury uppercase tracking-wide">Best Markets</p>
            </div>
            <div className="divide-y divide-slate/20">
              {Object.entries(
                settled.reduce((acc: Record<string, { wins: number; losses: number; profit: number }>, b) => {
                  const k = (b.market ?? "moneyline").toLowerCase();
                  if (!acc[k]) acc[k] = { wins: 0, losses: 0, profit: 0 };
                  acc[k].wins += b.result === "win" ? 1 : 0;
                  acc[k].losses += b.result === "loss" ? 1 : 0;
                  acc[k].profit += b.result === "win" ? (b.payout ?? 0) - (b.stake ?? 0) : -(b.stake ?? 0);
                  return acc;
                }, {})
              )
                .sort((a, b) => b[1].profit - a[1].profit)
                .slice(0, 4)
                .map(([market, stats]) => (
                  <div key={market} className="px-4 py-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold uppercase text-mercury bg-gunmetal/60 px-1.5 py-0.5 rounded">
                        {marketLabel[market] ?? market}
                      </span>
                      <span className="text-[10px] text-mercury/60">
                        {stats.wins}W-{stats.losses}L
                      </span>
                    </div>
                    <span className={`text-xs font-bold ${stats.profit >= 0 ? "text-neon" : "text-red-400"}`}>
                      {stats.profit >= 0 ? "+" : ""}${stats.profit.toFixed(2)}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Sharp Money Tracker ───────────────────────────────────

function SharpTracker({ sport }: { sport: string }) {
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [snapping, setSnapping] = useState(false);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchMovements = useCallback(async () => {
    try {
      const res = await fetch(`/api/sharp-money?sport=${sport}`);
      const data = await res.json();
      setMovements(data.movements ?? []);
      setLastFetch(new Date());
      setError(null);
    } catch {
      setError("Failed to load movements");
    } finally {
      setLoading(false);
    }
  }, [sport]);

  const snapOdds = useCallback(async () => {
    setSnapping(true);
    try {
      await fetch("/api/sharp-money", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sport }),
      });
      await fetchMovements();
    } catch {}
    setSnapping(false);
  }, [sport, fetchMovements]);

  useEffect(() => {
    fetchMovements();
    // Snap on mount, then every 5 min
    snapOdds();
    const interval = setInterval(snapOdds, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchMovements, snapOdds]);

  const bookLabel = (key: string) => BOOK_DISPLAY[key]?.short ?? key.slice(0, 4).toUpperCase();

  const handleExportMovements = () => {
    window.open(`/api/export-csv?type=movements&sport=${sport}`, "_blank");
  };

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-neon animate-pulse" />
          <span className="text-[10px] text-mercury/60 font-mono">
            {lastFetch ? `Updated ${lastFetch.toLocaleTimeString()}` : "Scanning..."}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={snapOdds}
            disabled={snapping}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate/30 text-xs text-mercury hover:text-silver hover:bg-gunmetal/30 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${snapping ? "animate-spin" : ""}`} />
            Scan Now
          </button>
          <button
            onClick={handleExportMovements}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate/30 text-xs text-mercury hover:text-silver hover:bg-gunmetal/30 transition-colors"
          >
            <Download className="w-3 h-3" />
            CSV
          </button>
        </div>
      </div>

      {/* Alert badges */}
      {movements.filter((m) => m.is_sharp).length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
          <p className="text-xs text-amber-400 font-semibold">
            {movements.filter((m) => m.is_sharp).length} sharp movement{movements.filter((m) => m.is_sharp).length > 1 ? "s" : ""} detected — significant line action
          </p>
        </div>
      )}

      {loading ? (
        <div className="glass rounded-xl p-6 text-center">
          <div className="w-6 h-6 rounded-full border border-t-neon animate-spin mx-auto mb-2" />
          <p className="text-xs text-mercury/60">Scanning odds history...</p>
        </div>
      ) : error ? (
        <div className="glass rounded-xl p-4 text-center">
          <p className="text-xs text-red-400">{error}</p>
          <p className="text-[10px] text-mercury/50 mt-1">
            Run the SQL migration in Supabase to enable historical tracking.
          </p>
        </div>
      ) : movements.length === 0 ? (
        <div className="glass rounded-xl p-6 text-center">
          <Activity className="w-7 h-7 text-mercury/30 mx-auto mb-2" />
          <p className="text-sm text-mercury/60">No movements &gt;0.5pt detected yet</p>
          <p className="text-xs text-mercury/40 mt-1">Data accumulates over 5-min scans. Check back after the first few captures.</p>
        </div>
      ) : (
        <div className="glass rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate/30 flex items-center justify-between">
            <p className="text-xs font-semibold text-mercury uppercase tracking-wide">
              Line Movements ({movements.length})
            </p>
            <p className="text-[10px] text-mercury/50">60-min window · {sport === "baseball_mlb" ? "MLB" : "NBA"}</p>
          </div>
          <div className="divide-y divide-slate/20 max-h-96 overflow-y-auto">
            {movements.map((m, i) => (
              <div key={i} className={`px-4 py-3 flex items-center gap-3 ${m.is_sharp ? "bg-amber-500/5" : ""}`}>
                <div className="flex-shrink-0">
                  {m.direction === "up" ? (
                    <TrendingUp className={`w-4 h-4 ${m.is_sharp ? "text-amber-400" : "text-neon"}`} />
                  ) : (
                    <TrendingDown className={`w-4 h-4 ${m.is_sharp ? "text-amber-400" : "text-red-400"}`} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-silver truncate">{m.game}</span>
                    {m.is_sharp && (
                      <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-400">
                        <Zap className="w-2.5 h-2.5" /> SHARP
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-[10px] font-medium text-mercury/70">{m.market}</span>
                    <span className="text-[10px] text-mercury/50">{bookLabel(m.bookmaker)}</span>
                    <span className="text-[10px] text-mercury/40 flex items-center gap-0.5">
                      <Clock className="w-2.5 h-2.5" />{m.minutes_ago}m ago
                    </span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs font-bold text-silver">
                    {m.market === "ML"
                      ? `${m.from > 0 ? "+" : ""}${m.from} → ${m.to > 0 ? "+" : ""}${m.to}`
                      : `${m.from > 0 ? "+" : ""}${m.from} → ${m.to > 0 ? "+" : ""}${m.to}`}
                  </p>
                  <p className={`text-[10px] font-semibold ${m.direction === "up" ? "text-neon" : "text-red-400"}`}>
                    {m.direction === "up" ? "▲" : "▼"}
                    {m.market === "ML" ? `${m.delta}%` : `${m.delta}pt`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Info */}
      <div className="text-[10px] text-mercury/40 font-mono text-center">
        Scans every 5 min · Alerts on &gt;0.5pt movement · 60-min history window
      </div>
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────

export default function SharpMoneyPanel() {
  const { bankroll, betHistory } = useStore();
  const { currentSport, config } = useSport();
  const [activeSection, setActiveSection] = useState<SubTab>("sharp");

  const sections: { key: SubTab; icon: React.ComponentType<any>; label: string }[] = [
    { key: "sharp", icon: Activity, label: "Sharp" },
    { key: "kelly", icon: Calculator, label: "Kelly" },
    { key: "pnl", icon: DollarSign, label: "P&L" },
    { key: "heatmap", icon: BarChart2, label: "Heat Map" },
  ];

  return (
    <div className="space-y-4">
      {/* Sub-nav */}
      <div className="flex bg-gunmetal/40 rounded-xl p-1 gap-1">
        {sections.map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            onClick={() => setActiveSection(key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeSection === key
                ? "bg-neon/15 text-neon border border-neon/20"
                : "text-mercury/60 hover:text-mercury"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {activeSection === "sharp" && <SharpTracker sport={config.oddsApiKey} />}
      {activeSection === "kelly" && <KellyCalc bankroll={bankroll.currentBankroll} />}
      {activeSection === "pnl" && <LivePnL betHistory={betHistory} bankroll={bankroll} />}
      {activeSection === "heatmap" && <BettingHeatmap betHistory={betHistory} />}
    </div>
  );
}
