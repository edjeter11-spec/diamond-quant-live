"use client";

import { useState, useEffect } from "react";
import { Trophy, Crown, TrendingUp, TrendingDown, Diamond, ArrowLeft, Flame, Medal } from "lucide-react";
import Link from "next/link";

interface LeaderboardEntry {
  id: string;
  display_name: string;
  avatar_url: string;
  stats: {
    wins: number;
    losses: number;
    roi: number;
    profit: number;
    winRate: number;
    totalBets: number;
  };
}

export default function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"roi" | "profit" | "winRate" | "totalBets">("roi");

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/leaderboard");
        if (res.ok) {
          const data = await res.json();
          setEntries(data.entries ?? []);
        }
      } catch {}
      setLoading(false);
    }
    load();
  }, []);

  const sorted = [...entries].sort((a, b) => {
    if (sortBy === "roi") return b.stats.roi - a.stats.roi;
    if (sortBy === "profit") return b.stats.profit - a.stats.profit;
    if (sortBy === "winRate") return b.stats.winRate - a.stats.winRate;
    return b.stats.totalBets - a.stats.totalBets;
  });

  return (
    <div className="min-h-screen bg-void text-silver">
      <div className="max-w-3xl mx-auto px-4 pt-6 pb-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link href="/" className="p-2 rounded-lg hover:bg-gunmetal/60 transition-colors">
            <ArrowLeft className="w-4 h-4 text-mercury" />
          </Link>
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-gold/20 to-danger/20 flex items-center justify-center border border-gold/20">
            <Trophy className="w-5 h-5 text-gold" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Leaderboard</h1>
            <p className="text-xs text-mercury font-mono">TOP BETTORS — RANKED BY PERFORMANCE</p>
          </div>
        </div>

        {/* Sort Tabs */}
        <div className="flex gap-1 mb-4 bg-bunker rounded-lg p-1 border border-slate/40">
          {(["roi", "profit", "winRate", "totalBets"] as const).map(key => (
            <button
              key={key}
              onClick={() => setSortBy(key)}
              className={`flex-1 py-2 rounded-md text-[11px] font-semibold transition-all ${
                sortBy === key ? "bg-neon/10 text-neon" : "text-mercury hover:text-white"
              }`}
            >
              {key === "roi" ? "ROI" : key === "profit" ? "Profit" : key === "winRate" ? "Win %" : "Volume"}
            </button>
          ))}
        </div>

        {/* Entries */}
        {loading ? (
          <div className="text-center py-12">
            <Diamond className="w-8 h-8 text-mercury/20 mx-auto animate-pulse" />
            <p className="text-sm text-mercury mt-3">Loading rankings...</p>
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-12">
            <Trophy className="w-8 h-8 text-mercury/20 mx-auto" />
            <p className="text-sm text-mercury mt-3">No ranked bettors yet</p>
            <p className="text-xs text-mercury/50 mt-1">Sign up and log bets to appear on the leaderboard</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sorted.map((entry, i) => (
              <div
                key={entry.id}
                className={`rounded-xl border p-4 flex items-center gap-3 transition-colors ${
                  i === 0 ? "bg-gold/5 border-gold/20" :
                  i === 1 ? "bg-[#c0c0c0]/5 border-[#c0c0c0]/15" :
                  i === 2 ? "bg-[#cd7f32]/5 border-[#cd7f32]/15" :
                  "bg-bunker border-slate/40"
                }`}
              >
                {/* Rank */}
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                  i === 0 ? "bg-gold/20" : i === 1 ? "bg-[#c0c0c0]/15" : i === 2 ? "bg-[#cd7f32]/15" : "bg-gunmetal/60"
                }`}>
                  {i < 3 ? (
                    <Medal className={`w-4 h-4 ${i === 0 ? "text-gold" : i === 1 ? "text-[#c0c0c0]" : "text-[#cd7f32]"}`} />
                  ) : (
                    <span className="text-xs font-bold text-mercury">{i + 1}</span>
                  )}
                </div>

                {/* Avatar + Name */}
                {entry.avatar_url ? (
                  <img src={entry.avatar_url} alt="" className="w-8 h-8 rounded-full" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-neon/10 flex items-center justify-center text-neon text-sm font-bold">
                    {(entry.display_name?.[0] || "?").toUpperCase()}
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-semibold text-white truncate">{entry.display_name}</p>
                    {i === 0 && <Crown className="w-3.5 h-3.5 text-gold" />}
                    {entry.stats.roi > 10 && <Flame className="w-3 h-3 text-danger" />}
                  </div>
                  <p className="text-[10px] text-mercury">
                    {entry.stats.wins}W-{entry.stats.losses}L • {entry.stats.totalBets} bets
                  </p>
                </div>

                {/* Stats */}
                <div className="text-right flex-shrink-0">
                  <p className={`text-sm font-bold font-mono ${entry.stats.roi > 0 ? "text-neon" : "text-danger"}`}>
                    {entry.stats.roi >= 0 ? "+" : ""}{entry.stats.roi.toFixed(1)}%
                  </p>
                  <p className={`text-[10px] font-mono ${entry.stats.profit >= 0 ? "text-neon/70" : "text-danger/70"}`}>
                    {entry.stats.profit >= 0 ? "+" : ""}${entry.stats.profit.toFixed(0)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-8">
          <p className="text-[10px] text-mercury/50">Rankings update every 30 minutes • Min 10 settled bets to qualify</p>
          <Link href="/" className="text-[10px] text-electric hover:text-neon transition-colors">
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
