"use client";

// ──────────────────────────────────────────────────────────
// ADMIN BEST BOARD — every pick source the models produced today, one
// ranked table. Admin-only (server enforces too — /api/admin/best-board
// checks is_admin; this gate is just UX).
// ──────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/supabase/auth";
import { supabase } from "@/lib/supabase/client";
import { Shield, RefreshCw, ArrowLeft, Trophy } from "lucide-react";
import Link from "next/link";

interface BoardRow {
  source: string;
  pick: string;
  game: string;
  market: string;
  odds: number | null;
  bookmaker: string | null;
  fairProb: number | null;
  evPct: number | null;
  note?: string;
}

const SOURCE_BADGE: Record<string, { label: string; cls: string }> = {
  published: { label: "BOARD", cls: "bg-neon/15 text-neon border-neon/30" },
  parlay: { label: "PARLAY", cls: "bg-gold/15 text-gold border-gold/30" },
  "sharp-ml": {
    label: "SHARP",
    cls: "bg-electric/15 text-electric border-electric/30",
  },
  "model-game": {
    label: "MODEL",
    cls: "bg-purple/15 text-purple border-purple/30",
  },
  "prop-pool": {
    label: "POOL",
    cls: "bg-mercury/10 text-mercury border-mercury/25",
  },
};

const fmtOdds = (o: number | null) =>
  typeof o === "number" ? `${o > 0 ? "+" : ""}${o}` : "—";

export default function AdminBoardPage() {
  const { isAdmin, loading: authLoading } = useAuth();
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [sources, setSources] = useState<Record<string, string>>({});
  const [generatedAt, setGeneratedAt] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch("/api/admin/best-board", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      setRows(d.rows ?? []);
      setSources(d.sources ?? {});
      setGeneratedAt(d.generatedAt ?? "");
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    load();
  }, [isAdmin, load]);

  if (authLoading)
    return (
      <div className="min-h-screen bg-bunker flex items-center justify-center text-mercury text-sm">
        Loading…
      </div>
    );
  if (!isAdmin)
    return (
      <div className="min-h-screen bg-bunker flex flex-col items-center justify-center gap-3 text-mercury">
        <Shield className="w-8 h-8 text-danger/60" />
        <p className="text-sm">Admin only.</p>
        <Link href="/" className="text-xs text-electric underline">
          Back to the board
        </Link>
      </div>
    );

  const visible =
    filter === "all" ? rows : rows.filter((r) => r.source === filter);

  return (
    <div className="min-h-screen bg-bunker text-silver">
      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <Link
            href="/admin"
            className="flex items-center justify-center min-w-[40px] min-h-[40px] rounded-lg bg-gunmetal/40 hover:bg-gunmetal/60 text-mercury"
            aria-label="Back to admin"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <Trophy className="w-5 h-5 text-gold" />
          <div className="flex-1">
            <h1 className="text-lg font-bold text-white">Best Board</h1>
            <p className="text-[11px] text-mercury/60">
              Every source, ranked by EV — the full list behind today&apos;s
              public 3.
              {generatedAt &&
                ` Generated ${new Date(generatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.`}
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center justify-center min-w-[40px] min-h-[40px] rounded-lg bg-gunmetal/40 hover:bg-gunmetal/60 text-mercury"
            aria-label="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Source status strip */}
        <div className="flex flex-wrap gap-2 mb-4">
          {Object.entries(SOURCE_BADGE).map(([key, b]) => (
            <button
              key={key}
              onClick={() => setFilter(filter === key ? "all" : key)}
              className={`px-2.5 py-1 rounded-lg border text-[10px] font-bold tracking-wide transition-all ${b.cls} ${
                filter !== "all" && filter !== key ? "opacity-30" : ""
              }`}
              title={sources[key] ?? ""}
            >
              {b.label}
              {sources[key] ? ` · ${sources[key]}` : ""}
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-lg bg-danger/10 border border-danger/30 px-3 py-2 text-xs text-danger mb-4">
            {error}
          </div>
        )}

        {loading && rows.length === 0 ? (
          <div className="rounded-xl bg-gunmetal/20 p-8 text-center text-sm text-mercury">
            <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
            Aggregating every source…
          </div>
        ) : (
          <div className="rounded-xl border border-slate/20 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate/25 bg-gunmetal/30 text-left text-[10px] uppercase tracking-wider text-mercury/70">
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Src</th>
                  <th className="px-3 py-2">Pick</th>
                  <th className="px-3 py-2">Game</th>
                  <th className="px-3 py-2 text-right">Odds</th>
                  <th className="px-3 py-2">Book</th>
                  <th className="px-3 py-2 text-right">Fair%</th>
                  <th className="px-3 py-2 text-right">EV%</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r, i) => {
                  const badge =
                    SOURCE_BADGE[r.source] ?? SOURCE_BADGE["prop-pool"];
                  return (
                    <tr
                      key={`${r.source}-${r.pick}-${i}`}
                      className="border-b border-slate/10 hover:bg-gunmetal/20"
                    >
                      <td className="px-3 py-2 text-mercury/50 font-mono">
                        {i + 1}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded border text-[9px] font-bold ${badge.cls}`}
                          title={r.note ?? ""}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-semibold text-silver">
                        {r.pick}
                        {r.note && (
                          <span className="block text-[9px] text-mercury/50 font-normal">
                            {r.note}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-mercury/70 max-w-[200px] truncate">
                        {r.game}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {fmtOdds(r.odds)}
                      </td>
                      <td className="px-3 py-2 text-mercury/70">
                        {r.bookmaker ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {typeof r.fairProb === "number"
                          ? `${Math.round(r.fairProb)}%`
                          : "—"}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-mono font-bold ${
                          (r.evPct ?? 0) >= 0 ? "text-neon" : "text-danger"
                        }`}
                      >
                        {typeof r.evPct === "number"
                          ? `${r.evPct >= 0 ? "+" : ""}${r.evPct.toFixed(1)}%`
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
                {visible.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-3 py-8 text-center text-mercury/60"
                    >
                      Nothing from this source right now.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
