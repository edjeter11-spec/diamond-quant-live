"use client";

import { useEffect, useState } from "react";
import { Layers, X, Trash2, Send, Share2, Check, DollarSign } from "lucide-react";
import { useStore } from "@/lib/store";
import { useSport } from "@/lib/sport-context";
import { formatPickLabel } from "@/lib/display";
import { americanToDecimal } from "@/lib/model/kelly";

interface Props {
  /** Hide when the full parlay tab is the active view (avoids redundancy). */
  activeTab?: string;
  /** Navigate to the full Parlays tab */
  onOpenBuilder?: () => void;
}

export default function FloatingParlayChip({ activeTab, onOpenBuilder }: Props) {
  const { parlayLegs, currentParlay, removeParlayLeg, clearParlay, addBet } = useStore();
  const { currentSport } = useSport();
  const [open, setOpen] = useState(false);
  const [pulse, setPulse] = useState(false);
  const [prevCount, setPrevCount] = useState(parlayLegs.length);
  const [stake, setStake] = useState("25");
  const [shared, setShared] = useState(false);
  const [placed, setPlaced] = useState(false);

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
  const isSingle = legCount === 1;

  // Single-leg uses the one leg's odds; parlay uses combined
  const effectiveOdds = isSingle ? parlayLegs[0].odds : (totalOdds ?? 0);
  const stakeNum = parseFloat(stake) || 0;
  const decimal = americanToDecimal(effectiveOdds);
  const toWin = stakeNum > 0 ? Math.round(stakeNum * (decimal - 1) * 100) / 100 : 0;

  const placeBet = () => {
    if (stakeNum <= 0) return;
    const firstLeg = parlayLegs[0];
    addBet({
      game: isSingle ? firstLeg.game : parlayLegs.map(l => l.game).join(" + "),
      market: isSingle ? firstLeg.market : "parlay",
      pick: isSingle ? firstLeg.pick : parlayLegs.map(l => l.pick).join(" / "),
      bookmaker: isSingle ? firstLeg.bookmaker : "Parlay",
      odds: effectiveOdds,
      stake: stakeNum,
      result: "pending",
      payout: 0,
      isParlay: !isSingle,
      parlayLegs: isSingle ? undefined : parlayLegs.map(l => l.pick),
      evAtPlacement: currentParlay?.evPercentage ?? 0,
    });
    clearParlay();
    setPlaced(true);
    setTimeout(() => { setPlaced(false); setOpen(false); }, 1500);
  };

  const shareParlay = async () => {
    try {
      const { fetchWithAuth } = await import("@/lib/supabase/fetch-with-auth");
      const res = await fetchWithAuth("/api/slip/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          picks: parlayLegs.map(l => ({
            pick: l.pick, game: l.game, odds: l.odds, bookmaker: l.bookmaker, market: l.market,
          })),
          totalOdds: effectiveOdds,
          stake: stakeNum > 0 ? stakeNum : undefined,
        }),
      });
      const data = await res.json();
      const url = `${window.location.origin}${data.url}`;
      if (navigator.share) {
        await navigator.share({ title: `Diamond Quant: ${legCount}-leg ${isSingle ? "pick" : "parlay"}`, url });
      } else {
        await navigator.clipboard.writeText(url);
      }
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    } catch {}
  };

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

            {/* Summary + inline betting */}
            <div className="px-4 py-3 border-t border-slate/30 bg-gunmetal/20 space-y-3">
              {currentParlay && !isSingle && (
                <div className="grid grid-cols-3 gap-2 text-center">
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
              )}

              {isSingle && (
                <div className="rounded-lg border border-electric/25 bg-electric/5 px-3 py-2">
                  <p className="text-[11px] text-electric font-semibold">Straight bet — add another leg to parlay</p>
                </div>
              )}

              {/* Stake input with quick amounts */}
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] text-mercury/60 uppercase tracking-wider flex-1">Stake</span>
                  {[10, 25, 50, 100].map(amt => (
                    <button
                      key={amt}
                      onClick={() => setStake(String(amt))}
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors ${
                        stake === String(amt)
                          ? "bg-neon/20 border-neon/40 text-neon"
                          : "bg-gunmetal/40 border-slate/30 text-mercury/70 hover:border-neon/30"
                      }`}
                    >
                      ${amt}
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-mercury/50" />
                  <input
                    type="number"
                    min="0"
                    step="1"
                    inputMode="decimal"
                    value={stake}
                    onChange={(e) => setStake(e.target.value)}
                    placeholder="0"
                    className="w-full pl-8 pr-3 py-2 rounded-lg bg-bunker border border-slate/40 text-silver text-sm font-mono placeholder:text-mercury/30 focus:outline-none focus:border-neon/50"
                  />
                </div>
                {stakeNum > 0 && (
                  <div className="flex items-center justify-between mt-1.5 px-0.5">
                    <span className="text-[10px] text-mercury/60">To win</span>
                    <span className="text-xs font-bold font-mono text-neon">${toWin.toFixed(2)}</span>
                  </div>
                )}
              </div>

              {/* Action row */}
              <div className="flex gap-2">
                <button
                  onClick={placeBet}
                  disabled={stakeNum <= 0 || placed}
                  className="flex-1 py-2.5 rounded-xl bg-neon/15 border border-neon/30 text-neon text-xs font-bold hover:bg-neon/25 active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-1.5"
                >
                  {placed ? (
                    <><Check className="w-3.5 h-3.5" /> Logged</>
                  ) : (
                    <>Place {isSingle ? "Straight Bet" : "Parlay"} · ${stakeNum.toFixed(0)}</>
                  )}
                </button>
                <button
                  onClick={shareParlay}
                  className="py-2.5 px-3 rounded-xl bg-purple/10 border border-purple/25 text-purple hover:bg-purple/20 transition-colors flex-shrink-0 flex items-center gap-1"
                  title="Share slip"
                >
                  {shared ? <Check className="w-3.5 h-3.5 text-neon" /> : <Share2 className="w-3.5 h-3.5" />}
                </button>
                {!isSingle && (
                  <button
                    onClick={() => { setOpen(false); onOpenBuilder?.(); }}
                    className="py-2.5 px-3 rounded-xl bg-gunmetal/40 border border-slate/30 text-mercury hover:text-silver transition-colors flex-shrink-0 flex items-center gap-1"
                    title="Open full builder"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
