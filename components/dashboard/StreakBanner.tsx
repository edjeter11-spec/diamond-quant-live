"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Flame, TrendingDown, TrendingUp, Minus } from "lucide-react";

interface StreakData {
  last7Record: { wins: number; losses: number; winRate: number };
  currentStreak: { type: "W" | "L" | null; length: number };
  yesterdayProfit: number; // in units
  last7Profit: number;     // in units
}

// Fetches rolling 7-day stats from /api/results and renders a compact
// "we're 5-2 this week" banner at the top of the Board. Silent when
// there's no track record yet.
export default function StreakBanner() {
  const [data, setData] = useState<StreakData | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/results?days=7")
      .then(r => r.json())
      .then(d => {
        if (cancelled || !d.ok || d.overall?.total === 0) return;
        const daily = d.daily ?? [];
        // Compute current streak from most recent days
        let currentStreak: { type: "W" | "L" | null; length: number } = { type: null, length: 0 };
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
        const yesterday = daily[daily.length - 1];
        setData({
          last7Record: {
            wins: d.overall.wins,
            losses: d.overall.losses,
            winRate: d.overall.winRate,
          },
          currentStreak,
          yesterdayProfit: yesterday?.profitUnits ?? 0,
          last7Profit: d.overall.profitUnits ?? 0,
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!data || data.last7Record.wins + data.last7Record.losses === 0) return null;

  const { last7Record, currentStreak, last7Profit } = data;
  const isHot = last7Profit > 0;
  const isCold = last7Profit < -1;
  const neutral = !isHot && !isCold;

  const tone = isHot ? "neon" : isCold ? "danger" : "mercury";
  const Icon = isHot ? TrendingUp : isCold ? TrendingDown : Minus;

  return (
    <Link
      href="/results"
      className={`block glass rounded-xl px-3 sm:px-4 py-2.5 border border-${tone}/20 bg-${tone}/5 hover:bg-${tone}/10 transition-colors`}
    >
      <div className="flex items-center gap-2.5">
        <div className={`w-8 h-8 rounded-lg bg-${tone}/15 flex items-center justify-center flex-shrink-0`}>
          {currentStreak.type === "W" && currentStreak.length >= 3 ? (
            <Flame className="w-4 h-4 text-neon" />
          ) : (
            <Icon className={`w-4 h-4 text-${tone}`} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs sm:text-sm font-semibold text-silver">
            {currentStreak.type === "W" && currentStreak.length >= 3 && (
              <span className="text-neon">🔥 {currentStreak.length}-day win streak · </span>
            )}
            Last 7 days: <span className="text-silver font-bold">{last7Record.wins}W–{last7Record.losses}L</span>
            <span className={`ml-2 font-mono font-bold text-${tone}`}>
              {last7Profit >= 0 ? "+" : ""}{last7Profit.toFixed(1)}u
            </span>
          </p>
          <p className="text-[10px] text-mercury/60 mt-0.5">
            {neutral
              ? "Tracking performance — check /results for full history"
              : isHot
              ? `${last7Record.winRate.toFixed(1)}% win rate · tap for full record`
              : "Cold patch — our job is to learn from it. Tap for details."}
          </p>
        </div>
      </div>
    </Link>
  );
}
