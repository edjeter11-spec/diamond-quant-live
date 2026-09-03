"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Flame } from "lucide-react";

interface StreakData {
  last7Record: { wins: number; losses: number; winRate: number };
  currentStreak: { type: "W" | "L" | null; length: number };
  last7Profit: number; // in units
}

// Fetches rolling 7-day stats from /api/results (real bot pick history) and
// renders a high-impact "X picks in a row hit" social-proof banner. Hidden
// entirely unless there's a current win streak of 3+ — no streak, no noise.
export default function StreakBanner() {
  const [data, setData] = useState<StreakData | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/results?days=7")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d.ok || d.overall?.total === 0) return;
        const daily = d.daily ?? [];
        // Compute current streak from most recent days
        let currentStreak: { type: "W" | "L" | null; length: number } = {
          type: null,
          length: 0,
        };
        for (let i = daily.length - 1; i >= 0; i--) {
          const day = daily[i];
          const net = day.wins - day.losses;
          if (net > 0) {
            if (currentStreak.type === null || currentStreak.type === "W") {
              currentStreak = { type: "W", length: currentStreak.length + 1 };
            } else break;
          } else if (net < 0) {
            if (currentStreak.type === null || currentStreak.type === "L") {
              currentStreak = { type: "L", length: currentStreak.length + 1 };
            } else break;
          } else continue;
        }
        setData({
          last7Record: {
            wins: d.overall.wins,
            losses: d.overall.losses,
            winRate: d.overall.winRate,
          },
          currentStreak,
          last7Profit: d.overall.profitUnits ?? 0,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Hard gate: only render on a real heater (3+ winning days in a row)
  if (!data) return null;
  if (data.currentStreak.type !== "W" || data.currentStreak.length < 3)
    return null;

  const { last7Record, currentStreak, last7Profit } = data;

  return (
    <Link
      href="/results"
      className="block relative rounded-2xl overflow-hidden glass glass-hover border-gold/20 bg-gradient-to-r from-gold/[0.07] to-transparent transition-all"
    >
      {/* Subtle moving sheen */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.04] to-transparent pointer-events-none" />

      <div className="relative flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-3 sm:py-3.5">
        {/* Flame badge */}
        <div className="relative flex-shrink-0">
          <div className="absolute inset-0 rounded-full bg-gold/30 blur-md animate-pulse" />
          <div className="relative w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-gradient-to-br from-gold/30 to-danger/20 border border-gold/50 flex items-center justify-center">
            <Flame className="w-6 h-6 sm:w-7 sm:h-7 text-gold drop-shadow-[0_0_8px_rgba(255,215,0,0.8)]" />
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm sm:text-base font-bold text-silver leading-tight">
            {/* DAYS, not picks. The loop above walks the `daily` array and
                counts days where wins - losses > 0, so a 3-day run of
                4-3, 5-4, 3-2 was rendering as "3 picks in a row hit" while the
                real record over those days was 12-9. Say what's counted. */}
            <span className="text-gold">
              {currentStreak.length} winning{" "}
              {currentStreak.length === 1 ? "day" : "days"} in a row
            </span>
            <span className="text-mercury/60 font-normal">
              {" "}
              · the bot is heating up
            </span>
          </p>
          <p className="text-[11px] sm:text-xs text-mercury mt-0.5 font-mono">
            7-day record:{" "}
            <span className="text-silver font-bold">
              {last7Record.wins}W–{last7Record.losses}L
            </span>
            <span className="text-mercury/40"> · </span>
            <span className="text-neon font-bold">
              {last7Profit >= 0 ? "+" : ""}
              {last7Profit.toFixed(1)}u
            </span>
            <span className="text-mercury/40"> · </span>
            <span className="text-electric">
              {last7Record.winRate.toFixed(0)}% win rate
            </span>
          </p>
        </div>

        <div className="hidden sm:block text-[10px] text-mercury/60 font-mono uppercase tracking-wider flex-shrink-0">
          Tap for full record
        </div>
      </div>
    </Link>
  );
}
