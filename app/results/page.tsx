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
  parlay: "Parlay",
  lock: "Lock",
  longshot: "Longshot",
  prop: "Prop",
};

type FilterKey = "all" | "mlb" | "nba" | "ml" | "spread" | "total" | "HIGH" | "MEDIUM" | "LOW";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "mlb", label: "MLB" },
  { key: "nba", label: "NBA" },
  { key: "ml", label: "ML" },
  { key: "spread", label: "Spread" },
  { key: "total", label: "Total" },
  { key: "HIGH", label: "HIGH" },
  { key: "MEDIUM", label: "MED" },
  { key: "LOW", label: "LOW" },
];

export default function ResultsPage() {
  const [data, setData] = useState<ResultsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [filter, setFilter] = useState<FilterKey>("all");

  useEffect(() => {
    setLoading(true);
    fetch(`/api/results?days=${days}`)
      .then(r => r.json())
      .then(d => { setData(d.ok ? d : null); setLoading(false); })
      .catch(() => setLoading(false));
  }, [days]);

  // Derived ROI
  const roi = data && data.overall.total > 0
    ? (data.overall.profitUnits / data.overall.total) * 100
    : null;

  // Filtered recent rows
  const filteredRecent = (data?.recent ?? []).filter(r => {
    if (filter === "all") return true;
    if (filter === "mlb") return r.sport === "mlb";
    if (filter === "nba") return r.sport === "nba";
    if (filter === "ml") return r.category?.toLowerCase().includes("ml") || r.pick_text?.toLowerCase().includes(" ml");
    if (filter === "spread") return r.pick_text?.toLowerCase().includes("spread") || r.pick_text?.match(/[+-]\d+\.5/);
    if (filter === "total") return r.pick_text?.toLowerCase().match(/over|under/);
    if (filter === "HIGH" || filter === "MEDIUM" || filter === "LOW") {
      return r.category?.toUpperCase() === filter;
    }
    return true;
  });

  return (
    <div className="min-h-screen bg-void text-silver">
      {/* Header */}
      <header className="border-b border-slate/30 bg-bunker/80 backdrop-blur-lg sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 min-h-[44px] -ml-2 px-2 rounded-lg text-mercury hover:text-silver hover:bg-gunmetal/40 transition-colors">
            <ArrowLeft className="w-5 h-5" />
            <span className="text-sm font-medium">Dashboard</span>
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
                className={`min-w-[44px] min-h-[36px] px-3 rounded text-[12px] font-semibold transition-colors ${
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
          /* ── Empty State ── */
          <div className="glass rounded-xl p-10 text-center">
            <Target className="w-10 h-10 text-mercury/30 mx-auto mb-3" />
            <p className="text-base font-semibold text-silver">Building our track record</p>
            <p className="text-sm text-mercury/70 mt-1 max-w-md mx-auto">
              The first picks are being logged and will settle after games complete. Check back in 24 hours.
            </p>
          </div>
        ) : (
          <>
            {/* ── Hero Record + ROI strip ── */}
            <section className="glass rounded-xl p-4 sm:p-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                {/* Record */}
                <div>
                  <p className="text-[10px] font-semibold text-mercury/50 uppercase tracking-wider mb-1">
                    Last {data.days} days
                  </p>
                  <p className="text-3xl font-bold font-mono text-silver">
                    W {data.overall.wins}
                    <span className="text-mercury/30 mx-2">—</span>
                    L {data.overall.losses}
                    {data.overall.pushes > 0 && (
                      <>
                        <span className="text-mercury/30 mx-2">—</span>
                        P {data.overall.pushes}
                      </>
                    )}
                  </p>
                  <p className="text-sm text-mercury/60 mt-1">
                    {data.overall.total} settled picks ·{" "}
                    <span className={data.overall.winRate > 52.4 ? "text-neon" : "text-mercury/60"}>
                      {data.overall.winRate.toFixed(1)}% win rate
                    </span>
                  </p>
                </div>

                {/* ROI badge */}
                {roi !== null && (
                  <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border font-bold ${
                    roi >= 0
                      ? "bg-neon/10 border-neon/25 text-neon"
                      : "bg-danger/10 border-danger/25 text-danger"
                  }`}>
                    {roi >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                    <span className="text-lg font-mono">
                      {roi >= 0 ? "+" : ""}{roi.toFixed(1)}% ROI
                    </span>
                  </div>
                )}
              </div>
            </section>

            {/* Overall stats */}
            <section>
              <h2 className="text-[10px] font-semibold text-mercury/60 uppercase tracking-wider mb-2">
                Performance breakdown
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
                  value={`${roi !== null ? (roi >= 0 ? "+" : "") + roi.toFixed(1) : "0.0"}%`}
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

            {/* Recent settled — with filter row */}
            <section>
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <h2 className="text-[10px] font-semibold text-mercury/60 uppercase tracking-wider">
                  Recent settled picks
                </h2>
                {/* Filter chips */}
                <div className="flex items-center gap-1 flex-wrap">
                  {FILTERS.map(f => (
                    <button
                      key={f.key}
                      onClick={() => setFilter(f.key)}
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                        filter === f.key
                          ? "bg-neon/15 text-neon border border-neon/25"
                          : "text-mercury/50 hover:text-mercury border border-transparent"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {filteredRecent.length === 0 ? (
                <div className="glass rounded-xl p-8 text-center">
                  <Target className="w-8 h-8 text-mercury/20 mx-auto mb-2" />
                  <p className="text-sm text-mercury/50">No picks match this filter yet.</p>
                </div>
              ) : (
                <div className="glass rounded-xl overflow-hidden divide-y divide-slate/20">
                  {filteredRecent.slice(0, 20).map((r, i) => (
                    <div key={i} className="px-3 py-2.5 flex items-center gap-2.5">
                      {/* Result badge */}
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                        r.result === "win" ? "bg-neon/15" : r.result === "loss" ? "bg-danger/15" : "bg-mercury/15"
                      }`}>
                        {r.result === "win" ? (
                          <CheckCircle className="w-3.5 h-3.5 text-neon" />
                        ) : r.result === "loss" ? (
                          <XCircle className="w-3.5 h-3.5 text-danger" />
                        ) : (
                          <Minus className="w-3.5 h-3.5 text-mercury" />
                        )}
                      </div>

                      {/* Pick info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-silver truncate">{r.pick_text}</p>
                        <p className="text-[10px] text-mercury/50 truncate">
                          {r.game} · {r.pick_date} · {r.sport?.toUpperCase()}
                        </p>
                      </div>

                      {/* Result label */}
                      <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        r.result === "win"
                          ? "bg-neon/10 text-neon"
                          : r.result === "loss"
                          ? "bg-danger/10 text-danger"
                          : "bg-mercury/10 text-mercury"
                      }`}>
                        {r.result === "win" ? "W" : r.result === "loss" ? "L" : "P"}
                      </span>

                      {/* Odds + P/L */}
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs font-mono text-silver">{r.odds > 0 ? "+" : ""}{r.odds}</p>
                        <p className={`text-[10px] font-mono ${Number(r.profit_units) >= 0 ? "text-neon/80" : "text-danger/80"}`}>
                          {Number(r.profit_units) >= 0 ? "+" : ""}{Number(r.profit_units).toFixed(2)}u
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

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
