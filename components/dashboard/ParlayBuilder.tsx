"use client";

import { useStore } from "@/lib/store";
import { useSport } from "@/lib/sport-context";
import { Layers, X, Sparkles, Save, Trash2, TrendingUp, AlertTriangle, ChevronDown, Zap, Link2, Unlink } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import type { ParlaySlip } from "@/lib/model/types";
import { analyzeParlay } from "@/lib/bot/parlay-correlation";

export default function ParlayBuilder() {
  const {
    parlayLegs, currentParlay, savedParlays,
    removeParlayLeg, clearParlay, saveParlay, addParlayLeg,
  } = useStore();
  const [topPicks, setTopPicks] = useState<any[]>([]);

  const { currentSport } = useSport();
  const isNBA = currentSport === "nba";

  // Fetch sport-specific top picks for quick-add
  useEffect(() => {
    const url = isNBA ? "/api/nba-analysis" : "/api/bot-analysis";
    fetch(url).then(r => r.json()).then(data => {
      const picks = (data.analyses ?? [])
        .filter((a: any) => a.consensus?.confidence === "HIGH" || a.consensus?.confidence === "MEDIUM")
        .slice(0, 5)
        .map((a: any) => ({
          game: `${a.awayTeam} @ ${a.homeTeam}`,
          pick: a.picks?.[0]?.pick ?? `${a.homeTeam} ML`,
          odds: a.picks?.[0]?.odds ?? a.bestHomeML,
          bookmaker: a.picks?.[0]?.bookmaker ?? a.bestHomeBook,
          fairProb: (a.consensus?.homeWinProb ?? 0.5),
          market: a.picks?.[0]?.market ?? "moneyline",
          confidence: a.consensus?.confidence,
        }));
      setTopPicks(picks);
    }).catch(() => { setTopPicks([]); });
  }, [currentSport, isNBA]);

  // Correlation analysis
  const correlation = useMemo(() => {
    if (parlayLegs.length < 2) return null;
    return analyzeParlay(parlayLegs.map(leg => ({
      game: leg.game,
      pick: leg.pick,
      market: leg.market,
    })));
  }, [parlayLegs]);

  const formatOdds = (odds: number) => (odds > 0 ? `+${odds}` : `${odds}`);

  return (
    <div className="glass rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-purple" />
          <h3 className="text-sm font-semibold text-silver uppercase tracking-wide">Parlay Builder</h3>
          {parlayLegs.length > 0 && (
            <span className="px-1.5 py-0.5 bg-purple/20 text-purple text-[10px] font-bold rounded">
              {parlayLegs.length} legs
            </span>
          )}
        </div>
        {parlayLegs.length > 0 && (
          <button
            onClick={clearParlay}
            className="p-1 hover:bg-slate/30 rounded transition-colors"
            title="Clear all"
          >
            <Trash2 className="w-4 h-4 text-mercury" />
          </button>
        )}
      </div>

      {parlayLegs.length === 0 ? (
        <div className="p-4">
          <p className="text-sm text-mercury text-center mb-3">Click any odds to add, or quick-add top picks:</p>

          {topPicks.length > 0 ? (
            <div className="space-y-1.5 mb-3">
              {topPicks.map((pick, i) => (
                <button
                  key={i}
                  onClick={() => addParlayLeg({
                    game: pick.game,
                    market: pick.market,
                    pick: pick.pick,
                    odds: pick.odds,
                    fairProb: pick.fairProb,
                    bookmaker: pick.bookmaker,
                  })}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-gunmetal/30 hover:bg-purple/10 hover:border-purple/20 border border-transparent transition-all text-left"
                >
                  <span className={`text-[8px] px-1 py-0.5 rounded font-bold flex-shrink-0 ${
                    pick.confidence === "HIGH" ? "bg-neon/15 text-neon" : "bg-electric/15 text-electric"
                  }`}>{pick.confidence}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-silver truncate">{pick.pick}</p>
                    <p className="text-[9px] text-mercury/50 truncate">{pick.game}</p>
                  </div>
                  <span className="text-xs font-mono text-silver flex-shrink-0">{formatOdds(pick.odds)}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-center mb-3">
              <Sparkles className="w-6 h-6 text-purple/30 mx-auto mb-1" />
              <p className="text-xs text-mercury/60">Supports ML, spreads, totals, and player props</p>
            </div>
          )}

          {topPicks.length >= 3 && (
            <button
              onClick={() => {
                topPicks.slice(0, 3).forEach(pick => addParlayLeg({
                  game: pick.game, market: pick.market, pick: pick.pick,
                  odds: pick.odds, fairProb: pick.fairProb, bookmaker: pick.bookmaker,
                }));
              }}
              className="w-full py-2.5 rounded-lg bg-purple/15 border border-purple/25 text-purple text-xs font-bold hover:bg-purple/25 active:scale-[0.98] transition-all flex items-center justify-center gap-1.5"
            >
              <Zap className="w-3.5 h-3.5" />
              Quick-Add Top 3 Picks as Parlay
            </button>
          )}
        </div>
      ) : (
        <div className="p-3 space-y-2">
          {/* Legs */}
          {parlayLegs.map((leg) => (
            <div key={leg.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-gunmetal/50 group">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-silver truncate">{leg.pick}</p>
                <p className="text-xs text-mercury/70 truncate">{leg.game} • {leg.bookmaker}</p>
              </div>
              <div className="flex items-center gap-2 ml-2">
                <span className="text-sm font-mono font-semibold text-neon">
                  {formatOdds(leg.odds)}
                </span>
                <button
                  onClick={() => removeParlayLeg(leg.id)}
                  className="p-1 opacity-0 group-hover:opacity-100 hover:bg-slate/30 rounded transition-all"
                >
                  <X className="w-3.5 h-3.5 text-mercury" />
                </button>
              </div>
            </div>
          ))}

          {/* Parlay Analysis */}
          {currentParlay && (
            <div className="mt-3 p-4 rounded-lg bg-gunmetal/30 border border-slate/30 space-y-3">
              {/* Combined Odds */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-mercury uppercase">Combined Odds</span>
                <span className="text-lg font-bold font-mono text-silver">
                  {formatOdds(currentParlay.combinedOdds)}
                </span>
              </div>

              {/* Probability */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-mercury uppercase">Implied Prob</span>
                <span className="text-sm font-mono text-mercury">
                  {currentParlay.impliedProb.toFixed(1)}%
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-mercury uppercase">Fair Prob (Corr. Adj.)</span>
                <span className="text-sm font-mono text-electric">
                  {currentParlay.correlationAdjustedProb.toFixed(1)}%
                </span>
              </div>

              {/* EV */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-mercury uppercase">EV Edge</span>
                <span className={`text-sm font-bold font-mono ${
                  currentParlay.evPercentage > 0 ? "text-neon" : "text-danger"
                }`}>
                  {currentParlay.evPercentage > 0 ? "+" : ""}{currentParlay.evPercentage.toFixed(1)}%
                </span>
              </div>

              {/* Correlation analysis */}
              {correlation && correlation.correlations.length > 0 && (
                <div className={`p-2.5 rounded-lg border ${
                  correlation.score > 0 ? "bg-neon/5 border-neon/20" :
                  correlation.score < 0 ? "bg-danger/5 border-danger/20" :
                  "bg-amber/5 border-amber/20"
                }`}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    {correlation.score > 0 ? <Link2 className="w-3.5 h-3.5 text-neon" /> : <Unlink className="w-3.5 h-3.5 text-danger" />}
                    <p className={`text-[11px] font-semibold ${correlation.score > 0 ? "text-neon" : correlation.score < 0 ? "text-danger" : "text-amber"}`}>
                      {correlation.recommendation}
                    </p>
                  </div>
                  {correlation.correlations.map((c, i) => (
                    <p key={i} className="text-[10px] text-mercury/70 mb-0.5">
                      <span className={c.type === "positive" ? "text-neon" : "text-danger"}>
                        {c.type === "positive" ? "+" : "−"}{Math.abs(c.boostPct)}%
                      </span>{" "}
                      {c.explanation}
                    </p>
                  ))}
                  {correlation.overallBoost !== 0 && (
                    <p className={`text-[10px] font-mono font-bold mt-1 ${correlation.overallBoost > 0 ? "text-neon" : "text-danger"}`}>
                      Net correlation boost: {correlation.overallBoost > 0 ? "+" : ""}{correlation.overallBoost}%
                    </p>
                  )}
                </div>
              )}
              {correlation && correlation.correlations.length === 0 && currentParlay.correlationAdjustedProb !== currentParlay.fairProb && (
                <div className="flex items-start gap-2 p-2 rounded bg-amber/5 border border-amber/20">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber flex-shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber/80">
                    Correlated legs detected — probability adjusted
                  </p>
                </div>
              )}

              <div className="border-t border-slate/20 pt-3 flex items-center justify-between">
                <div>
                  <p className="text-xs text-mercury">Suggested Stake</p>
                  <p className="text-lg font-bold font-mono text-gold">
                    ${currentParlay.suggestedStake.toFixed(2)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-mercury">To Win</p>
                  <p className="text-lg font-bold font-mono text-neon">
                    ${currentParlay.potentialPayout.toFixed(2)}
                  </p>
                </div>
              </div>

              {/* Save Button */}
              <button
                onClick={saveParlay}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-purple/20 border border-purple/30 text-purple hover:bg-purple/30 transition-colors text-sm font-semibold"
              >
                <Save className="w-4 h-4" />
                Save Parlay
              </button>
            </div>
          )}

          {parlayLegs.length === 1 && (
            <p className="text-xs text-mercury/60 text-center py-2">Add at least 2 legs to see analysis</p>
          )}
        </div>
      )}

      {/* Saved Parlays — expandable */}
      {savedParlays.length > 0 && (
        <SavedParlays parlays={savedParlays} formatOdds={formatOdds} />
      )}
    </div>
  );
}

function SavedParlays({ parlays, formatOdds }: { parlays: ParlaySlip[]; formatOdds: (n: number) => string }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  return (
    <div className="border-t border-slate/30 px-4 py-3">
      <p className="text-xs text-mercury mb-2 uppercase tracking-wider">Saved ({parlays.length})</p>
      <div className="space-y-1.5">
        {parlays.map((parlay, i) => (
          <div key={i}>
            <button
              onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
              className="w-full flex items-center justify-between py-1.5 hover:bg-gunmetal/20 rounded px-1 -mx-1 transition-colors"
            >
              <span className="text-xs text-mercury">{parlay.legs.length}-leg parlay</span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-silver">{formatOdds(parlay.combinedOdds)}</span>
                <span className={`text-xs font-mono ${parlay.evPercentage > 0 ? "text-neon" : "text-danger"}`}>
                  {parlay.evPercentage > 0 ? "+" : ""}{parlay.evPercentage.toFixed(1)}%
                </span>
                <ChevronDown className={`w-3 h-3 text-mercury/50 transition-transform ${expandedIdx === i ? "rotate-180" : ""}`} />
              </div>
            </button>
            {expandedIdx === i && (
              <div className="ml-2 pl-2 border-l border-slate/20 mt-1 mb-2 space-y-1 animate-slide-up">
                {parlay.legs.map((leg, li) => (
                  <div key={li} className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] text-silver truncate">{leg.pick}</p>
                      <p className="text-[9px] text-mercury/50 truncate">{leg.game} • {leg.bookmaker}</p>
                    </div>
                    <span className="text-[11px] font-mono text-mercury ml-2 flex-shrink-0">
                      {formatOdds(leg.odds)}
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-1 border-t border-slate/10">
                  <span className="text-[10px] text-mercury/60">Payout</span>
                  <span className="text-xs font-mono text-gold">${parlay.potentialPayout.toFixed(2)}</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
