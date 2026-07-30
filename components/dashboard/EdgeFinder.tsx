"use client";

// "Edge Finder" gauge from the product render.
//
// The number is computed live from the odds already in the store: what share
// of today's games contain at least one bet our model flags as +EV, after the
// same dead-line filtering the rest of the app uses (filterRealEV strips
// stale/suspicious lines that would otherwise inflate this).
//
// It is a measure of TODAY'S SLATE, not of our accuracy — the label says so
// explicitly, because "42%" floating on a betting dashboard invites being read
// as a hit rate.

import { useMemo } from "react";
import { useStore } from "@/lib/store";
import { filterRealEV } from "@/lib/odds/sportsbooks";
import { Crosshair } from "lucide-react";

export default function EdgeFinder() {
  const { oddsData } = useStore();

  const { pct, withEdge, total } = useMemo(() => {
    const games = oddsData ?? [];
    if (games.length === 0) return { pct: 0, withEdge: 0, total: 0 };
    const n = games.filter(
      (g: any) => filterRealEV(g.evBets ?? []).length > 0,
    ).length;
    return {
      pct: Math.round((n / games.length) * 100),
      withEdge: n,
      total: games.length,
    };
  }, [oddsData]);

  // Nothing to measure yet (no odds loaded / quota exhausted) — say that
  // rather than rendering a confident 0%.
  if (total === 0) {
    return (
      <div className="glass rounded-xl border border-slate/20 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Crosshair className="w-4 h-4 text-electric" />
          <h3 className="text-xs font-bold text-silver uppercase tracking-wider">
            Edge Finder
          </h3>
        </div>
        <p className="text-xs text-mercury/70">
          Waiting on odds data to scan today&apos;s slate.
        </p>
      </div>
    );
  }

  // Gauge geometry
  const R = 38;
  const C = 2 * Math.PI * R;
  const dash = (pct / 100) * C;

  return (
    <div className="glass rounded-xl border border-slate/20 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Crosshair className="w-4 h-4 text-electric" />
        <h3 className="text-xs font-bold text-silver uppercase tracking-wider">
          Edge Finder
        </h3>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-shrink-0">
          <svg width="92" height="92" viewBox="0 0 92 92">
            <circle
              cx="46"
              cy="46"
              r={R}
              fill="none"
              stroke="currentColor"
              strokeWidth="7"
              className="text-slate/20"
            />
            <circle
              cx="46"
              cy="46"
              r={R}
              fill="none"
              stroke="currentColor"
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${C - dash}`}
              transform="rotate(-90 46 46)"
              className="text-electric transition-all duration-700"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xl font-bold font-mono text-electric">
              {pct}%
            </span>
          </div>
        </div>

        <div className="min-w-0">
          <p className="text-xs text-silver font-semibold leading-snug">
            {withEdge} of {total} games
          </p>
          <p className="text-[11px] text-mercury/70 leading-snug mt-1">
            show a model edge on today&apos;s slate.
          </p>
          <p className="text-[10px] text-mercury/50 leading-snug mt-2">
            Slate coverage — not a win rate.
          </p>
        </div>
      </div>
    </div>
  );
}
