"use client";

import { useEffect, useRef, useState } from "react";
import { X, Layers, Trash2, Copy, AlertTriangle, Check, Crown } from "lucide-react";
import { useStore } from "@/lib/store";
import { useSport } from "@/lib/sport-context";
import { formatPickLabel } from "@/lib/display";
import { americanToDecimal, decimalToAmerican } from "@/lib/model/kelly";
import { useAuth } from "@/lib/supabase/auth";
import Link from "next/link";

function computeCombinedOdds(legs: { odds: number }[]): number | null {
  if (legs.length === 0) return null;
  const combined = legs.reduce((acc, leg) => acc * americanToDecimal(leg.odds), 1);
  return decimalToAmerican(combined);
}

export default function ParlayBuilder() {
  const {
    parlayLegs,
    parlayBuilderOpen,
    setParlayBuilderOpen,
    removeParlayLeg,
    clearParlay,
  } = useStore();
  const { currentSport } = useSport();
  const { profile } = useAuth();
  const isPro = profile?.is_premium || profile?.is_admin;
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on backdrop click (mobile)
  useEffect(() => {
    if (!parlayBuilderOpen) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setParlayBuilderOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [parlayBuilderOpen, setParlayBuilderOpen]);

  if (!parlayBuilderOpen) return null;

  const legCount = parlayLegs.length;
  const combined = computeCombinedOdds(parlayLegs);
  const combinedDecimal =
    legCount > 0
      ? parlayLegs.reduce((acc, l) => acc * americanToDecimal(l.odds), 1)
      : 1;
  const payout100 = combined != null ? Math.round((combinedDecimal - 1) * 100) : 0;

  // Detect same-game parlay
  const gameCounts: Record<string, number> = {};
  for (const leg of parlayLegs) {
    gameCounts[leg.game] = (gameCounts[leg.game] ?? 0) + 1;
  }
  const hasSameGame = Object.values(gameCounts).some((c) => c > 1);

  const copySlip = async () => {
    const lines = parlayLegs.map(
      (l, i) =>
        `${i + 1}. ${l.pick} (${l.game}) — ${l.odds > 0 ? "+" : ""}${l.odds} @ ${l.bookmaker}`,
    );
    const summary =
      `Diamond Quant Parlay Slip\n` +
      lines.join("\n") +
      (combined != null
        ? `\nCombined: ${combined > 0 ? "+" : ""}${combined} | Pays $${payout100 + 100} on $100`
        : "");
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const labelLine =
    legCount === 0
      ? "No legs yet"
      : legCount === 1
        ? "Single pick"
        : `${legCount}-team parlay${combined != null ? `: ${combined > 0 ? "+" : ""}${combined}` : ""}`;

  return (
    /* Full-screen overlay; backdrop only captures clicks outside the panel */
    <div className="fixed inset-0 z-[70]">
      {/* Backdrop — semi-transparent, click to close */}
      <div
        className="absolute inset-0 bg-void/60 backdrop-blur-sm"
        onClick={() => setParlayBuilderOpen(false)}
      />

      {/* Panel — bottom sheet on mobile, fixed right panel on desktop */}
      <div
        ref={panelRef}
        className="absolute bottom-0 left-0 right-0 md:inset-y-0 md:bottom-auto md:top-0 md:left-auto md:right-0 md:w-96 flex flex-col bg-bunker border-t md:border-t-0 md:border-l border-slate/40 shadow-2xl max-h-[85vh] md:max-h-none animate-slide-up md:animate-none"
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate/30 bg-bunker/95 backdrop-blur-md flex-shrink-0">
          <Layers className="w-4 h-4 text-neon flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-silver truncate">{labelLine}</p>
            {combined != null && legCount >= 2 && (
              <p className="text-[10px] text-mercury/60">
                Pays ${payout100 + 100} on $100&nbsp;&middot;&nbsp;profit ${payout100}
              </p>
            )}
          </div>
          <button
            onClick={clearParlay}
            className="p-1.5 rounded hover:bg-danger/10 text-mercury/50 hover:text-danger transition-colors"
            title="Clear all"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setParlayBuilderOpen(false)}
            className="p-1.5 rounded hover:bg-gunmetal/50 text-mercury/60 hover:text-silver transition-colors"
            aria-label="Close parlay builder"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Pro paywall — show for free users with 2+ legs (1 leg slip is free) */}
        {!isPro && legCount >= 2 && (
          <div className="px-4 py-4 bg-gradient-to-br from-gold/10 to-electric/5 border-b border-gold/25 text-center space-y-2">
            <Crown className="w-6 h-6 mx-auto text-gold" />
            <p className="text-xs text-silver font-semibold">Multi-leg parlays are a Pro feature</p>
            <p className="text-[10px] text-mercury/70">Free tier: 1-leg slip view. Pro: full parlay builder + combined odds + same-game alerts.</p>
            <Link
              href="/pricing"
              onClick={() => setParlayBuilderOpen(false)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gold text-bunker text-[11px] font-bold hover:bg-gold/90 transition-all"
            >
              Upgrade to Pro — $15/mo
            </Link>
          </div>
        )}

        {/* Scrollable leg list */}
        <div className="flex-1 overflow-y-auto">
          {legCount === 0 ? (
            <div className="px-4 py-10 text-center">
              <Layers className="w-8 h-8 text-mercury/30 mx-auto mb-2" />
              <p className="text-sm text-mercury/50">No legs added yet.</p>
              <p className="text-xs text-mercury/40 mt-1">
                Click &ldquo;+ Parlay&rdquo; on any pick to build your slip.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate/15">
              {parlayLegs.map((leg, idx) => (
                <div key={leg.id} className="px-4 py-3 flex items-start gap-2">
                  <span className="text-[10px] font-mono text-mercury/40 w-4 flex-shrink-0 pt-0.5">
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-silver truncate">
                      {formatPickLabel(leg.pick, currentSport as "mlb" | "nba")}
                    </p>
                    <p className="text-[10px] text-mercury/60 truncate mt-0.5">{leg.game}</p>
                    <p className="text-[10px] text-mercury/50">
                      {leg.bookmaker}&nbsp;&middot;&nbsp;
                      {(leg.market ?? "").replace(/_/g, " ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="text-xs font-mono font-bold text-silver">
                      {leg.odds > 0 ? "+" : ""}
                      {leg.odds}
                    </span>
                    <button
                      onClick={() => removeParlayLeg(leg.id)}
                      className="p-1 rounded text-mercury/40 hover:text-danger transition-colors"
                      aria-label="Remove leg"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {legCount > 0 && (
          <div className="border-t border-slate/30 px-4 py-3 space-y-3 flex-shrink-0 bg-gunmetal/20">
            {/* Same-game warning */}
            {hasSameGame && (
              <div className="flex items-start gap-2 rounded-lg border border-amber/30 bg-amber/10 px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 text-amber flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber leading-tight">
                  ⚠ Same-game parlay — higher variance
                </p>
              </div>
            )}

            {/* Combined odds */}
            {combined != null && legCount >= 2 && (
              <div className="flex items-center justify-between rounded-lg bg-neon/5 border border-neon/20 px-3 py-2">
                <span className="text-[11px] text-mercury/70">Combined odds</span>
                <span className="text-sm font-bold font-mono text-neon">
                  {combined > 0 ? "+" : ""}
                  {combined}
                </span>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={copySlip}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-gunmetal/50 border border-slate/30 text-mercury text-xs font-semibold hover:border-neon/30 hover:text-silver transition-all"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-neon" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Copy Slip
                  </>
                )}
              </button>
              <button
                onClick={() => {
                  clearParlay();
                  setParlayBuilderOpen(false);
                }}
                className="py-2.5 px-4 rounded-xl bg-danger/10 border border-danger/25 text-danger text-xs font-semibold hover:bg-danger/20 transition-colors"
              >
                Clear All
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
