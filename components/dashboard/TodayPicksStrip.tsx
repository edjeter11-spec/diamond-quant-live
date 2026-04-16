"use client";

import { useEffect, useState } from "react";
import { cloudGet } from "@/lib/supabase/client";
import { Diamond, TrendingUp, ChevronRight } from "lucide-react";

interface Pick {
  pick: string;
  odds: number;
  confidence: string;
  stake: number;
  result: string;
  bookmaker: string;
  consensusProb: number;
}

const CONF_COLOR: Record<string, string> = {
  HIGH: "text-neon border-neon/40 bg-neon/10",
  MEDIUM: "text-electric border-electric/40 bg-electric/10",
  LOW: "text-mercury border-slate/30 bg-gunmetal/40",
};

export default function TodayPicksStrip({ sport, onNavigateBot }: { sport: string; onNavigateBot?: () => void }) {
  const [picks, setPicks] = useState<Pick[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const today = new Date().toISOString().split("T")[0];
    const key = sport === "nba" ? `smart_bot_today_nba_${today}` : `smart_bot_today_mlb_${today}`;
    cloudGet<{ picks: Pick[] } | null>(key, null).then(data => {
      if (data?.picks?.length) setPicks(data.picks.slice(0, 4));
      setLoading(false);
    });
  }, [sport]);

  if (loading) {
    return (
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex-shrink-0 w-40 h-16 glass rounded-xl animate-pulse bg-gunmetal/30" />
        ))}
      </div>
    );
  }

  if (picks.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-mercury/60 uppercase tracking-wider flex items-center gap-1.5">
          <Diamond className="w-3 h-3 text-neon" />
          Today&apos;s Bot Picks
        </span>
        {onNavigateBot && (
          <button onClick={onNavigateBot} className="text-xs text-electric/70 hover:text-electric flex items-center gap-0.5 transition-colors">
            All picks <ChevronRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
        {picks.map((p, i) => (
          <div key={i} className="flex-shrink-0 glass rounded-xl p-2.5 border border-slate/20 min-w-[148px] max-w-[160px] hover:border-electric/20 transition-colors">
            <div className="flex items-start justify-between gap-1 mb-1.5">
              <span className="text-xs font-bold text-silver leading-tight line-clamp-2">{p.pick}</span>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border flex-shrink-0 ${CONF_COLOR[p.confidence] ?? CONF_COLOR.LOW}`}>
                {p.confidence === "HIGH" ? "🔥" : p.confidence === "MEDIUM" ? "📊" : ""}
                {p.confidence}
              </span>
            </div>
            <div className="flex items-center justify-between text-[10px]">
              <span className={`font-semibold ${p.odds > 0 ? "text-neon" : "text-mercury/70"}`}>
                {p.odds > 0 ? `+${p.odds}` : p.odds}
              </span>
              <span className="text-mercury/50">{p.bookmaker}</span>
            </div>
            <div className="flex items-center gap-1 mt-1">
              <TrendingUp className="w-3 h-3 text-electric/50" />
              <span className="text-[9px] text-mercury/50">{p.consensusProb}% prob</span>
              {p.result !== "pending" && (
                <span className={`text-[9px] font-bold ml-auto ${p.result === "win" ? "text-neon" : p.result === "loss" ? "text-danger" : "text-mercury/50"}`}>
                  {p.result.toUpperCase()}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
