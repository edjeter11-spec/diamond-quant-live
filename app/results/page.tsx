"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Diamond, Trophy, CheckCircle, XCircle, Minus, ArrowLeft,
  TrendingUp, TrendingDown, Target,
} from "lucide-react";

interface Bucket {
  total: number;
  wins: number;
  losses: number;
  winRate: number;
  profitUnits: number;
}

interface ResultsData {
  ok: boolean;
  days: number;
  overall: Bucket & { pushes: number };
  byCategory: Record<"parlay" | "lock" | "longshot" | "prop", Bucket>;
  bySport: Record<"mlb" | "nba", Bucket>;
  daily: Array<{ date: string; wins: number; losses: number; profitUnits: number }>;
  recent: Array<{
    pick_date: string; sport: string; category: string;
    pick_text: string; game: string; odds: number;
    result: string; profit_units: number; settled_at: string;
  }>;
}

const CATEGORY_LABEL: Record<string, string> = {
  parlay: "Parlay of the Day",
  lock: "Top Locks",
  longshot: "Longshots",
  prop: "Player Props",
};

export default function ResultsPage() {
  const [data, setData] = useState<ResultsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/results?days=${days}`)
      .then(r => r.json())
      .then(d => { setData(d.ok ? d : null); setLoading(false); })
      .catch(() => setLoading(false));
  }, [days]);

  return (
    <div className="min-h-screen bg-void text-silver">
      {/* Header */}
      <header className="border-b border-slate/30 bg-bunker/80 backdrop-blur-lg sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-mercury hover:text-silver transition-colors">
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">Dashboard</span>
          </Link>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-neon/20 to-electric/20 border border-neon/25 flex items-center justify-center">
              <Trophy className="w-4 h-4 text-neon" />
            </div>
            <div>
              <p className="text-sm font-bold text-silver leading-tight">Public Track Record</p>
              <p className="text-[9px] text-mercury/60 font-mono uppercase tracking-wider">Every Pick · Every Result · No Edits</p>
            </div>
          </div>
          <div className="flex items-center gap-1 bg-gunmetal/40 rounded-lg p-0.5">
            {[7, 30, 90].map(n => (
              <button
                key={n}
                onClick={() => setDays(n)}
                className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors ${
                  days === n ? "bg-neon/15 text-neon" : "text-mercury/60 hover:text-mercury"
                }`}
              >
                {n}d
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {loading ? (
          <div className="glass rounded-xl p-12 text-center">
            <Diamond className="w-8 h-8 text-neon/40 mx-auto mb-3 animate-pulse" />
            <p className="text-sm text-mercury">Loading track record...</p>
          </div>
        ) : !data || data.overall.total === 0 ? (
          <div className="glass rounded-xl p-10 text-center">
            <Target className="w-10 h-10 text-mercury/30 mx-auto mb-3" />
            <p className="text-base font-semibold text-silver">Building our track record</p>
            <p className="text-sm text-mercury/70 mt-1 max-w-md mx-auto">
              The first picks are being logged and will settle after games complete. Check back in 24 hours.
            </p>
          </div>
        ) : (
          <>
            {/* Overall stats */}
            <section>
              <h2 className="text-[10px] font-semibold text-mercury/60 uppercase tracking-wider mb-2">
                Last {data.days} days · {data.overall.total} settled picks
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard
                  label="Record"
                  value={`${data.overall.wins}–${data.overall.losses}${data.overall.pushes ? `–${data.overall.pushes}` : ""}`}
                  tone={data.overall.winRate > 52 ? "good" : data.overall.winRate < 48 ? "bad" : "neutral"}
                />
                <StatCard
                  label="Win Rate"
                  value={`${data.overall.winRate.toFixed(1)}%`}
                  tone={data.overall.winRate > 52.4 ? "good" : data.overall.winRate < 50 ? "bad" : "neutral"}
                  sub="vs 52.4% break-even"
                />
                <StatCard
                  label="Profit"
                  value={`${data.overall.profitUnits >= 0 ? "+" : ""}${data.overall.profitUnits.toFixed(1)}u`}
                  tone={data.overall.profitUnits > 0 ? "good" : "bad"}
                  sub="1 unit = 1% bankroll"
                />
                <StatCard
                  label="ROI"
                  value={`${data.overall.total > 0 ? ((data.overall.profitUnits / data.overall.total) * 100).toFixed(1) : "0.0"}%`}
                  tone={data.overall.profitUnits > 0 ? "good" : "bad"}
                  sub="per pick"
                />
              </div>
            </section>

            {/* By category */}
            <section>
              <h2 className="text-[10px] font-semibold text-mercury/60 uppercase tracking-wider mb-2">By pick type</h2>
              <div className="glass rounded-xl overflow-hidden divide-y divide-slate/20">
                {Object.entries(data.byCategory).map(([k, bucket]) => (
                  bucket.total > 0 && (
                    <div key={k} className="px-4 py-3 flex items-center gap-3">
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-silver">{CATEGORY_LABEL[k] ?? k}</p>
                        <p className="text-[11px] text-mercury/60">
                          {bucket.wins}W–{bucket.losses}L · {bucket.total} picks
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-bold font-mono ${bucket.winRate > 52 ? "text-neon" : bucket.winRate < 48 ? "text-danger" : "text-silver"}`}>
                          {bucket.winRate.toFixed(1)}%
                        </p>
                        <p className={`text-[11px] font-mono ${bucket.profitUnits >= 0 ? "text-neon/80" : "text-danger/80"}`}>
                          {bucket.profitUnits >= 0 ? "+" : ""}{bucket.profitUnits.toFixed(1)}u
                        </p>
                      </div>
                    </div>
                  )
                ))}
              </div>
            </section>

            {/* By sport */}
            <section>
              <h2 className="text-[10px] font-semibold text-mercury/60 uppercase tracking-wider mb-2">By sport</h2>
              <div className="grid grid-cols-2 gap-3">
                {(["mlb", "nba"] as const).map(sport => {
                  const b = data.bySport[sport];
                  if (!b || b.total === 0) return (
                    <div key={sport} className="glass rounded-xl p-4">
                      <p className="text-xs text-mercury/50 uppercase tracking-wider">{sport}</p>
                      <p className="text-sm text-mercury/30 mt-1">No picks yet</p>
                    </div>
                  );
                  return (
                    <div key={sport} className="glass rounded-xl p-4">
                      <p className="text-xs text-mercury/60 uppercase tracking-wider mb-1">{sport}</p>
                      <p className="text-2xl font-bold font-mono text-silver">{b.wins}–{b.losses}</p>
                      <div className="flex items-center justify-between mt-1">
                        <p className={`text-xs font-mono ${b.winRate > 52 ? "text-neon" : "text-mercury/70"}`}>
                          {b.winRate.toFixed(1)}%
                        </p>
                        <p className={`text-xs font-mono ${b.profitUnits >= 0 ? "text-neon" : "text-danger"}`}>
                          {b.profitUnits >= 0 ? "+" : ""}{b.profitUnits.toFixed(1)}u
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Daily chart */}
            {data.daily.length > 0 && (
              <section>
                <h2 className="text-[10px] font-semibold text-mercury/60 uppercase tracking-wider mb-2">Daily P/L</h2>
                <div className="glass rounded-xl p-4">
                  <div className="flex items-end gap-1 h-24">
                    {data.daily.slice(-30).map(d => {
                      const maxAbs = Math.max(...data.daily.map(x => Math.abs(x.profitUnits)), 1);
                      const h = Math.max(4, (Math.abs(d.profitUnits) / maxAbs) * 84);
                      return (
                        <div
                          key={d.date}
                          className="flex-1 flex flex-col items-center justify-end gap-0.5"
                          title={`${d.date}: ${d.wins}W–${d.losses}L · ${d.profitUnits >= 0 ? "+" : ""}${d.profitUnits.toFixed(1)}u`}
                        >
                          <div
                            className={`w-full rounded-sm ${d.profitUnits >= 0 ? "bg-neon/70" : "bg-danger/70"}`}
                            style={{ height: `${h}px` }}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-mercury/50 mt-3 text-center font-mono">
                    {data.daily.length} days · green = profit · red = loss
                  </p>
                </div>
              </section>
            )}

            {/* Recent settled */}
            {data.recent.length > 0 && (
              <section>
                <h2 className="text-[10px] font-semibold text-mercury/60 uppercase tracking-wider mb-2">Most recent settled picks</h2>
                <div className="glass rounded-xl overflow-hidden divide-y divide-slate/20">
                  {data.recent.slice(0, 15).map((r, i) => (
                    <div key={i} className="px-3 py-2.5 flex items-center gap-2">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
                        r.result === "win" ? "bg-neon/15" : r.result === "loss" ? "bg-danger/15" : "bg-mercury/15"
                      }`}>
                        {r.result === "win" ? <CheckCircle className="w-3 h-3 text-neon" /> :
                         r.result === "loss" ? <XCircle className="w-3 h-3 text-danger" /> :
                         <Minus className="w-3 h-3 text-mercury" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-silver truncate">{r.pick_text}</p>
                        <p className="text-[10px] text-mercury/50 truncate">
                          {r.pick_date} · {r.sport.toUpperCase()} · {CATEGORY_LABEL[r.category] ?? r.category}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs font-mono text-silver">{r.odds > 0 ? "+" : ""}{r.odds}</p>
                        <p className={`text-[10px] font-mono ${Number(r.profit_units) >= 0 ? "text-neon/80" : "text-danger/80"}`}>
                          {Number(r.profit_units) >= 0 ? "+" : ""}{Number(r.profit_units).toFixed(2)}u
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Transparency note */}
            <section>
              <div className="glass rounded-xl p-4 border border-electric/15 bg-electric/5">
                <p className="text-xs font-semibold text-electric mb-1">How this works</p>
                <p className="text-[11px] text-mercury/80 leading-relaxed">
                  Every pick published in &quot;Today&apos;s Bot Picks&quot;, &quot;Parlay of the Day&quot;, and &quot;Top Locks&quot;
                  is logged to this public record the moment it&apos;s generated. After games complete, the results are
                  graded automatically from the official scores. We don&apos;t hide losing picks or edit past results.
                </p>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function StatCard({ label, value, tone, sub }: { label: string; value: string; tone: "good" | "bad" | "neutral"; sub?: string }) {
  const color = tone === "good" ? "text-neon" : tone === "bad" ? "text-danger" : "text-silver";
  return (
    <div className="glass rounded-xl p-3">
      <p className="text-[10px] text-mercury/60 uppercase tracking-wider">{label}</p>
      <p className={`text-xl font-bold font-mono mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-[9px] text-mercury/40 mt-0.5">{sub}</p>}
    </div>
  );
}
