"use client";

import { useStore } from "@/lib/store";
import { AlertTriangle, TrendingUp, Zap } from "lucide-react";

export default function LiveTicker() {
  const { oddsData, scores } = useStore();

  // Live scores get their own dedicated, always-first entries — a real
  // scrolling scoreboard rather than one alert buried among arbs/EV lines.
  const liveScores: Array<{ text: string }> = [];
  for (const score of scores) {
    if (score.status !== "live") continue;
    // Skip ghost-live games (status flipped but no actual play yet) — avoids "0 0 ▲1" noise
    const hasAction =
      (score.awayScore ?? 0) > 0 ||
      (score.homeScore ?? 0) > 0 ||
      (score.inning ?? 0) > 1 ||
      (score.period ?? 0) > 1 ||
      (score.outs ?? 0) > 0;
    if (!hasAction) continue;
    const isMLB = score.inningHalf != null;
    const periodTxt = isMLB
      ? `${score.inningHalf === "top" ? "Top" : "Bot"} ${score.inning ?? 1}`
      : `${score.periodLabel || `Q${score.period ?? 1}`}${score.timeRemaining ? ` ${score.timeRemaining}` : ""}`;
    liveScores.push({
      text: `${score.awayAbbrev} ${score.awayScore ?? 0} - ${score.homeAbbrev} ${score.homeScore ?? 0} · ${periodTxt}`,
    });
  }

  // Collect all alerts: arbs, big EV
  const alerts: Array<{
    type: "arb" | "ev";
    text: string;
    priority: number;
  }> = [];

  for (const game of oddsData) {
    if (game.arbitrage?.length > 0) {
      for (const arb of game.arbitrage) {
        alerts.push({
          type: "arb",
          text: `GOLDEN ARB: ${arb.game} — ${arb.side1.pick} @ ${arb.side1.bookmaker} / ${arb.side2.pick} @ ${arb.side2.bookmaker} (+${arb.profit.toFixed(1)}% profit)`,
          priority: 3,
        });
      }
    }
    if (game.evBets?.length > 0) {
      const best = game.evBets[0];
      if (best.evPercentage > 5) {
        alerts.push({
          type: "ev",
          text: `+EV ALERT: ${best.game} ${best.pick} @ ${best.bookmaker} (${best.odds > 0 ? "+" : ""}${best.odds}) — ${best.evPercentage.toFixed(1)}% edge`,
          priority: 2,
        });
      }
    }
  }

  // Sort alerts by priority
  alerts.sort((a, b) => b.priority - a.priority);

  // Merge: live scores first (dedicated scoreboard entries), then alerts.
  // If there's truly nothing to show, fall back to a default idle message.
  const combined: Array<{ type: "arb" | "ev" | "live"; text: string }> = [
    ...liveScores.map((s) => ({ type: "live" as const, text: s.text })),
    ...alerts,
  ];
  if (combined.length === 0) {
    combined.push({
      type: "ev",
      text: "Quant Betting — Scanning markets for edges...",
    });
  }

  // Double the content for seamless loop
  const tickerItems = [...combined, ...combined];

  return (
    <div className="safe-top w-full bg-bunker border-b border-slate/50 overflow-hidden">
      <div className="ticker-wrap">
        <div className="ticker-content py-2 gap-12">
          {tickerItems.map((alert, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-2 px-6 text-sm font-mono whitespace-nowrap"
            >
              {alert.type === "arb" && (
                <>
                  <Zap className="w-3.5 h-3.5 text-gold flex-shrink-0" />
                  <span className="text-gold font-semibold">{alert.text}</span>
                </>
              )}
              {alert.type === "ev" && (
                <>
                  <TrendingUp className="w-3.5 h-3.5 text-neon flex-shrink-0" />
                  <span className="text-neon">{alert.text}</span>
                </>
              )}
              {alert.type === "live" && (
                <>
                  <span className="relative flex h-2 w-2 flex-shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-danger" />
                  </span>
                  <span className="text-silver">{alert.text}</span>
                </>
              )}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
