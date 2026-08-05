"use client";

import { useEffect, useState } from "react";
import { LineChart } from "lucide-react";

// ──────────────────────────────────────────────────────────
// PROPS CLV PANEL — reads /api/props-clv-report.
//
// This is the real accuracy metric for the props board. Win/loss needs
// hundreds of graded picks to mean anything; whether the posted fair prob
// beats the closer resolves in ~20-50. Once `beatClosePct` is consistently
// above 50%, it's the honest thing to put on /track-record — "our picks beat
// the closing line X% of the time" is a claim that survives scrutiny in a way
// a raw win rate doesn't.
// ──────────────────────────────────────────────────────────

export default function PropsClvPanel() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch("/api/props-clv-report")
      .then((r) => r.json())
      .then((d) => d?.ok && setData(d))
      .catch(() => {});
  }, []);

  if (!data || data.totalLogged === 0) return null;

  return (
    <div className="rounded-xl bg-[#0a0e17] border border-[#232a3d]/50 p-4">
      <div className="flex items-center gap-2 mb-1">
        <LineChart className="w-4 h-4 text-[#4cc9ff]" />
        <h3 className="text-sm font-bold text-white">Props Board CLV</h3>
        <span className="text-[10px] text-[#8e9ab5] font-mono">
          POST vs CLOSE
        </span>
      </div>
      <p className="text-[11px] text-[#8e9ab5] mb-3 leading-snug">
        {data.closed} closed · {data.pending} pending
        {data.missed > 0 && ` · ${data.missed} missed`}
      </p>

      {data.closed > 0 ? (
        <p className="text-[11px] text-[#e6eaf4] mb-2">
          <span
            className={
              (data.avgFairProbDelta ?? 0) < 0
                ? "text-[#4ade80] font-bold"
                : "text-[#ff5c7a] font-bold"
            }
          >
            {data.beatClosePct}% beat the close
          </span>
        </p>
      ) : (
        <p className="text-[11px] text-[#8e9ab5] italic mb-2">
          No picks have closed yet — closers snapshot ~40min before first pitch.
        </p>
      )}
      <p className="text-[10px] text-[#8e9ab5]">{data.verdict}</p>
    </div>
  );
}
