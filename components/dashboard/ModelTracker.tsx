"use client";

import { useStore } from "@/lib/store";
import { useMemo } from "react";
import {
  BarChart3, TrendingUp, TrendingDown, Target, Award,
  CheckCircle, XCircle, Minus, Percent, DollarSign, Flame,
} from "lucide-react";

export default function ModelTracker() {
  const { betHistory, bankroll } = useStore();

  const stats = useMemo(() => {
    const settled = betHistory.filter((b) => b.result !== "pending" && b.result !== "void");
    const wins = settled.filter((b) => b.result === "win");
    const losses = settled.filter((b) => b.result === "loss");
    const pushes = settled.filter((b) => b.result === "push");

    const totalStaked = settled.reduce((s, b) => s + b.stake, 0);
    const totalReturns = settled.reduce((s, b) => s + b.payout, 0);
    const profit = totalReturns - totalStaked;
    const roi = totalStaked > 0 ? (profit / totalStaked) * 100 : 0;
    const winRate = settled.length > 0 ? (wins.length / (wins.length + losses.length)) * 100 : 0;

    // EV accuracy: compare predicted EV vs actual results
    const evBets = settled.filter((b) => b.evAtPlacement > 0);
    const avgEV = evBets.length > 0
      ? evBets.reduce((s, b) => s + b.evAtPlacement, 0) / evBets.length
      : 0;

    // Streak
    let streak = 0;
    let streakType: "W" | "L" | "" = "";
    for (let i = settled.length - 1; i >= 0; i--) {
      const r = settled[i].result;
      if (r === "push") continue;
      if (streakType === "") {
        streakType = r === "win" ? "W" : "L";
        streak = 1;
      } else if ((r === "win" && streakType === "W") || (r === "loss" && streakType === "L")) {
        streak++;
      } else {
        break;
      }
    }

    // Units won (based on $100 unit)
    const units = profit / 100;

    // By market breakdown
    const byMarket: Record<string, { wins: number; losses: number; profit: number }> = {};
    for (const bet of settled) {
      const m = bet.market || "other";
      if (!byMarket[m]) byMarket[m] = { wins: 0, losses: 0, profit: 0 };
      if (bet.result === "win") byMarket[m].wins++;
      else if (bet.result === "loss") byMarket[m].losses++;
      byMarket[m].profit += bet.payout - bet.stake;
    }

    // Recent 10 results
    const recent10 = settled.slice(-10).map((b) => b.result);

    // Best and worst day
    const byDay: Record<string, number> = {};
    for (const bet of settled) {
      const day = bet.timestamp.split("T")[0];
      byDay[day] = (byDay[day] ?? 0) + (bet.payout - bet.stake);
    }
    const days = Object.entries(byDay).sort((a, b) => b[1] - a[1]);
    const bestDay = days[0];
    const worstDay = days[days.length - 1];

    return {
      total: settled.length,
      wins: wins.length,
      losses: losses.length,
      pushes: pushes.length,
      winRate,
      profit,
      roi,
      avgEV,
      streak,
      streakType,
      units,
      byMarket,
      recent10,
      bestDay,
      worstDay,
      pending: betHistory.filter((b) => b.result === "pending").length,
    };
  }, [betHistory]);

  const marketLabels: Record<string, string> = {
    moneyline: "Moneylines",
    spread: "Run Lines",
    total: "Totals",
    player_prop: "Player Props",
    other: "Other",
  };

  if (stats.total === 0 && stats.pending === 0) {
    return (
      <div className="glass rounded-xl p-6 sm:p-8 text-center">
        <BarChart3 className="w-10 h-10 text-mercury/20 mx-auto mb-3" />
        <h3 className="text-base font-bold text-silver mb-1">Model Accuracy Tracker</h3>
        <p className="text-sm text-mercury">Start logging bets to track the model's performance over time.</p>
        <p className="text-xs text-mercury/50 mt-2">Use "Log a Bet" on the Bank tab, or tap picks on the dashboard to log them.</p>
      </div>
    );
  }

  return (
    <div className="glass rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate/50 flex items-center gap-2">
        <BarChart3 className="w-5 h-5 text-electric" />
        <h3 className="text-sm font-semibold text-silver uppercase tracking-wide">Model Accuracy</h3>
        {stats.total > 0 && (
          <span className="ml-auto text-xs font-mono text-mercury">{stats.total} bets tracked</span>
        )}
      </div>

      <div className="p-4 space-y-4">
        {/* Main Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatCard
            label="Win Rate"
            value={`${stats.winRate.toFixed(1)}%`}
            icon={Target}
            color={stats.winRate > 52 ? "text-neon" : stats.winRate > 48 ? "text-silver" : "text-danger"}
          />
          <StatCard
            label="ROI"
            value={`${stats.roi >= 0 ? "+" : ""}${stats.roi.toFixed(1)}%`}
            icon={Percent}
            color={stats.roi > 0 ? "text-neon" : "text-danger"}
          />
          <StatCard
            label="Profit"
            value={`${stats.profit >= 0 ? "+" : ""}$${stats.profit.toFixed(0)}`}
            icon={DollarSign}
            color={stats.profit >= 0 ? "text-neon" : "text-danger"}
          />
          <StatCard
            label="Units"
            value={`${stats.units >= 0 ? "+" : ""}${stats.units.toFixed(1)}u`}
            icon={TrendingUp}
            color={stats.units >= 0 ? "text-neon" : "text-danger"}
          />
        </div>

        {/* Record + Streak */}
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <CheckCircle className="w-3.5 h-3.5 text-neon" />
              <span className="text-sm font-mono text-neon">{stats.wins}</span>
            </div>
            <div className="flex items-center gap-1">
              <XCircle className="w-3.5 h-3.5 text-danger" />
              <span className="text-sm font-mono text-danger">{stats.losses}</span>
            </div>
            <div className="flex items-center gap-1">
              <Minus className="w-3.5 h-3.5 text-mercury" />
              <span className="text-sm font-mono text-mercury">{stats.pushes}</span>
            </div>
          </div>
          {stats.streak > 0 && (
            <div className="flex items-center gap-1">
              <Flame className={`w-3.5 h-3.5 ${stats.streakType === "W" ? "text-neon" : "text-danger"}`} />
              <span className={`text-xs font-bold ${stats.streakType === "W" ? "text-neon" : "text-danger"}`}>
                {stats.streak}{stats.streakType} streak
              </span>
            </div>
          )}
        </div>

        {/* Recent 10 visual */}
        {stats.recent10.length > 0 && (
          <div>
            <p className="text-[10px] text-mercury uppercase tracking-wider mb-1.5">Last {stats.recent10.length}</p>
            <div className="flex gap-1">
              {stats.recent10.map((r, i) => (
                <div
                  key={i}
                  className={`flex-1 h-6 rounded flex items-center justify-center text-[9px] font-bold ${
                    r === "win" ? "bg-neon/15 text-neon" :
                    r === "loss" ? "bg-danger/15 text-danger" :
                    "bg-mercury/10 text-mercury"
                  }`}
                >
                  {r === "win" ? "W" : r === "loss" ? "L" : "P"}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Avg EV at placement */}
        {stats.avgEV > 0 && (
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-gunmetal/30">
            <span className="text-xs text-mercury">Avg EV at placement</span>
            <span className="text-sm font-mono text-electric">+{stats.avgEV.toFixed(1)}%</span>
          </div>
        )}

        {/* By Market */}
        {Object.keys(stats.byMarket).length > 0 && (
          <div>
            <p className="text-[10px] text-mercury uppercase tracking-wider mb-1.5">By Market</p>
            <div className="space-y-1">
              {Object.entries(stats.byMarket).map(([market, data]) => (
                <div key={market} className="flex items-center justify-between px-2 py-1.5 rounded bg-gunmetal/20">
                  <span className="text-xs text-mercury">{marketLabels[market] ?? market}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-mono text-mercury">
                      {data.wins}W-{data.losses}L
                    </span>
                    <span className={`text-[10px] font-mono font-semibold ${data.profit >= 0 ? "text-neon" : "text-danger"}`}>
                      {data.profit >= 0 ? "+" : ""}${data.profit.toFixed(0)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Best/Worst Day */}
        {stats.bestDay && stats.total >= 3 && (
          <div className="grid grid-cols-2 gap-2">
            <div className="px-3 py-2 rounded-lg bg-neon/5 border border-neon/15 text-center">
              <p className="text-[9px] text-mercury uppercase">Best Day</p>
              <p className="text-sm font-mono font-bold text-neon">+${stats.bestDay[1].toFixed(0)}</p>
              <p className="text-[9px] text-mercury/50">{stats.bestDay[0]}</p>
            </div>
            {stats.worstDay && stats.worstDay[1] < 0 && (
              <div className="px-3 py-2 rounded-lg bg-danger/5 border border-danger/15 text-center">
                <p className="text-[9px] text-mercury uppercase">Worst Day</p>
                <p className="text-sm font-mono font-bold text-danger">${stats.worstDay[1].toFixed(0)}</p>
                <p className="text-[9px] text-mercury/50">{stats.worstDay[0]}</p>
              </div>
            )}
          </div>
        )}

        {/* Pending */}
        {stats.pending > 0 && (
          <div className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-amber/5 border border-amber/15">
            <div className="w-2 h-2 rounded-full bg-amber animate-pulse" />
            <span className="text-xs text-amber">{stats.pending} pending {stats.pending === 1 ? "bet" : "bets"} — settle them on the Bank tab</span>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: string; icon: any; color: string }) {
  return (
    <div className="text-center p-2.5 rounded-lg bg-gunmetal/40">
      <Icon className={`w-4 h-4 mx-auto mb-1 ${color}`} />
      <p className={`text-lg font-bold font-mono ${color}`}>{value}</p>
      <p className="text-[9px] text-mercury uppercase">{label}</p>
    </div>
  );
}
