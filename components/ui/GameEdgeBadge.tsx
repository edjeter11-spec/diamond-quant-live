"use client";

import { useMemo } from "react";
import { TrendingUp, TrendingDown, Zap } from "lucide-react";
import { useSport } from "@/lib/sport-context";

interface Props {
  homeAbbrev: string;
  awayAbbrev: string;
}

// One-glance "Quant edge" chip. For NBA uses the net-rating gap from
// pace-ratings.ts. For MLB (no ratings table), skips silently.
export default function GameEdgeBadge({ homeAbbrev, awayAbbrev }: Props) {
  const { currentSport } = useSport();

  const edge = useMemo(() => {
    if (currentSport !== "nba" || !homeAbbrev || !awayAbbrev) return null;
    try {
      // Dynamic import to avoid pulling the ratings table client-side when not NBA
      const { NBA_TEAM_RATINGS } = require("@/lib/nba/pace-ratings");
      const home = NBA_TEAM_RATINGS[homeAbbrev];
      const away = NBA_TEAM_RATINGS[awayAbbrev];
      if (!home || !away) return null;
      const netGap = home.netRating - away.netRating;
      if (Math.abs(netGap) < 2) return null; // not meaningful
      return {
        netGap: Math.round(netGap * 10) / 10,
        favorsHome: netGap > 0,
        homeNet: home.netRating,
        awayNet: away.netRating,
      };
    } catch {
      return null;
    }
  }, [currentSport, homeAbbrev, awayAbbrev]);

  if (!edge) return null;

  const abs = Math.abs(edge.netGap);
  const tier = abs >= 8 ? "strong" : abs >= 4 ? "moderate" : "slight";
  const color = tier === "strong"
    ? "text-gold border-gold/40 bg-gold/10"
    : tier === "moderate"
    ? "text-neon border-neon/30 bg-neon/10"
    : "text-electric border-electric/25 bg-electric/5";

  const Arrow = edge.favorsHome ? TrendingUp : TrendingDown;

  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[9px] font-bold font-mono ${color}`}
      title={`Net rating: ${homeAbbrev} ${edge.homeNet > 0 ? "+" : ""}${edge.homeNet} vs ${awayAbbrev} ${edge.awayNet > 0 ? "+" : ""}${edge.awayNet}`}
    >
      {tier === "strong" && <Zap className="w-2.5 h-2.5" />}
      <Arrow className="w-2.5 h-2.5" />
      NET {edge.netGap > 0 ? "+" : ""}{edge.netGap}
    </span>
  );
}
