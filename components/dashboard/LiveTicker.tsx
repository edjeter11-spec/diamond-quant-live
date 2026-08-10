"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { useSport } from "@/lib/sport-context";
import { AlertTriangle, TrendingUp, Zap, Newspaper } from "lucide-react";

export default function LiveTicker() {
  const { oddsData, scores } = useStore();
  // Follows the active tab. This used to be hardcoded to MLB while the
  // banner rendered on every tab, so the NBA and NFL tabs scrolled baseball
  // roster moves and MLB headlines above non-baseball content.
  const { currentSport } = useSport();

  // Trades, roster moves and headlines for the CURRENT sport, used when
  // there's nothing live to scroll. The banner used to loop "Scanning markets
  // for edges…", which is both dull and not quite true — nothing is scanning,
  // there just aren't any alerts. Off-hours that was all a visitor ever saw.
  const [feed, setFeed] = useState<Array<{ type: string; text: string }>>([]);
  useEffect(() => {
    let cancelled = false;
    // Clear immediately on a tab switch so the previous sport's headlines
    // don't linger under the new tab while the next fetch is in flight.
    setFeed([]);
    fetch(`/api/ticker-feed?sport=${currentSport}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && Array.isArray(d?.items)) setFeed(d.items);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [currentSport]);

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
        // `pick` on a totals/spread bet already names both teams
        // ("Houston Astros/San Diego Padres Under 8.5"), so prefixing `game`
        // printed the matchup TWICE and made this the widest item on the
        // strip at 1,086px. Only prefix when the pick doesn't already say it.
        const pick = String(best.pick ?? "");
        const gameName = String(best.game ?? "");
        const [away, home] = gameName.split(" @ ");
        const pickNamesTeams =
          (!!away && pick.includes(away)) || (!!home && pick.includes(home));
        const label = pickNamesTeams ? pick : `${gameName} ${pick}`;
        alerts.push({
          type: "ev",
          text: `+EV ALERT: ${label} @ ${best.bookmaker} (${best.odds > 0 ? "+" : ""}${best.odds}) — ${best.evPercentage.toFixed(1)}% edge`,
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
  // News ALWAYS joins the strip — it is not a fallback for an empty banner.
  //
  // This used to be `if (combined.length === 0)`, so a single +EV alert
  // suppressed all 14 news headlines. The padding below then repeated that one
  // alert to fill the strip, producing 9,052px of the SAME sentence scrolling
  // at 82px/s. Nothing changed on screen for the full 110s loop, which is the
  // "banner cuts out" — it wasn't stopping, it had nothing new to show.
  // Live scores and alerts still lead; news fills the rest.
  if (feed.length > 0) {
    combined.push(
      ...feed.map((f) => ({ type: "news" as const, text: f.text })),
    );
  }
  if (combined.length === 0) {
    combined.push({
      type: "ev",
      text: "Quant Betting — no live alerts right now",
    });
  }

  // De-dupe. Live scores and EV alerts are derived from the same oddsData, so
  // the same matchup could appear twice in a row.
  const seenText = new Set<string>();
  const unique = combined.filter((c) => {
    if (seenText.has(c.text)) return false;
    seenText.add(c.text);
    return true;
  });

  // Repeat only until the strip is wide enough to cover the viewport twice,
  // then double for the seamless -50% loop.
  //
  // The keyframe translates -50%, which only loops seamlessly if the strip is
  // at least as wide as the window; on a 375px phone a one-item strip scrolled
  // fully off-screen and the banner really did vanish. But padding to a fixed
  // MIN_ITEMS=8 over-corrected: with real content that built a 9,000px strip
  // whose tail took ~2 minutes to come around. Repeat based on measured need,
  // capped low, so the loop stays short and varied.
  const MIN_REPEATS = unique.length >= 6 ? 1 : unique.length >= 3 ? 2 : 4;
  const padded: typeof unique = [];
  for (let i = 0; i < MIN_REPEATS; i++) padded.push(...unique);
  const tickerItems = [...padded, ...padded];

  // Constant scroll SPEED rather than constant duration.
  //
  // ~70px/s is a comfortable reading pace: a 1,000px headline takes ~14s to
  // cross, and the whole loop stays proportional to how much there is to say.
  // Measured after layout because only the DOM knows the rendered width
  // (fonts, gaps and icon sizes all feed into it).
  const PX_PER_SEC = 70;
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [durationSec, setDurationSec] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = () => {
      // scrollWidth covers BOTH copies; one loop travels half of it (-50%).
      const half = el.scrollWidth / 2;
      if (half > 0) setDurationSec(Math.round(half / PX_PER_SEC));
    };
    measure();
    // Re-measure when the strip changes size — a font swap or an orientation
    // change would otherwise leave the old duration and a wrong speed.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tickerItems.length, currentSport]);

  return (
    <div className="safe-top w-full bg-bunker border-b border-slate/50 overflow-hidden">
      <div className="ticker-wrap">
        <div
          ref={contentRef}
          className="ticker-content py-2 gap-12"
          // Duration is derived from the measured strip width so the SPEED is
          // constant (see PX_PER_SEC). It was a hardcoded 110s in CSS, which
          // means speed changed with content length — a short strip crawled
          // and a long one had a ~2min cycle. A CSS animation cannot know its
          // own width, so it has to be set here.
          style={
            durationSec ? { animationDuration: `${durationSec}s` } : undefined
          }
        >
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
