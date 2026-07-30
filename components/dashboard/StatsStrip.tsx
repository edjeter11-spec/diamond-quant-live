"use client";

// Desktop stats strip — the bottom bar from the product render.
//
// Every number here comes from /api/results, which rolls up ACTUAL graded
// picks (daily_picks_log + prop_predictions). Nothing is hardcoded.
//
// Two deliberate choices:
//  1. If the sample is too thin to mean anything, we say so instead of
//     printing a win rate. A 4-1 start is not "80% accuracy" and showing it
//     as such on a betting site is the kind of number people stake money on.
//  2. If the API is unavailable we render nothing rather than falling back to
//     placeholder figures — an empty strip is honest, a fake one isn't.

import { useEffect, useState } from "react";
import { TrendingUp, Target, Layers, Activity } from "lucide-react";

const MIN_SAMPLE = 30; // below this, report the count and skip the rate

interface Overall {
  total: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;
  profitUnits: number;
}

export default function StatsStrip() {
  const [overall, setOverall] = useState<Overall | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/results?days=30", {
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error(String(res.status));
        const d = await res.json();
        if (!cancelled) {
          if (d?.ok && d.overall) setOverall(d.overall);
          else setFailed(true);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // No data, or not enough of it to say anything — render nothing rather
  // than inventing a stat line.
  if (failed || !overall || overall.total === 0) return null;

  const decided = overall.wins + overall.losses;
  const thin = decided < MIN_SAMPLE;
  const profit = overall.profitUnits;

  const items = [
    {
      icon: Target,
      label: "Graded Picks (30d)",
      value: overall.total.toLocaleString(),
      tone: "text-electric",
    },
    {
      icon: Activity,
      label: thin ? "Record" : "Win Rate (30d)",
      value: thin
        ? `${overall.wins}-${overall.losses}`
        : `${overall.winRate.toFixed(1)}%`,
      tone: "text-neon",
    },
    {
      icon: TrendingUp,
      label: "Units (30d)",
      value: `${profit >= 0 ? "+" : ""}${profit.toFixed(1)}u`,
      tone: profit >= 0 ? "text-neon" : "text-rose-400",
    },
    {
      icon: Layers,
      label: "Pushes",
      value: String(overall.pushes ?? 0),
      tone: "text-mercury",
    },
  ];

  return (
    <div className="hidden lg:block rounded-xl border border-slate/25 bg-bunker/60 backdrop-blur">
      <div className="grid grid-cols-4 divide-x divide-slate/15">
        {items.map((it) => (
          <div
            key={it.label}
            className="flex items-center gap-3 px-5 py-3.5 min-w-0"
          >
            <div className="w-9 h-9 rounded-lg bg-gunmetal/60 border border-slate/25 flex items-center justify-center flex-shrink-0">
              <it.icon className={`w-4 h-4 ${it.tone}`} />
            </div>
            <div className="min-w-0">
              <p
                className={`text-lg font-bold font-mono leading-none ${it.tone}`}
              >
                {it.value}
              </p>
              <p className="text-[10px] text-mercury/60 mt-1 truncate">
                {it.label}
              </p>
            </div>
          </div>
        ))}
      </div>
      {thin && (
        <p className="px-5 pb-2.5 -mt-1 text-[10px] text-amber/80">
          Small sample ({decided} decided) — too early to read a win rate into
          this.
        </p>
      )}
    </div>
  );
}
