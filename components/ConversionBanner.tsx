"use client";

import { useAuth } from "@/lib/supabase/auth";
import { Crown, X } from "lucide-react";
import { useEffect, useState } from "react";
import Link from "next/link";

const DISMISS_KEY = "dq_conv_banner_dismissed_v1";

export default function ConversionBanner() {
  const { user, profile, loading } = useAuth();
  const [stats, setStats] = useState<{ winRate: number; recent: number } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try { setDismissed(localStorage.getItem(DISMISS_KEY) === "true"); } catch {}
  }, []);

  useEffect(() => {
    fetch("/api/prop-history?sport=nba&limit=200")
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.stats?.graded > 0) {
          setStats({ winRate: d.stats.winRate, recent: d.stats.graded });
        }
      })
      .catch(() => {});
  }, []);

  if (loading || dismissed) return null;
  if (profile?.is_premium || profile?.is_admin) return null;

  const handleDismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, "true"); } catch {}
    setDismissed(true);
  };

  return (
    <div className="relative px-4 py-2.5 bg-gradient-to-r from-gold/15 via-electric/10 to-purple/10 border-b border-gold/30">
      <div className="max-w-6xl mx-auto flex items-center gap-3">
        <Crown className="w-4 h-4 text-gold flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-silver">
            {stats && stats.recent > 5 ? (
              <>
                <span className="font-bold text-gold">{stats.winRate}%</span> win rate on last {stats.recent} graded prop picks.{" "}
                <span className="text-mercury/70">Pro unlocks all picks + brain stats + parlay builder.</span>
              </>
            ) : (
              <>
                <span className="font-bold text-gold">Pro unlocks everything</span> — full prop list, AI brain stats, parlay builder, arb alerts.{" "}
                <span className="text-mercury/70">7-day free trial.</span>
              </>
            )}
          </p>
        </div>
        <Link
          href={user ? "/pricing" : "/pricing"}
          className="flex items-center justify-center min-h-[36px] px-3.5 rounded-lg bg-gold text-bunker text-[12px] font-bold hover:bg-gold/90 transition-all flex-shrink-0"
        >
          Try Pro Free
        </Link>
        <button
          onClick={handleDismiss}
          className="flex items-center justify-center min-w-[36px] min-h-[36px] rounded text-mercury/50 hover:text-silver hover:bg-gunmetal/30 transition-colors flex-shrink-0"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
