"use client";

import { useStore } from "@/lib/store";
import { AlertTriangle, TrendingUp, Zap } from "lucide-react";

export default function LiveTicker() {
  const { oddsData, scores } = useStore();

  // Collect all alerts: arbs, big EV, live scores
  const alerts: Array<{ type: "arb" | "ev" | "live"; text: string; priority: number }> = [];

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

  for (const score of scores) {
    if (score.status === "live") {
      alerts.push({
        type: "live",
        text: `LIVE: ${score.awayAbbrev} ${score.awayScore} @ ${score.homeAbbrev} ${score.homeScore} (${score.inningHalf === "top" ? "▲" : "▼"}${score.inning})`,
        priority: 1,
      });
    }
  }

  // Sort by priority
  alerts.sort((a, b) => b.priority - a.priority);

  // If no alerts, show default
  if (alerts.length === 0) {
    alerts.push({ type: "ev", text: "Diamond-Quant Live — Scanning markets for edges...", priority: 0 });
  }

  // Double the content for seamless loop
  const tickerItems = [...alerts, ...alerts];

  return (
    <div className="w-full bg-bunker border-b border-slate/50 overflow-hidden">
      <div className="ticker-wrap">
        <div className="ticker-content py-2 gap-12">
          {tickerItems.map((alert, i) => (
            <span key={i} className="inline-flex items-center gap-2 px-6 text-sm font-mono whitespace-nowrap">
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
