"use client";

import { useState, useEffect, use } from "react";
import { Diamond, Share2, Flame, Skull, Eye, ArrowLeft, CheckCircle, XCircle, Clock, TrendingUp, Zap } from "lucide-react";
import Link from "next/link";

interface SharedSlip {
  id: string;
  slip_data: {
    picks: Array<{
      game: string;
      pick: string;
      odds: number;
      result?: string;
      bookmaker?: string;
    }>;
    totalOdds?: number;
    stake?: number;
    sharedBy?: string;
    sharedAt?: string;
  };
  reactions: Record<string, number>;
  views: number;
  created_at: string;
}

export default function SlipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [slip, setSlip] = useState<SharedSlip | null>(null);
  const [loading, setLoading] = useState(true);
  const [reacted, setReacted] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/slip/${id}`);
        if (res.ok) {
          const data = await res.json();
          setSlip(data.slip);
        }
      } catch {}
      setLoading(false);
    }
    load();
  }, [id]);

  const handleReact = async (emoji: string) => {
    if (reacted) return;
    setReacted(emoji);
    try {
      const { fetchWithAuth } = await import("@/lib/supabase/fetch-with-auth");
      await fetchWithAuth(`/api/slip/${id}/react`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji }),
      });
      if (slip) {
        setSlip({
          ...slip,
          reactions: {
            ...slip.reactions,
            [emoji]: (slip.reactions[emoji] ?? 0) + 1,
          },
        });
      }
    } catch {}
  };

  const formatOdds = (odds: number) => (odds > 0 ? `+${odds}` : `${odds}`);

  if (loading) {
    return (
      <div className="min-h-screen bg-void flex items-center justify-center">
        <Diamond className="w-8 h-8 text-neon/20 animate-pulse" />
      </div>
    );
  }

  if (!slip) {
    return (
      <div className="min-h-screen bg-void flex items-center justify-center text-center px-4">
        <div>
          <Diamond className="w-10 h-10 text-mercury/20 mx-auto mb-3" />
          <p className="text-sm text-mercury">Slip not found or expired</p>
          <Link href="/" className="text-xs text-electric hover:text-neon mt-2 inline-block">
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const picks = slip.slip_data.picks ?? [];
  const totalOdds = slip.slip_data.totalOdds;
  const stake = slip.slip_data.stake;
  const toPayout = (odds: number, bet: number) => odds > 0 ? bet * (odds / 100) : bet * (100 / Math.abs(odds));
  const payout = stake && totalOdds ? Math.round(toPayout(totalOdds, stake) * 100) / 100 : null;

  return (
    <div className="min-h-screen bg-void text-silver">
      <div className="max-w-lg mx-auto px-4 pt-6 pb-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link href="/" className="p-2 rounded-lg hover:bg-gunmetal/60 transition-colors">
            <ArrowLeft className="w-4 h-4 text-mercury" />
          </Link>
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-neon/20 to-electric/20 flex items-center justify-center border border-neon/20">
            <Share2 className="w-4 h-4 text-neon" />
          </div>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-white">Shared Slip</h1>
            <p className="text-[10px] text-mercury">
              {slip.slip_data.sharedBy ?? "Anonymous"} • {new Date(slip.created_at).toLocaleDateString()}
            </p>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-mercury">
            <Eye className="w-3 h-3" /> {slip.views}
          </div>
        </div>

        {/* Picks */}
        <div className="rounded-xl bg-bunker border border-slate/40 overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-slate/30 bg-neon/5">
            <p className="text-xs font-bold text-white uppercase tracking-wider">
              {picks.length}-Leg {picks.length > 1 ? "Parlay" : "Straight"}
              {totalOdds ? ` • ${formatOdds(Math.round(totalOdds))}` : ""}
            </p>
          </div>
          <div className="divide-y divide-slate/20">
            {picks.map((pick, i) => (
              <div key={i} className="px-4 py-3 flex items-center gap-3">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                  pick.result === "win" ? "bg-neon/15" :
                  pick.result === "loss" ? "bg-danger/15" :
                  "bg-slate/50"
                }`}>
                  {pick.result === "win" ? <CheckCircle className="w-3.5 h-3.5 text-neon" /> :
                   pick.result === "loss" ? <XCircle className="w-3.5 h-3.5 text-danger" /> :
                   <Clock className="w-3.5 h-3.5 text-mercury" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white truncate">{pick.pick}</p>
                  <p className="text-[10px] text-mercury truncate">{pick.game}</p>
                </div>
                <p className="text-xs font-mono font-bold text-white">{formatOdds(pick.odds)}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Reactions */}
        <div className="flex items-center justify-center gap-3 mb-6">
          {[
            { emoji: "fire", icon: Flame, color: "text-orange-500", bg: "bg-orange-500/10 border-orange-500/20" },
            { emoji: "skull", icon: Skull, color: "text-mercury", bg: "bg-mercury/10 border-mercury/20" },
          ].map(({ emoji, icon: Icon, color, bg }) => (
            <button
              key={emoji}
              onClick={() => handleReact(emoji)}
              disabled={!!reacted}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl border transition-all ${
                reacted === emoji ? `${bg} scale-110` : `bg-bunker border-slate/40 hover:${bg}`
              } disabled:opacity-70`}
            >
              <Icon className={`w-4 h-4 ${color}`} />
              <span className="text-xs font-bold text-white">{slip.reactions[emoji] ?? 0}</span>
            </button>
          ))}
        </div>

        {/* Payout */}
        {payout !== null && stake && (
          <div className="rounded-xl bg-bunker border border-slate/40 p-4 mb-4 flex items-center justify-between">
            <div>
              <p className="text-[10px] text-mercury uppercase tracking-wider">Risk</p>
              <p className="text-sm font-mono font-bold text-white">${stake.toFixed(2)}</p>
            </div>
            <TrendingUp className="w-4 h-4 text-neon/40" />
            <div className="text-right">
              <p className="text-[10px] text-mercury uppercase tracking-wider">To Win</p>
              <p className="text-sm font-mono font-bold text-neon">${payout.toFixed(2)}</p>
            </div>
          </div>
        )}

        {/* Share */}
        <button
          onClick={() => navigator.clipboard.writeText(window.location.href)}
          className="w-full py-2.5 rounded-xl bg-electric/10 border border-electric/20 text-electric text-xs font-semibold hover:bg-electric/20 transition-all flex items-center justify-center gap-2 mb-6"
        >
          <Share2 className="w-3.5 h-3.5" /> Copy Link
        </button>

        {/* Conversion CTA */}
        <Link href="/" className="block rounded-xl bg-gradient-to-br from-neon/15 to-electric/10 border border-neon/25 p-5 hover:border-neon/50 transition-all group">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-lg bg-neon/15 flex items-center justify-center flex-shrink-0">
              <Diamond className="w-4 h-4 text-neon" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-white">Get your own +EV picks</p>
              <p className="text-[10px] text-mercury">Live odds across 10+ books · Quant models · Free</p>
            </div>
            <Zap className="w-4 h-4 text-neon group-hover:scale-110 transition-transform" />
          </div>
          <div className="flex items-center justify-center gap-1 mt-2 pt-3 border-t border-slate/30">
            <span className="text-[10px] font-bold text-neon uppercase tracking-wider">See Today&apos;s Board</span>
            <span className="text-neon">→</span>
          </div>
        </Link>

        <div className="text-center mt-4">
          <Link href="/" className="text-[10px] text-mercury hover:text-silver transition-colors">
            diamond-quant-live.vercel.app
          </Link>
        </div>
      </div>
    </div>
  );
}
