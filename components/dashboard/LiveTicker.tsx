"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { AlertTriangle, TrendingUp, Zap, Newspaper } from "lucide-react";

export default function LiveTicker() {
  const { oddsData, scores } = useStore();

  // Real MLB trades, roster moves and headlines, used when there's nothing
  // live to scroll. The banner used to loop "Scanning markets for edges…",
  // which is both dull and not quite true — nothing is scanning, there just
  // aren't any alerts. Off-hours that was the only thing a visitor ever saw.
  const [feed, setFeed] = useState<Array<{ type: string; text: string }>>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/ticker-feed")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && Array.isArray(d?.items)) setFeed(d.items);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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
  const combined: Array<{
    type: "arb" | "ev" | "live" | "news";
    text: string;
  }> = [
    ...liveScores.map((s) => ({ type: "live" as const, text: s.text })),
    ...alerts,
  ];
  // Nothing live? Show real news rather than a placeholder. Only fall back to
  // a static line if the feed itself is unavailable, so the banner is never
  // empty.
  if (combined.length === 0) {
    if (feed.length > 0) {
      combined.push(
        ...feed.map((f) => ({ type: "news" as const, text: f.text })),
      );
    } else {
      combined.push({
        type: "ev",
        text: "Quant Betting — no live alerts right now",
      });
    }
  }

  // Repeat until the strip is comfortably wider than any phone, then double
  // for the seamless loop.
  //
  // The keyframe translates -50%, which only loops seamlessly if the rendered
  // content is exactly twice the visible width. With one or two short items on
  // a 375px screen the doubled strip was still narrower than the viewport, so
  // it scrolled fully off-screen and the banner appeared to vanish a few
  // seconds after load. Padding the list first keeps -50% correct at every
  // width.
  const MIN_ITEMS = 8;
  const padded: typeof combined = [];
  while (padded.length < MIN_ITEMS && combined.length > 0) {
    padded.push(...combined);
  }
  const tickerItems = [...padded, ...padded];

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
              {alert.type === "news" && (
                <>
                  <Newspaper className="w-3.5 h-3.5 text-mercury/60 flex-shrink-0" />
                  <span className="text-mercury">{alert.text}</span>
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
