"use client";

import { useAuth } from "@/lib/supabase/auth";
import { Crown, X } from "lucide-react";
import { useEffect, useState } from "react";
import Link from "next/link";

const DISMISS_KEY = "dq_conv_banner_dismissed_v1";

// Same sample floor as components/dashboard/StatsStrip.tsx. This banner is a
// marketing surface with no room for a caption, so below MIN_SAMPLE it drops
// the win-rate claim entirely rather than quoting a thin-sample percentage.
const MIN_SAMPLE = 30;

export default function ConversionBanner() {
  const { user, profile, loading } = useAuth();
  const [stats, setStats] = useState<{
    winRate: number;
    recent: number;
  } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "true");
    } catch {}
  }, []);

  useEffect(() => {
    // Was hardcoded to NBA which has no in-season data right now, so a
    // stale/hypothetical number could headline the top of the page. Ask
    // /api/results for the actual trailing 30-day rollup used by the rest
    // of the site. If it's losing, we DON'T show a number — the honest
    // fallback ("Pro unlocks everything") beats a number that contradicts
    // the streak banner right below it. That was the credibility tell the
    // audit flagged.
    fetch("/api/results?days=30")
      .then((r) => r.json())
      .then((d) => {
        const o = d?.overall ?? {};
        const graded = Number(o.wins ?? 0) + Number(o.losses ?? 0);
        if (graded < MIN_SAMPLE) return;
        const winRate = Math.round(Number(o.winRate ?? 0) * 10) / 10;
        const profitUnits = Number(o.profitUnits ?? 0);
        // Only headline when BOTH numbers hold up. A 58% win-rate that lost
        // 11.7u (the current live state) is exactly what the audit called
        // out — win-rate looks pro, wallet is red, and the two together read
        // as a lie. Show nothing rather than lie. 55% is the -110 breakeven
        // line + a few points of visual margin; profit must also be positive
        // for the number to earn the headline.
        if (winRate < 55 || profitUnits <= 0) return;
        setStats({ winRate, recent: graded });
      })
      .catch(() => {});
  }, []);

  if (loading || dismissed) return null;
  if (profile?.is_premium || profile?.is_admin) return null;

  const handleDismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "true");
    } catch {}
    setDismissed(true);
  };

  return (
    <div className="relative px-4 py-2.5 bg-gradient-to-r from-gold/15 via-electric/10 to-purple/10 border-b border-gold/30">
      <div className="max-w-6xl mx-auto flex items-center gap-3">
        <Crown className="w-4 h-4 text-gold flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-silver">
            {stats && stats.recent >= MIN_SAMPLE ? (
              <>
                <span className="font-bold text-gold">{stats.winRate}%</span>{" "}
                win rate on last {stats.recent} graded prop picks.{" "}
                <span className="text-mercury/70">
                  Pro unlocks all picks + brain stats + parlay builder.
                </span>
              </>
            ) : (
              <>
                <span className="font-bold text-gold">
                  Pro unlocks everything
                </span>{" "}
                — full prop list, AI brain stats, parlay builder, arb alerts.{" "}
                <span className="text-mercury/70">7-day free trial.</span>
              </>
            )}
          </p>
        </div>
        <Link
          href={user ? "/pricing" : "/pricing"}
          className="flex items-center justify-center gap-1 min-h-[36px] px-3.5 rounded-lg bg-gradient-to-r from-gold to-yellow-400 text-bunker text-[12px] font-bold hover:scale-[1.04] active:scale-95 shadow-md shadow-gold/30 transition-all flex-shrink-0"
        >
          Try Pro Free <span className="hidden sm:inline">→</span>
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
