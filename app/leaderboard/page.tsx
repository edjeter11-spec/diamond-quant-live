"use client";

import { useState, useEffect } from "react";
import { Trophy, Crown, TrendingUp, Diamond, ArrowLeft, Flame, Medal } from "lucide-react";
import Link from "next/link";

interface LeaderboardStats {
  wins: number;
  losses: number;
  roi: number;
  profit: number;
  winRate: number;
  totalBets: number;
  bestStreak: number;
}

interface LeaderboardEntry {
  id: string;
  display_name: string;
  avatar_url: string;
  stats: LeaderboardStats;
}

type Period = "all" | "month" | "week";

const PERIOD_LABELS: Record<Period, string> = {
  all: "All Time",
  month: "This Month",
  week: "This Week",
};

function RankBadge({ rank }: { rank: number }) {
  if (rank === 0)
    return (
      <div className="w-8 h-8 rounded-full bg-gold/20 flex items-center justify-center flex-shrink-0">
        <Medal className="w-4 h-4 text-gold" />
      </div>
    );
  if (rank === 1)
    return (
      <div className="w-8 h-8 rounded-full bg-[#c0c0c0]/15 flex items-center justify-center flex-shrink-0">
        <Medal className="w-4 h-4 text-[#c0c0c0]" />
      </div>
    );
  if (rank === 2)
    return (
      <div className="w-8 h-8 rounded-full bg-[#cd7f32]/15 flex items-center justify-center flex-shrink-0">
        <Medal className="w-4 h-4 text-[#cd7f32]" />
      </div>
    );
  return (
    <div className="w-8 h-8 rounded-full bg-gunmetal/60 flex items-center justify-center flex-shrink-0">
      <span className="text-xs font-bold text-mercury">#{rank + 1}</span>
    </div>
  );
}

function rowBg(rank: number) {
  if (rank === 0) return "bg-gold/5 border-gold/20";
  if (rank === 1) return "bg-[#c0c0c0]/5 border-[#c0c0c0]/15";
  if (rank === 2) return "bg-[#cd7f32]/5 border-[#cd7f32]/15";
  return "bg-bunker border-slate/40";
}

export default function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("all");

  useEffect(() => {
    setLoading(true);
    fetch(`/api/leaderboard?period=${period}`)
      .then(r => r.ok ? r.json() : { entries: [] })
      .then(data => setEntries(data.entries ?? []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [period]);

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
            <p className="text-xs text-mercury font-mono">TOP BETTORS — RANKED BY WIN RATE</p>
          </div>
        </div>

        {/* Period Tabs */}
        <div className="flex gap-1 mb-4 bg-bunker rounded-lg p-1 border border-slate/40">
          {(["all", "month", "week"] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`flex-1 py-2 rounded-md text-[11px] font-semibold transition-all ${
                period === p ? "bg-neon/10 text-neon" : "text-mercury hover:text-white"
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>

        {/* Column headers */}
        {!loading && entries.length > 0 && (
          <div className="grid grid-cols-[2.5rem_1fr_auto_auto_auto_auto] gap-2 px-4 pb-1 text-[9px] text-mercury/50 uppercase font-semibold tracking-wider">
            <span>Rank</span>
            <span>User</span>
            <span className="text-right">Record</span>
            <span className="text-right">Win%</span>
            <span className="text-right">ROI</span>
            <span className="text-right">Streak</span>
          </div>
        )}

        {/* Entries */}
        {loading ? (
          <div className="text-center py-12">
            <Diamond className="w-8 h-8 text-mercury/20 mx-auto animate-pulse" />
            <p className="text-sm text-mercury mt-3">Loading rankings...</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-12 glass rounded-xl border border-slate/30 px-6">
            <Trophy className="w-8 h-8 text-mercury/20 mx-auto" />
            <p className="text-sm text-silver mt-3 font-semibold">No ranked bettors yet</p>
            <p className="text-xs text-mercury/60 mt-1 max-w-xs mx-auto">
              Be the first on the leaderboard — track your picks in the app
            </p>
            <Link
              href="/"
              className="mt-4 inline-block text-[11px] text-electric hover:text-neon transition-colors"
            >
              Start tracking picks →
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map((entry, i) => (
              <div
                key={entry.id}
                className={`rounded-xl border p-3 grid grid-cols-[2.5rem_1fr_auto_auto_auto_auto] items-center gap-2 transition-colors ${rowBg(i)}`}
              >
                <RankBadge rank={i} />

                {/* Avatar + Name */}
                <div className="flex items-center gap-2 min-w-0">
                  {entry.avatar_url ? (
                    <img src={entry.avatar_url} alt="" className="w-7 h-7 rounded-full flex-shrink-0" />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-neon/10 flex items-center justify-center text-neon text-xs font-bold flex-shrink-0">
                      {(entry.display_name?.[0] || "?").toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1">
                      <p className="text-xs font-semibold text-white truncate">{entry.display_name}</p>
                      {i === 0 && <Crown className="w-3 h-3 text-gold flex-shrink-0" />}
                      {entry.stats.roi > 15 && <Flame className="w-3 h-3 text-danger flex-shrink-0" />}
                    </div>
                    <p className="text-[9px] text-mercury/50">{entry.stats.totalBets} bets</p>
                  </div>
                </div>

                {/* Record */}
                <span className="text-[10px] text-mercury font-mono text-right">
                  {entry.stats.wins}W-{entry.stats.losses}L
                </span>

                {/* Win% */}
                <span className={`text-[11px] font-bold font-mono text-right ${entry.stats.winRate >= 55 ? "text-neon" : "text-silver"}`}>
                  {entry.stats.winRate.toFixed(1)}%
                </span>

                {/* ROI */}
                <span className={`text-[11px] font-bold font-mono text-right ${entry.stats.roi >= 0 ? "text-neon" : "text-danger"}`}>
                  {entry.stats.roi >= 0 ? "+" : ""}{entry.stats.roi.toFixed(1)}%
                </span>

                {/* Best Streak */}
                <div className="flex items-center gap-0.5 justify-end">
                  <TrendingUp className="w-3 h-3 text-mercury/50" />
                  <span className="text-[10px] text-mercury font-mono">{entry.stats.bestStreak}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-8 space-y-1">
          <p className="text-[10px] text-mercury/50">
            Rankings update every 30 min • Min 5 settled bets to qualify
          </p>
          <Link href="/" className="text-[10px] text-electric hover:text-neon transition-colors">
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
