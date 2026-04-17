"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Flame, Target, Zap, ExternalLink, TrendingUp, Info, Trophy } from "lucide-react";
import TeamLogo from "@/components/ui/TeamLogo";
import InfoTip from "@/components/ui/InfoTip";
import { useStore } from "@/lib/store";

interface Play {
  tier: "lock" | "value" | "longshot";
  pick: string;
  game: string;
  odds: number;
  bookmaker: string;
  evPercentage: number;
  confidence?: string;
}

// The "30-second answer" hero card. Fetches the pinned Parlay-of-the-Day for
// the current sport and an EV pick list; picks one safe (lock), one middle
// (value), one longshot. All three are the same picks every user sees.
export default function TonightsPlays({ sport }: { sport: "mlb" | "nba" }) {
  const { bankroll } = useStore();
  const [plays, setPlays] = useState<Play[]>([]);
  const [loading, setLoading] = useState(true);
  const [lockedAt, setLockedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/parlay-today?sport=${sport}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        if (!data.ok || !data.legs?.length) { setPlays([]); setLoading(false); return; }
        if (data.generatedAt) setLockedAt(data.generatedAt);
        // Classify: lowest EV (safest) as "lock", highest odds as "longshot", middle = "value"
        const legs = [...data.legs].map((l: any): Play => ({
          tier: "value",
          pick: l.pick, game: l.game, odds: l.odds, bookmaker: l.bookmaker,
          evPercentage: l.evPercentage ?? 0, confidence: l.confidence,
        }));
        // Sort by odds: most negative (most favored) first
        const sorted = [...legs].sort((a, b) => a.odds - b.odds);
        if (sorted[0]) sorted[0].tier = "lock";
        if (sorted[sorted.length - 1] && sorted.length > 1) sorted[sorted.length - 1].tier = "longshot";
        // Re-order for display: lock → value → longshot
        const rank = { lock: 0, value: 1, longshot: 2 };
        sorted.sort((a, b) => rank[a.tier] - rank[b.tier]);
        setPlays(sorted.slice(0, 3));
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sport]);

  if (loading) {
    return (
      <div className="glass rounded-xl p-4 border border-gold/15 bg-gradient-to-br from-gold/5 to-transparent animate-pulse">
        <div className="h-4 w-32 bg-gunmetal/40 rounded mb-3" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {[0, 1, 2].map(i => <div key={i} className="h-20 bg-gunmetal/30 rounded-lg" />)}
        </div>
      </div>
    );
  }

  if (plays.length === 0) return null;

  const bank = bankroll?.currentBankroll ?? 0;
  const unitSize = (ev: number): { units: number; dollars: number } => {
    const baseUnit = bank * 0.01;
    const units = Math.min(3, Math.max(0.5, Math.round(Math.max(ev, 1) * 0.5 * 2) / 2));
    return { units, dollars: Math.round(units * baseUnit * 100) / 100 };
  };

  const lockedLabel = lockedAt
    ? new Date(lockedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })
    : null;

  return (
    <div className="glass rounded-xl overflow-hidden border border-gold/20">
      {/* Header */}
      <div className="px-3 sm:px-4 py-2.5 bg-gradient-to-r from-gold/10 via-neon/5 to-transparent border-b border-gold/15 flex items-center gap-2">
        <Flame className="w-4 h-4 text-gold" />
        <div className="flex-1 min-w-0">
          <h2 className="text-xs sm:text-sm font-bold text-silver uppercase tracking-wider">Tonight&apos;s Plays</h2>
          <p className="text-[9px] text-mercury/60 mt-0.5">
            {lockedLabel ? `Locked ${lockedLabel} ET · ` : ""}Same picks every user · auto-settles on{" "}
            <Link href="/results" className="text-electric hover:underline">/results</Link>
          </p>
        </div>
        <Link
          href="/results"
          className="hidden sm:flex items-center gap-1 px-2 py-1 rounded bg-gold/10 border border-gold/25 text-gold text-[10px] font-bold hover:bg-gold/20 transition-colors"
        >
          <Trophy className="w-3 h-3" />
          Record
        </Link>
      </div>

      {/* Plays grid */}
      <div className="p-2 sm:p-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
        {plays.map((p, i) => <PlayCard key={i} play={p} unit={unitSize(p.evPercentage)} />)}
      </div>
    </div>
  );
}

function PlayCard({ play, unit }: { play: Play; unit: { units: number; dollars: number } }) {
  const tierCfg: Record<Play["tier"], { label: string; color: string; bg: string; icon: any }> = {
    lock: { label: "Top Lock", color: "text-neon", bg: "bg-neon/10 border-neon/25", icon: Target },
    value: { label: "Value", color: "text-electric", bg: "bg-electric/10 border-electric/25", icon: TrendingUp },
    longshot: { label: "Longshot", color: "text-amber", bg: "bg-amber/10 border-amber/25", icon: Zap },
  };
  const cfg = tierCfg[play.tier];
  const Icon = cfg.icon;

  return (
    <div className={`rounded-lg border p-3 ${cfg.bg} flex flex-col gap-2`}>
      <div className="flex items-center gap-1.5">
        <Icon className={`w-3.5 h-3.5 ${cfg.color}`} />
        <span className={`text-[10px] font-bold uppercase tracking-wider ${cfg.color}`}>{cfg.label}</span>
        <span className={`ml-auto text-[10px] font-mono font-bold ${play.evPercentage > 0 ? "text-neon" : "text-mercury/70"}`}>
          {play.evPercentage > 0 ? "+" : ""}{play.evPercentage.toFixed(1)}%
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <TeamLogo team={play.pick.split(" ML")[0].split(" Over")[0].split(" Under")[0].split("/")[0].trim()} size={16} />
        <p className="text-xs font-semibold text-silver truncate">{play.pick}</p>
      </div>
      <p className="text-[10px] text-mercury/60 truncate">{play.game}</p>
      <div className="flex items-center justify-between pt-1 border-t border-slate/20">
        <span className="text-xs font-mono font-bold text-silver">
          {play.odds > 0 ? "+" : ""}{play.odds}
        </span>
        <InfoTip term="UNIT">
          <span className="text-[10px] font-mono text-mercury/80">
            {unit.units}u {unit.dollars > 0 ? `($${unit.dollars})` : ""}
          </span>
        </InfoTip>
      </div>
      <p className="text-[9px] text-mercury/40 truncate">via {play.bookmaker || "best price"}</p>
    </div>
  );
}
