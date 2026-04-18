"use client";

import { useEffect, useState } from "react";
import { Layers, X, Trash2, Send } from "lucide-react";
import { useStore } from "@/lib/store";
import { useSport } from "@/lib/sport-context";
import { formatPickLabel } from "@/lib/display";

interface Props {
  /** Hide when the full parlay tab is the active view (avoids redundancy). */
  activeTab?: string;
  /** Navigate to the full Parlays tab */
  onOpenBuilder?: () => void;
}

export default function FloatingParlayChip({ activeTab, onOpenBuilder }: Props) {
  const { parlayLegs, currentParlay, removeParlayLeg, clearParlay } = useStore();
  const { currentSport } = useSport();
  const [open, setOpen] = useState(false);
  const [pulse, setPulse] = useState(false);
  const [prevCount, setPrevCount] = useState(parlayLegs.length);

  // Pulse on new leg added
  useEffect(() => {
    if (parlayLegs.length > prevCount) {
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 700);
      return () => clearTimeout(t);
    }
    setPrevCount(parlayLegs.length);
  }, [parlayLegs.length, prevCount]);

  // Hide when on parlays tab (redundant with full builder)
  if (activeTab === "parlays") return null;
  if (parlayLegs.length === 0) return null;

  const totalOdds = currentParlay?.combinedOdds;
  const legCount = parlayLegs.length;

  return (
    <>
      {/* Chip */}
      <button
        onClick={() => setOpen(true)}
        className={`fixed z-[60] bottom-20 md:bottom-6 right-3 sm:right-6 flex items-center gap-2 px-3 py-2.5 rounded-full border border-neon/30 bg-bunker/95 backdrop-blur-md text-neon shadow-xl hover:bg-neon/15 active:scale-[0.98] transition-all ${
          pulse ? "animate-pulse ring-2 ring-neon/40" : ""
        }`}
        aria-label="Open parlay slip"
      >
        <Layers className="w-4 h-4" />
        <span className="text-xs font-bold font-mono">
          {legCount} leg{legCount !== 1 ? "s" : ""}
        </span>
        {totalOdds != null && (
          <span className="text-[11px] font-mono font-bold bg-neon/15 px-1.5 py-0.5 rounded">
            {totalOdds > 0 ? "+" : ""}{totalOdds}
          </span>
        )}
      </button>

      {/* Slide-up sheet */}
      {open && (
        <div className="fixed inset-0 z-[65]" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-void/70 backdrop-blur-sm" />
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-0 left-0 right-0 md:bottom-6 md:right-6 md:left-auto md:max-w-sm md:rounded-2xl rounded-t-2xl bg-bunker border-t md:border border-slate/40 shadow-2xl max-h-[80vh] overflow-y-auto animate-slide-up"
          >
            {/* Header */}
            <div className="sticky top-0 bg-bunker/95 backdrop-blur-md px-4 py-3 border-b border-slate/30 flex items-center gap-2 z-10">
              <Layers className="w-4 h-4 text-neon" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-silver">Your Parlay</p>
                <p className="text-[10px] text-mercury/60">
                  {legCount} leg{legCount !== 1 ? "s" : ""}
                  {totalOdds != null ? ` · ${totalOdds > 0 ? "+" : ""}${totalOdds} total` : ""}
                </p>
              </div>
              <button
                onClick={clearParlay}
                className="p-1.5 rounded hover:bg-danger/10 text-mercury/50 hover:text-danger transition-colors"
                title="Clear all legs"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded hover:bg-gunmetal/50 text-mercury/60"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Legs */}
            <div className="divide-y divide-slate/15">
              {parlayLegs.map((leg) => (
                <div key={leg.id} className="px-4 py-2.5 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-silver truncate">
                      {formatPickLabel(leg.pick, currentSport as any)}
                    </p>
                    <p className="text-[10px] text-mercury/60 truncate">
                      {leg.bookmaker} · {(leg as any).market?.replace(/_/g, " ") ?? ""}
                    </p>
                  </div>
                  <span className="text-xs font-mono font-bold text-silver flex-shrink-0">
                    {leg.odds > 0 ? "+" : ""}{leg.odds}
                  </span>
                  <button
                    onClick={() => removeParlayLeg(leg.id)}
                    className="p-1 rounded text-mercury/40 hover:text-danger transition-colors"
                    aria-label="Remove leg"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Summary */}
            {currentParlay && (
              <div className="px-4 py-3 border-t border-slate/30 bg-gunmetal/20">
                <div className="grid grid-cols-3 gap-2 text-center mb-3">
                  <div>
                    <p className="text-[9px] text-mercury/60 uppercase">Fair %</p>
                    <p className="text-sm font-bold font-mono text-silver">
                      {currentParlay.fairProb.toFixed(1)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-[9px] text-mercury/60 uppercase">Book %</p>
                    <p className="text-sm font-bold font-mono text-silver">
                      {currentParlay.impliedProb.toFixed(1)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-[9px] text-mercury/60 uppercase">EV</p>
                    <p className={`text-sm font-bold font-mono ${currentParlay.evPercentage >= 0 ? "text-neon" : "text-danger"}`}>
                      {currentParlay.evPercentage > 0 ? "+" : ""}{currentParlay.evPercentage.toFixed(1)}%
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => { setOpen(false); onOpenBuilder?.(); }}
                  className="w-full py-2.5 rounded-xl bg-neon/15 border border-neon/30 text-neon text-xs font-bold hover:bg-neon/25 active:scale-[0.99] transition-all flex items-center justify-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  Open in Parlay Builder
                </button>
              </div>
            )}

            {legCount === 1 && (
              <div className="px-4 py-3 text-center border-t border-slate/30">
                <p className="text-[11px] text-mercury/60">Add at least one more leg to build a parlay</p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
