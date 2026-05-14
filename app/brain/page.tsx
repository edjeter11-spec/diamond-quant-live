"use client";

import { useState, useEffect } from "react";
import { Brain, ArrowLeft, TrendingUp, Crown, Activity, RefreshCw, Award, BarChart3, DollarSign } from "lucide-react";
import Link from "next/link";
import Paywall from "@/components/Paywall";

// Cumulative profit SVG mini-chart. Assumes -110 odds for all picks (most common prop juice).
function ProfitChart({ history }: { history: Array<{ result?: string; date: string }> }) {
  // Build cumulative profit over time (in units of $100 wagered)
  const settled = (history ?? [])
    .filter(h => h.result === "win" || h.result === "loss" || h.result === "push")
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  if (settled.length < 3) {
    return (
      <p className="text-[11px] text-mercury/50 text-center py-4">
        Need at least 3 graded picks for backtest chart. Currently {settled.length}.
      </p>
    );
  }
  const points: number[] = [];
  let cum = 0;
  for (const p of settled) {
    if (p.result === "win") cum += 90.9;       // -110 win
    else if (p.result === "loss") cum -= 100;
    // push = 0
    points.push(cum);
  }
  const max = Math.max(...points, 0);
  const min = Math.min(...points, 0);
  const range = max - min || 1;
  const W = 600, H = 120;
  const stepX = W / Math.max(points.length - 1, 1);
  const y = (v: number) => H - ((v - min) / range) * (H - 8) - 4;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${(i * stepX).toFixed(1)},${y(p).toFixed(1)}`).join(" ");
  const final = points[points.length - 1];
  const zeroY = y(0);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-mercury/60">If you'd bet $100 on every pick at -110:</span>
        <span className={`font-mono font-bold ml-auto ${final >= 0 ? "text-neon" : "text-danger"}`}>
          {final >= 0 ? "+" : ""}${final.toFixed(0)}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-24" preserveAspectRatio="none">
        {/* Zero line */}
        <line x1="0" y1={zeroY} x2={W} y2={zeroY} stroke="rgba(196,200,216,0.2)" strokeDasharray="2,3" />
        {/* Profit line */}
        <path d={path} stroke={final >= 0 ? "#00ff88" : "#ff3b5c"} strokeWidth="2" fill="none" />
        {/* Area under */}
        <path d={`${path} L${W},${zeroY} L0,${zeroY} Z`} fill={final >= 0 ? "rgba(0,255,136,0.08)" : "rgba(255,59,92,0.08)"} />
      </svg>
      <div className="flex justify-between text-[9px] text-mercury/40">
        <span>{settled[0]?.date}</span>
        <span>{settled.length} settled picks</span>
        <span>{settled[settled.length - 1]?.date}</span>
      </div>
    </div>
  );
}

interface BrainStats {
  ok: boolean;
  brain: {
    version: string;
    epoch: number;
    lastTrainedAt: string;
    lastAuditAt: string;
    weights: Record<string, number>;
    learningRate: number;
    totalPredictions: number;
    totalHits: number;
    totalGamesProcessed: number;
    markets: Record<string, { totalPredictions: number; hits: number; misses: number; winRate: number; brierScore: number }>;
    recentAudits: Array<{ gameId: string; gameDate: string; graded: number; hits: number; misses: number; avgBrier: number; timestamp: string }>;
    playerCount: number;
  };
  topPlayers: Array<{ name: string; team: string; total: number; hits: number; winRate: number; brierScore: number; byPropType: Record<string, { predictions: number; hits: number; winRate: number }> }>;
  evolution: {
    currentGeneration: number;
    liveBrainId: string;
    bestEverWinRate: number;
    history: Array<{ generation: number; winnerName: string; winRate: number; timestamp: string }>;
  } | null;
}

const WEIGHT_LABELS: Record<string, string> = {
  seasonAverage: "Season Avg",
  recentForm: "Recent Form",
  matchupDefense: "Matchup",
  homeAway: "Home/Away",
  restSchedule: "Rest",
  paceContext: "Pace",
  lineMovement: "Line Move",
};

export default function BrainPage() {
  const [stats, setStats] = useState<BrainStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [propHistory, setPropHistory] = useState<Array<{ result?: string; date: string }>>([]);

  useEffect(() => {
    fetch("/api/prop-history?sport=nba&limit=200")
      .then(r => r.json())
      .then(d => setPropHistory(d.picks ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/brain-stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-bunker flex items-center justify-center">
        <RefreshCw className="w-6 h-6 text-purple animate-spin" />
      </div>
    );
  }

  if (!stats?.ok || !stats.brain) {
    return (
      <div className="min-h-screen bg-bunker flex flex-col items-center justify-center gap-3">
        <Brain className="w-10 h-10 text-mercury/30" />
        <p className="text-sm text-mercury">Brain not yet initialized</p>
        <Link href="/" className="text-electric text-xs">← back to dashboard</Link>
      </div>
    );
  }

  const { brain, topPlayers, evolution } = stats;
  const overallAccuracy = brain.totalPredictions > 0 ? (brain.totalHits / brain.totalPredictions) * 100 : 0;
  const weightEntries = Object.entries(brain.weights).sort((a, b) => b[1] - a[1]);
  const maxWeight = Math.max(...weightEntries.map(([, v]) => v));

  return (
    <div className="min-h-screen bg-bunker pb-20">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-bunker/95 backdrop-blur border-b border-slate/30 px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <Link href="/" className="min-w-[44px] min-h-[44px] flex items-center justify-center -ml-2 text-mercury hover:text-silver" aria-label="Back to dashboard">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <Brain className="w-5 h-5 text-purple" />
          <div className="flex-1">
            <h1 className="text-base font-bold text-silver">NBA Prop Brain</h1>
            <p className="text-[10px] text-mercury/60">v{brain.version} • {brain.totalGamesProcessed.toLocaleString()} games trained</p>
          </div>
          <div className="text-right">
            <p className={`text-lg font-bold font-mono ${overallAccuracy > 52 ? "text-neon" : overallAccuracy > 48 ? "text-electric" : "text-amber"}`}>
              {overallAccuracy.toFixed(1)}%
            </p>
            <p className="text-[9px] text-mercury/50">{brain.totalPredictions.toLocaleString()} predictions</p>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-4 space-y-4">
        {/* Paywall gate — only Pro users see the full brain stats */}
        <Paywall
          feature="NBA Prop Brain — Pro Only"
          description="See decision weights, evolution history, top players the brain hits 60%+ on, and recent game audits. The brain auto-trains nightly and auto-evolves weekly."
          variant="replace"
        >
        {/* Per-market accuracy */}
        <div className="glass rounded-xl p-4 border border-purple/15">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="w-4 h-4 text-purple" />
            <h2 className="text-xs font-bold text-silver uppercase tracking-wider">Accuracy by Prop Type</h2>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {Object.entries(brain.markets ?? {}).map(([key, m]) => (
              <div key={key} className="text-center p-3 rounded-lg bg-gunmetal/30 border border-slate/15">
                <p className={`text-2xl font-bold font-mono ${m.winRate > 52 ? "text-neon" : m.winRate > 48 ? "text-electric" : "text-amber"}`}>
                  {m.winRate.toFixed(1)}%
                </p>
                <p className="text-[10px] text-mercury/60 capitalize mt-1">{key.replace("player_", "")}</p>
                <p className="text-[9px] text-mercury/40 mt-0.5">
                  {m.hits}W-{m.misses}L • Brier {m.brierScore.toFixed(3)}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Backtest cumulative profit chart */}
        <div className="glass rounded-xl p-4 border border-neon/15">
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="w-4 h-4 text-neon" />
            <h2 className="text-xs font-bold text-silver uppercase tracking-wider">Backtest — Cumulative Profit</h2>
          </div>
          <ProfitChart history={propHistory} />
        </div>

        {/* Weights breakdown */}
        <div className="glass rounded-xl p-4 border border-electric/15">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-electric" />
            <h2 className="text-xs font-bold text-silver uppercase tracking-wider">Decision Weights</h2>
            <span className="text-[9px] text-mercury/40 ml-auto">LR: {brain.learningRate.toFixed(4)}</span>
          </div>
          <div className="space-y-2">
            {weightEntries.map(([key, val]) => (
              <div key={key} className="flex items-center gap-3">
                <p className="text-[10px] text-mercury w-24 flex-shrink-0">{WEIGHT_LABELS[key] ?? key}</p>
                <div className="flex-1 h-2 bg-gunmetal/40 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-electric to-purple rounded-full"
                    style={{ width: `${(val / maxWeight) * 100}%` }}
                  />
                </div>
                <p className="text-[10px] font-mono text-silver w-12 text-right">{(val * 100).toFixed(1)}%</p>
              </div>
            ))}
          </div>
        </div>

        {/* Evolution history */}
        {evolution && evolution.history.length > 0 && (
          <div className="glass rounded-xl p-4 border border-gold/15">
            <div className="flex items-center gap-2 mb-3">
              <Crown className="w-4 h-4 text-gold" />
              <h2 className="text-xs font-bold text-silver uppercase tracking-wider">Evolution History</h2>
              <span className="text-[9px] text-gold ml-auto">Best: {evolution.bestEverWinRate}%</span>
            </div>
            <div className="space-y-1.5">
              {evolution.history.slice(-8).reverse().map((h, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-1.5 rounded bg-gunmetal/20 text-[10px]">
                  <span className="text-mercury/40 w-12">Gen {h.generation}</span>
                  <span className="flex-1 truncate text-silver">{h.winnerName}</span>
                  <span className={`font-mono font-bold ${h.winRate > 52 ? "text-neon" : h.winRate > 48 ? "text-electric" : "text-amber"}`}>
                    {h.winRate}%
                  </span>
                  <span className="text-mercury/40 text-[9px]">
                    {new Date(h.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Top players */}
        {topPlayers.length > 0 && (
          <div className="glass rounded-xl p-4 border border-neon/15">
            <div className="flex items-center gap-2 mb-3">
              <Award className="w-4 h-4 text-neon" />
              <h2 className="text-xs font-bold text-silver uppercase tracking-wider">Top Players (Brain Accuracy)</h2>
              <span className="text-[9px] text-mercury/40 ml-auto">{stats.brain.playerCount} tracked</span>
            </div>
            <div className="rounded-lg overflow-hidden border border-slate/15">
              {topPlayers.slice(0, 20).map((p, i) => (
                <div
                  key={p.name}
                  className={`flex items-center gap-3 px-3 py-2 text-[11px] border-b border-slate/10 last:border-0 ${i < 3 ? "bg-neon/5" : ""}`}
                >
                  <span className="w-5 text-mercury/40 font-mono text-[9px]">#{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-silver font-semibold truncate">{p.name}</p>
                    <p className="text-[9px] text-mercury/50 truncate">{p.team} • {p.total} picks</p>
                  </div>
                  <div className="flex gap-1.5 text-[8px] text-mercury/60">
                    {Object.entries(p.byPropType ?? {}).map(([type, stats]: [string, any]) => (
                      <span key={type} title={`${type}: ${stats.winRate}%`} className="font-mono">
                        {type === "player_points" ? "P" : type === "player_rebounds" ? "R" : "A"}
                        :{stats.winRate}
                      </span>
                    ))}
                  </div>
                  <span className={`font-mono font-bold w-12 text-right ${p.winRate > 55 ? "text-neon" : p.winRate > 50 ? "text-electric" : "text-amber"}`}>
                    {p.winRate.toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent audits */}
        {brain.recentAudits.length > 0 && (
          <div className="glass rounded-xl p-4 border border-electric/15">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-electric" />
              <h2 className="text-xs font-bold text-silver uppercase tracking-wider">Recent Game Audits</h2>
            </div>
            <div className="space-y-1">
              {brain.recentAudits.slice(-10).reverse().map((a, i) => {
                const winRate = a.graded > 0 ? (a.hits / a.graded) * 100 : 0;
                return (
                  <div key={i} className="flex items-center gap-3 px-3 py-1.5 rounded bg-gunmetal/20 text-[10px]">
                    <span className="text-mercury/40 w-20">{a.gameDate}</span>
                    <span className="flex-1 text-silver">{a.hits}W - {a.misses}L</span>
                    <span className="text-mercury/50">Brier {a.avgBrier.toFixed(3)}</span>
                    <span className={`font-mono font-bold w-12 text-right ${winRate > 55 ? "text-neon" : winRate > 48 ? "text-electric" : "text-amber"}`}>
                      {winRate.toFixed(0)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        </Paywall>
      </div>
    </div>
  );
}
