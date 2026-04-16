"use client";

import { useMemo } from "react";
import { useStore } from "@/lib/store";
import { TrendingUp, TrendingDown, BarChart3 } from "lucide-react";

export default function ROIChart() {
  const { betHistory, bankroll } = useStore();

  const chartData = useMemo(() => {
    // Build daily P&L from bet history
    const dailyPnL: Record<string, number> = {};
    const settled = betHistory.filter(b => b.result && b.result !== "pending");

    for (const bet of settled) {
      const date = bet.timestamp?.split("T")[0] ?? new Date().toISOString().split("T")[0];
      const pl = (bet.payout ?? 0) - (bet.stake ?? 0);
      dailyPnL[date] = (dailyPnL[date] ?? 0) + pl;
    }

    // Convert to cumulative P&L array
    const dates = Object.keys(dailyPnL).sort();
    let cumulative = 0;
    const points = dates.map(date => {
      cumulative += dailyPnL[date];
      return { date, pl: dailyPnL[date], cumulative };
    });

    return points;
  }, [betHistory]);

  if (chartData.length < 2) {
    return (
      <div className="glass rounded-xl p-4 text-center">
        <BarChart3 className="w-6 h-6 text-mercury/20 mx-auto mb-2" />
        <p className="text-xs text-mercury/50">Need 2+ days of settled bets to show ROI chart</p>
      </div>
    );
  }

  // SVG chart dimensions
  const W = 400, H = 120, PAD = 20;
  const chartW = W - PAD * 2;
  const chartH = H - PAD * 2;

  const values = chartData.map(d => d.cumulative);
  const minVal = Math.min(0, ...values);
  const maxVal = Math.max(0, ...values);
  const range = maxVal - minVal || 1;

  const xScale = (i: number) => PAD + (i / (chartData.length - 1)) * chartW;
  const yScale = (v: number) => PAD + chartH - ((v - minVal) / range) * chartH;

  // Build SVG path
  const pathPoints = chartData.map((d, i) => `${xScale(i)},${yScale(d.cumulative)}`);
  const linePath = `M${pathPoints.join(" L")}`;

  // Fill area
  const fillPath = `${linePath} L${xScale(chartData.length - 1)},${yScale(0)} L${xScale(0)},${yScale(0)} Z`;

  const lastValue = chartData[chartData.length - 1]?.cumulative ?? 0;
  const isPositive = lastValue >= 0;
  const strokeColor = isPositive ? "#00ff88" : "#ff3b5c";
  const fillColor = isPositive ? "#00ff8815" : "#ff3b5c15";

  // Zero line
  const zeroY = yScale(0);

  return (
    <div className="glass rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate/20 flex items-center gap-2">
        {isPositive ? <TrendingUp className="w-4 h-4 text-neon" /> : <TrendingDown className="w-4 h-4 text-danger" />}
        <h3 className="text-xs font-bold text-silver uppercase tracking-wider">Cumulative P&L</h3>
        <span className={`ml-auto text-sm font-bold font-mono ${isPositive ? "text-neon" : "text-danger"}`}>
          {lastValue >= 0 ? "+" : ""}${lastValue.toFixed(0)}
        </span>
      </div>
      <div className="p-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
          {/* Grid lines */}
          <line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke="#8b8fa320" strokeWidth="1" strokeDasharray="4,4" />

          {/* Fill area */}
          <path d={fillPath} fill={fillColor} />

          {/* Line */}
          <path d={linePath} fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

          {/* Dots at start and end */}
          <circle cx={xScale(0)} cy={yScale(chartData[0].cumulative)} r="3" fill={strokeColor} />
          <circle cx={xScale(chartData.length - 1)} cy={yScale(lastValue)} r="4" fill={strokeColor} stroke="#0a0a0f" strokeWidth="2" />

          {/* Labels */}
          <text x={PAD} y={H - 2} fill="#8b8fa3" fontSize="9" fontFamily="monospace">{chartData[0].date.slice(5)}</text>
          <text x={W - PAD} y={H - 2} fill="#8b8fa3" fontSize="9" fontFamily="monospace" textAnchor="end">{chartData[chartData.length - 1].date.slice(5)}</text>
          <text x={PAD - 2} y={yScale(maxVal) + 3} fill="#8b8fa3" fontSize="8" fontFamily="monospace" textAnchor="end">+${maxVal.toFixed(0)}</text>
          {minVal < 0 && <text x={PAD - 2} y={yScale(minVal) + 3} fill="#8b8fa3" fontSize="8" fontFamily="monospace" textAnchor="end">-${Math.abs(minVal).toFixed(0)}</text>}
        </svg>

        {/* Daily stats */}
        <div className="flex items-center justify-between mt-2 text-[9px] text-mercury/50">
          <span>{chartData.length} days tracked</span>
          <span>Best: +${Math.max(...chartData.map(d => d.pl)).toFixed(0)} | Worst: ${Math.min(...chartData.map(d => d.pl)).toFixed(0)}</span>
        </div>
      </div>
    </div>
  );
}
