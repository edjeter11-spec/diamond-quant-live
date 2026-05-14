"use client";

import { useEffect, useState } from "react";

interface HistItem { result?: string; date: string }

export default function ProfitChart({ sport = "nba", limit = 200 }: { sport?: "nba" | "mlb"; limit?: number }) {
  const [history, setHistory] = useState<HistItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/prop-history?sport=${sport}&limit=${limit}`)
      .then((r) => r.json())
      .then((d) => setHistory(d.picks ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [sport, limit]);

  const settled = (history ?? [])
    .filter((h) => h.result === "win" || h.result === "loss" || h.result === "push")
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

  if (loading) {
    return <div className="h-32 rounded bg-gunmetal/30 animate-pulse" />;
  }
  if (settled.length < 3) {
    return (
      <p className="text-[11px] text-mercury/50 text-center py-6">
        Need 3+ graded picks for backtest chart. Currently {settled.length}.
      </p>
    );
  }

  const points: number[] = [];
  let cum = 0;
  for (const p of settled) {
    if (p.result === "win") cum += 90.9;
    else if (p.result === "loss") cum -= 100;
    points.push(cum);
  }
  const max = Math.max(...points, 0);
  const min = Math.min(...points, 0);
  const range = max - min || 1;
  const W = 600, H = 140;
  const stepX = W / Math.max(points.length - 1, 1);
  const y = (v: number) => H - ((v - min) / range) * (H - 8) - 4;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${(i * stepX).toFixed(1)},${y(p).toFixed(1)}`).join(" ");
  const final = points[points.length - 1];
  const zeroY = y(0);
  const wins = settled.filter((s) => s.result === "win").length;
  const losses = settled.filter((s) => s.result === "loss").length;
  const wr = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className={`text-2xl font-bold font-mono tabular-nums ${final >= 0 ? "text-neon" : "text-danger"}`}>
            {final >= 0 ? "+" : ""}${final.toFixed(0)}
          </p>
          <p className="text-[10px] text-mercury/60 uppercase">Profit @ $100/bet</p>
        </div>
        <div>
          <p className={`text-2xl font-bold font-mono tabular-nums ${wr >= 55 ? "text-neon" : wr >= 50 ? "text-electric" : "text-amber"}`}>
            {wr.toFixed(1)}%
          </p>
          <p className="text-[10px] text-mercury/60 uppercase">Win Rate</p>
        </div>
        <div>
          <p className="text-2xl font-bold font-mono tabular-nums text-silver">
            {settled.length}
          </p>
          <p className="text-[10px] text-mercury/60 uppercase">Graded Picks</p>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-32" preserveAspectRatio="none">
        <line x1="0" y1={zeroY} x2={W} y2={zeroY} stroke="rgba(196,200,216,0.2)" strokeDasharray="2,3" />
        <path d={`${path} L${W},${zeroY} L0,${zeroY} Z`} fill={final >= 0 ? "rgba(0,255,136,0.12)" : "rgba(255,59,92,0.10)"} />
        <path d={path} stroke={final >= 0 ? "#00ff88" : "#ff3b5c"} strokeWidth="2" fill="none" />
      </svg>
      <div className="flex justify-between text-[9px] text-mercury/40">
        <span>{settled[0]?.date}</span>
        <span>{wins}W · {losses}L</span>
        <span>{settled[settled.length - 1]?.date}</span>
      </div>
    </div>
  );
}
