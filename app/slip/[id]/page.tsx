"use client";

import { useState, useEffect, use } from "react";
import { Diamond, Share2, Flame, Skull, Eye, ArrowLeft, CheckCircle, XCircle, Clock } from "lucide-react";
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
      await fetch(`/api/slip/${id}/react`, {
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
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <Diamond className="w-8 h-8 text-[#00ff88]/20 animate-pulse" />
      </div>
    );
  }

  if (!slip) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center text-center px-4">
        <div>
          <Diamond className="w-10 h-10 text-[#8b8fa3]/20 mx-auto mb-3" />
          <p className="text-sm text-[#8b8fa3]">Slip not found or expired</p>
          <Link href="/" className="text-xs text-[#00d4ff] hover:text-[#00ff88] mt-2 inline-block">
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const picks = slip.slip_data.picks ?? [];
  const totalOdds = slip.slip_data.totalOdds;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-[#c4c8d8]">
      <div className="max-w-lg mx-auto px-4 pt-6 pb-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link href="/" className="p-2 rounded-lg hover:bg-[#1a1d2e] transition-colors">
            <ArrowLeft className="w-4 h-4 text-[#8b8fa3]" />
          </Link>
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#00ff88]/20 to-[#00d4ff]/20 flex items-center justify-center border border-[#00ff88]/20">
            <Share2 className="w-4 h-4 text-[#00ff88]" />
          </div>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-white">Shared Slip</h1>
            <p className="text-[10px] text-[#8b8fa3]">
              {slip.slip_data.sharedBy ?? "Anonymous"} • {new Date(slip.created_at).toLocaleDateString()}
            </p>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-[#8b8fa3]">
            <Eye className="w-3 h-3" /> {slip.views}
          </div>
        </div>

        {/* Picks */}
        <div className="rounded-xl bg-[#0f1117] border border-[#2a2d3e]/50 overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-[#2a2d3e]/30 bg-[#00ff88]/5">
            <p className="text-xs font-bold text-white uppercase tracking-wider">
              {picks.length}-Leg {picks.length > 1 ? "Parlay" : "Straight"}
              {totalOdds ? ` • ${formatOdds(Math.round(totalOdds))}` : ""}
            </p>
          </div>
          <div className="divide-y divide-[#2a2d3e]/20">
            {picks.map((pick, i) => (
              <div key={i} className="px-4 py-3 flex items-center gap-3">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                  pick.result === "win" ? "bg-[#00ff88]/15" :
                  pick.result === "loss" ? "bg-[#ff3b5c]/15" :
                  "bg-[#2a2d3e]/50"
                }`}>
                  {pick.result === "win" ? <CheckCircle className="w-3.5 h-3.5 text-[#00ff88]" /> :
                   pick.result === "loss" ? <XCircle className="w-3.5 h-3.5 text-[#ff3b5c]" /> :
                   <Clock className="w-3.5 h-3.5 text-[#8b8fa3]" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white truncate">{pick.pick}</p>
                  <p className="text-[10px] text-[#8b8fa3] truncate">{pick.game}</p>
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
            { emoji: "skull", icon: Skull, color: "text-[#8b8fa3]", bg: "bg-[#8b8fa3]/10 border-[#8b8fa3]/20" },
          ].map(({ emoji, icon: Icon, color, bg }) => (
            <button
              key={emoji}
              onClick={() => handleReact(emoji)}
              disabled={!!reacted}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl border transition-all ${
                reacted === emoji ? `${bg} scale-110` : `bg-[#0f1117] border-[#2a2d3e]/50 hover:${bg}`
              } disabled:opacity-70`}
            >
              <Icon className={`w-4 h-4 ${color}`} />
              <span className="text-xs font-bold text-white">{slip.reactions[emoji] ?? 0}</span>
            </button>
          ))}
        </div>

        {/* Share */}
        <button
          onClick={() => navigator.clipboard.writeText(window.location.href)}
          className="w-full py-2.5 rounded-xl bg-[#00d4ff]/10 border border-[#00d4ff]/20 text-[#00d4ff] text-xs font-semibold hover:bg-[#00d4ff]/20 transition-all flex items-center justify-center gap-2"
        >
          <Share2 className="w-3.5 h-3.5" /> Copy Link
        </button>

        <div className="text-center mt-6">
          <Link href="/" className="text-[10px] text-[#00d4ff] hover:text-[#00ff88] transition-colors">
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
