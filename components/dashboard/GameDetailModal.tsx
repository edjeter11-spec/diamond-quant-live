"use client";

import { useEffect, useCallback } from "react";
import { X, TrendingUp, BookOpen, ShoppingCart, Lightbulb, Plus } from "lucide-react";
import TeamLogo from "@/components/ui/TeamLogo";
import { useStore } from "@/lib/store";

interface GameDetailModalProps {
  gameId: string;
  analyses: any[];
  onClose: () => void;
  onAddToParlay?: (pick: any) => void;
}

const fmt = (odds: number) => (odds === 0 ? "—" : odds > 0 ? `+${odds}` : `${odds}`);

// Highlight the best odds cell: for ML & spread price, highest number = best.
// For total O/U price, highest number = best.
function bestInColumn(lines: any[], getter: (l: any) => number): number | null {
  const vals = lines.map(getter).filter((v) => v !== 0 && !isNaN(v));
  if (!vals.length) return null;
  return Math.max(...vals);
}

export default function GameDetailModal({ gameId, analyses, onClose, onAddToParlay }: GameDetailModalProps) {
  const { oddsData, scores, addParlayLeg } = useStore();

  const gameOdds = oddsData.find((g: any) => g.id === gameId);
  const gameScore = scores.find((s: any) => s.id === gameId);

  // Match analysis by home team name
  const analysis = analyses.find((a: any) =>
    gameOdds && (a.homeTeam === gameOdds.homeTeam || a.homeAbbrev === gameOdds.homeTeam?.split(" ").pop())
  );

  const homeTeam = gameOdds?.homeTeam ?? gameScore?.homeTeam ?? "Home";
  const awayTeam = gameOdds?.awayTeam ?? gameScore?.awayTeam ?? "Away";
  const homeAbbrev = gameScore?.homeAbbrev ?? homeTeam.split(" ").pop()?.slice(0, 3).toUpperCase() ?? "HME";
  const awayAbbrev = gameScore?.awayAbbrev ?? awayTeam.split(" ").pop()?.slice(0, 3).toUpperCase() ?? "AWY";
  const isLive = gameScore?.status === "live";
  const oddsLines: any[] = gameOdds?.oddsLines ?? [];
  const bestLines = gameOdds?.bestLines ?? {};

  // consensus data
  const consensus = analysis?.consensus;
  const homeWinProb = consensus?.homeWinProb ?? analysis?.homeWinProb ?? null;
  const confLabel = consensus?.confidence ?? "—";
  const confColor =
    confLabel === "HIGH" ? "text-neon" : confLabel === "MEDIUM" ? "text-amber" : "text-mercury";

  // All picks from analysis
  const allPicks: any[] = analysis?.picks ?? [];

  // Best-in-column values
  const bestHomeML = bestInColumn(oddsLines, (l) => l.homeML);
  const bestAwayML = bestInColumn(oddsLines, (l) => l.awayML);
  const bestSpreadPrice = bestInColumn(oddsLines, (l) => l.spreadPrice);
  const bestOverPrice = bestInColumn(oddsLines, (l) => l.overPrice);
  const bestUnderPrice = bestInColumn(oddsLines, (l) => l.underPrice);

  // Key factors from reasoning
  const keyFactors: string[] = analysis?.reasoning ?? analysis?.takeaways ?? [];

  // Top pick for "Add to Parlay"
  const topPick = allPicks[0] ?? (gameOdds?.evBets?.[0] ?? null);

  const handleAddParlay = useCallback(() => {
    if (!topPick) return;
    addParlayLeg({
      game: `${awayTeam} @ ${homeTeam}`,
      market: topPick.market ?? "moneyline",
      pick: topPick.pick,
      odds: topPick.odds,
      fairProb: topPick.fairProb ?? 50,
      bookmaker: topPick.bookmaker,
    });
    onAddToParlay?.(topPick);
    onClose();
  }, [topPick, addParlayLeg, awayTeam, homeTeam, onAddToParlay, onClose]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-2xl max-h-[92vh] overflow-y-auto glass rounded-2xl border border-slate/30 shadow-2xl animate-slide-up">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 p-1.5 rounded-lg hover:bg-gunmetal/60 transition-colors"
        >
          <X className="w-4 h-4 text-mercury" />
        </button>

        {/* Header — teams + score or scheduled time */}
        <div className="px-4 sm:px-6 pt-5 pb-4 border-b border-slate/20">
          <div className="flex items-center justify-between gap-4">
            {/* Away */}
            <div className="flex flex-col items-center gap-2 flex-1 min-w-0">
              <TeamLogo team={awayAbbrev} size={48} />
              <p className="text-sm font-bold text-silver text-center leading-tight">{awayTeam}</p>
              {isLive && (
                <span className="text-2xl font-bold font-mono text-silver">{gameScore?.awayScore ?? 0}</span>
              )}
            </div>

            {/* Center — status */}
            <div className="flex flex-col items-center gap-1 flex-shrink-0">
              {isLive ? (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-danger" />
                    </span>
                    <span className="text-xs font-bold text-danger uppercase tracking-wider">Live</span>
                  </div>
                  <p className="text-[11px] text-mercury/60">
                    {gameScore?.periodLabel ?? gameScore?.detailedStatus ?? ""}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-xs text-mercury/60 uppercase tracking-wider">
                    {gameScore?.status === "final" ? "Final" : "Scheduled"}
                  </p>
                  <p className="text-sm font-semibold text-silver">
                    {gameScore?.startTime
                      ? new Date(gameScore.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
                      : "TBD"}
                  </p>
                </>
              )}
              <span className="text-mercury/30 text-xs font-mono">@</span>
            </div>

            {/* Home */}
            <div className="flex flex-col items-center gap-2 flex-1 min-w-0">
              <TeamLogo team={homeAbbrev} size={48} />
              <p className="text-sm font-bold text-silver text-center leading-tight">{homeTeam}</p>
              {isLive && (
                <span className="text-2xl font-bold font-mono text-silver">{gameScore?.homeScore ?? 0}</span>
              )}
            </div>
          </div>
        </div>

        <div className="px-4 sm:px-6 py-4 space-y-5">

          {/* Section 1 — Model Consensus */}
          {(homeWinProb !== null || consensus) && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-3.5 h-3.5 text-neon" />
                <h3 className="text-xs font-semibold text-mercury uppercase tracking-wider">Model Consensus</h3>
              </div>
              <div className="glass rounded-xl p-4 space-y-3">
                {/* Confidence */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-mercury">Confidence</span>
                  <span className={`text-xs font-bold ${confColor}`}>{confLabel}</span>
                </div>

                {/* Home win probability bar */}
                {homeWinProb !== null && (
                  <div>
                    <div className="flex justify-between text-[11px] text-mercury/70 mb-1">
                      <span>{awayTeam.split(" ").pop()}</span>
                      <span>{homeTeam.split(" ").pop()}</span>
                    </div>
                    <div className="relative h-3 rounded-full bg-gunmetal/50 overflow-hidden">
                      <div
                        className="absolute inset-y-0 left-0 bg-gradient-to-r from-electric/60 to-neon/60 rounded-full"
                        style={{ width: `${homeWinProb}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[11px] font-mono mt-1">
                      <span className="text-electric/80">{(100 - homeWinProb).toFixed(0)}%</span>
                      <span className="text-neon/80">{homeWinProb.toFixed(0)}%</span>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Section 2 — All Picks */}
          {allPicks.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <BookOpen className="w-3.5 h-3.5 text-electric" />
                <h3 className="text-xs font-semibold text-mercury uppercase tracking-wider">All Picks</h3>
              </div>
              <div className="glass rounded-xl overflow-hidden divide-y divide-slate/20">
                {allPicks.map((p: any, i: number) => (
                  <div key={i} className="px-3 py-2.5 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-silver truncate">{p.pick}</p>
                      <p className="text-[10px] text-mercury/50">
                        {(p.market ?? "").toUpperCase()} · {p.bookmaker}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="font-mono text-sm text-silver">{fmt(p.odds)}</span>
                      {p.evPercentage > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-neon/10 text-neon text-[10px] font-bold">
                          +{p.evPercentage.toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Section 3 — Line Shopping */}
          {oddsLines.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <ShoppingCart className="w-3.5 h-3.5 text-gold" />
                <h3 className="text-xs font-semibold text-mercury uppercase tracking-wider">Line Shopping</h3>
              </div>
              <div className="glass rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate/25">
                        <th className="px-3 py-2 text-left text-[10px] text-mercury/60 font-medium">Book</th>
                        <th className="px-2 py-2 text-center text-[10px] text-mercury/60 font-medium">
                          {awayTeam.split(" ").pop()} ML
                        </th>
                        <th className="px-2 py-2 text-center text-[10px] text-mercury/60 font-medium">
                          {homeTeam.split(" ").pop()} ML
                        </th>
                        <th className="px-2 py-2 text-center text-[10px] text-mercury/60 font-medium">Spread</th>
                        <th className="px-2 py-2 text-center text-[10px] text-mercury/60 font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {oddsLines.map((line: any, i: number) => (
                        <tr key={i} className="border-b border-slate/10 hover:bg-gunmetal/30 transition-colors">
                          <td className="px-3 py-2 font-medium text-silver">{line.bookmaker}</td>
                          <td className={`px-2 py-2 text-center font-mono font-semibold ${
                            line.awayML === bestAwayML ? "text-neon bg-neon/8 rounded" : "text-mercury"
                          }`}>
                            {fmt(line.awayML)}
                          </td>
                          <td className={`px-2 py-2 text-center font-mono font-semibold ${
                            line.homeML === bestHomeML ? "text-neon bg-neon/8 rounded" : "text-mercury"
                          }`}>
                            {fmt(line.homeML)}
                          </td>
                          <td className="px-2 py-2 text-center font-mono text-mercury">
                            <span className={line.spreadPrice === bestSpreadPrice ? "text-neon font-semibold" : ""}>
                              {line.homeSpread > 0 ? "+" : ""}{line.homeSpread} {fmt(line.spreadPrice)}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-center font-mono text-mercury">
                            <span className={line.overPrice === bestOverPrice || line.underPrice === bestUnderPrice ? "text-neon font-semibold" : ""}>
                              {line.total ? `O${line.total} ${fmt(line.overPrice)}` : "—"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="px-3 py-2 text-[10px] text-mercury/40 border-t border-slate/15">
                  Green = best odds available in that column
                </p>
              </div>
            </section>
          )}

          {/* Section 4 — Key Factors */}
          {keyFactors.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Lightbulb className="w-3.5 h-3.5 text-amber" />
                <h3 className="text-xs font-semibold text-mercury uppercase tracking-wider">Key Factors</h3>
              </div>
              <div className="glass rounded-xl p-4 space-y-2">
                {keyFactors.slice(0, 6).map((factor: string, i: number) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-amber/60 text-[10px] mt-0.5">◆</span>
                    <p className="text-xs text-mercury leading-relaxed">{factor}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Bottom — Add to Parlay */}
          {topPick && (
            <button
              onClick={handleAddParlay}
              className="w-full py-3 rounded-xl bg-neon/15 text-neon border border-neon/30 font-semibold text-sm hover:bg-neon/25 transition-colors flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add {topPick.pick} to Parlay
            </button>
          )}

          {/* Empty state when no data */}
          {!gameOdds && !analysis && (
            <div className="py-8 text-center">
              <p className="text-sm text-mercury/60">No detailed data available for this game yet.</p>
              <p className="text-[11px] text-mercury/40 mt-1">Check back after odds are posted.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
