"use client";

import { useState, useEffect } from "react";
import { useStore } from "@/lib/store";
import { useMemo } from "react";
import {
  Trophy, Brain, Target, ChevronDown, ArrowUpRight, ArrowDownRight,
  Star, Flame, CircleDot, TrendingUp, Clock, RefreshCw, Zap,
} from "lucide-react";
import { getDeepLink } from "@/lib/odds/sportsbooks";
import { getConfidenceTier } from "@/lib/ui/confidence-tier";

interface PropAnalysis {
  rank: number;
  playerName: string;
  team: string;
  gameTime: string | null;
  market: string;
  line: number;
  recommendation: "OVER" | "UNDER";
  confidence: number;
  bestOdds: number;
  bestBook: string;
  fairProb: number;
  evEdge: number;
  reasoning: string[];
  aiSummary: string;
  stats: {
    seasonAvg: number;
    last10Avg: number;
    hitRate: number; // % of games over the line
    trend: "up" | "down" | "flat";
    vsOpponent?: string;
  };
}

const MARKET_LABELS: Record<string, string> = {
  pitcher_strikeouts: "Strikeouts",
  batter_hits: "Hits",
  batter_total_bases: "Total Bases",
  batter_home_runs: "Home Runs",
  batter_rbis: "RBIs",
};

const MARKET_ICONS: Record<string, any> = {
  pitcher_strikeouts: Flame,
  batter_hits: CircleDot,
  batter_total_bases: TrendingUp,
  batter_home_runs: Star,
  batter_rbis: Target,
};

export default function TopPropsOfDay() {
  const { oddsData, scores } = useStore();

  // Build player → team lookup from scores
  const playerTeamMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of scores) {
      if (s.homePitcher && s.homePitcher !== "TBD") map.set(s.homePitcher.toLowerCase(), s.homeAbbrev);
      if (s.awayPitcher && s.awayPitcher !== "TBD") map.set(s.awayPitcher.toLowerCase(), s.awayAbbrev);
    }
    return map;
  }, [scores]);

  function getTeamAbbrev(playerName: string, gameStr: string): string {
    const found = playerTeamMap.get(playerName.toLowerCase());
    if (found) return found;
    // Fallback: show first team abbreviation from game
    const parts = (gameStr ?? "").split(" @ ");
    return parts.map(t => t.split(" ").pop()?.slice(0, 3).toUpperCase()).join("/") || "?";
  }
  const [topProps, setTopProps] = useState<PropAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => {
    if (!hasLoaded) {
      buildTopProps();
    }
  }, []); // Only run ONCE on mount, not on every oddsData change

  async function buildTopProps() {
    setLoading(true);

    // Only fetch 2 markets to conserve API calls (server-side cache will help)
    const markets = ["pitcher_strikeouts", "batter_hits"];

    try {
      const results = await Promise.all(
        markets.map((m) =>
          fetch(`/api/players?market=${m}`).then((r) => r.json()).catch(() => ({ props: [] }))
        )
      );

      const allProps: Array<{ prop: any; market: string }> = [];
      results.forEach((res, i) => {
        for (const prop of res.props ?? []) {
          allProps.push({ prop, market: markets[i] });
        }
      });

      // Score each prop and pick the top 5 (allow single-book props too)
      const scored = allProps
        .filter((p) => p.prop.bestOver && p.prop.bestUnder)
        .map((p) => scoreAndAnalyzeProp(p.prop, p.market))
        .filter((p): p is PropAnalysis => p !== null)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 5)
        .map((p, i) => ({ ...p, rank: i + 1 }));

      // Enrich with player analysis — only for top 2 to save API calls
      // The rest just use the prop data directly
      for (let i = 0; i < Math.min(scored.length, 2); i++) {
        const pick = scored[i];
        try {
          const res = await fetch(
            `/api/player-analysis?name=${encodeURIComponent(pick.playerName)}&market=${pick.market}&line=${pick.line}`
          );
          if (res.ok) {
            const analysis = await res.json();
            const isPitcher = pick.market.startsWith("pitcher_");
            const gameLog = analysis.last10Games ?? [];
            const statKey = isPitcher ? "strikeouts" : "hitsB";
            const values = gameLog.map((g: any) => g[statKey] ?? 0);
            const avg = values.length > 0 ? values.reduce((a: number, b: number) => a + b, 0) / values.length : 0;
            const overCount = values.filter((v: number) => v > pick.line).length;

            pick.stats.last10Avg = Math.round(avg * 100) / 100;
            pick.stats.hitRate = values.length > 0 ? Math.round((overCount / values.length) * 100) : 50;

            const last5 = values.slice(-5);
            const first5 = values.slice(0, 5);
            const avgLast5 = last5.length > 0 ? last5.reduce((a: number, b: number) => a + b, 0) / last5.length : 0;
            const avgFirst5 = first5.length > 0 ? first5.reduce((a: number, b: number) => a + b, 0) / first5.length : 0;
            pick.stats.trend = avgLast5 > avgFirst5 + 0.2 ? "up" : avgLast5 < avgFirst5 - 0.2 ? "down" : "flat";

            pick.reasoning = buildDetailedReasoning(pick, analysis);
            pick.aiSummary = buildAISummary(pick, analysis);

            if (analysis.recommendation) {
              const side = analysis.recommendation.side;
              // Force Over on HR props — Under is dead money for home runs
              if (pick.market === "batter_home_runs") {
                pick.recommendation = "OVER";
              } else if (side === "over" || side === "lean_over") {
                pick.recommendation = "OVER";
              } else if (side === "under" || side === "lean_under") {
                pick.recommendation = "UNDER";
              }
              pick.confidence = Math.max(pick.confidence, analysis.recommendation.confidence);
            }
          }
        } catch {}
      }

      setTopProps(scored);
    } catch (err) {
      console.error("Top props error:", err);
    }
    setLoading(false);
    setHasLoaded(true);
  }

  // Only show loading spinner on first load, not on refreshes
  if (loading && topProps.length === 0 && !hasLoaded) {
    return (
      <div className="glass rounded-xl p-6 text-center">
        <RefreshCw className="w-5 h-5 text-gold/30 animate-spin mx-auto mb-2" />
        <p className="text-xs text-mercury">Analyzing player props across all markets...</p>
      </div>
    );
  }

  // Only show empty state after we've actually tried loading
  if (topProps.length === 0 && hasLoaded) {
    return (
      <div className="glass rounded-xl p-6 text-center">
        <Trophy className="w-6 h-6 text-mercury/20 mx-auto mb-2" />
        <p className="text-sm text-mercury">No prop picks available yet</p>
        <p className="text-[10px] text-mercury/50 mt-1">Books haven't posted enough lines for analysis</p>
      </div>
    );
  }

  if (topProps.length === 0) return null; // Still loading first time, show nothing

  const formatOdds = (odds: number) => (odds > 0 ? `+${odds}` : `${odds}`);

  return (
    <div className="glass rounded-xl overflow-hidden border border-gold/15">
      {/* Header */}
      <div className="px-3 sm:px-4 py-3 border-b border-gold/15 bg-gold/5 flex items-center gap-2">
        <Trophy className="w-5 h-5 text-gold" />
        <div className="flex-1">
          <h2 className="text-sm font-bold text-silver uppercase tracking-wider">Top 5 Player Props</h2>
          <p className="text-[9px] text-mercury/60">AI-analyzed picks across all prop markets today</p>
        </div>
        <button onClick={buildTopProps} className="p-1.5 hover:bg-gunmetal/30 rounded transition-colors">
          <RefreshCw className={`w-3.5 h-3.5 text-mercury ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Top 5 Picks */}
      <div className="divide-y divide-slate/10">
        {topProps.map((pick, i) => {
          const isExpanded = expandedIdx === i;
          const MarketIcon = MARKET_ICONS[pick.market] ?? Target;
          const isOver = pick.recommendation === "OVER";

          return (
            <div key={i}>
              {/* Row */}
              <button
                onClick={() => setExpandedIdx(isExpanded ? null : i)}
                className="w-full px-3 sm:px-4 py-3 flex items-center gap-2 hover:bg-gunmetal/20 active:bg-gunmetal/30 transition-colors text-left"
              >
                {/* Rank */}
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                  i < 3 ? "bg-gold/15 text-gold" : "bg-gunmetal text-mercury"
                }`}>
                  {pick.rank}
                </div>

                {/* Player + Market */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <MarketIcon className={`w-3 h-3 ${isOver ? "text-neon" : "text-purple"} flex-shrink-0`} />
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-electric/15 text-electric font-bold flex-shrink-0">{getTeamAbbrev(pick.playerName, pick.team)}</span>
                    <p className="text-xs sm:text-sm font-semibold text-silver truncate">{pick.playerName}</p>
                  </div>
                  <p className="text-[9px] sm:text-[10px] text-mercury/60">
                    {pick.gameTime && (
                      <span className="text-mercury/80">
                        {new Date(pick.gameTime).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} — </span>
                    )}
                    {MARKET_LABELS[pick.market] ?? pick.market} — {pick.recommendation} {pick.line}
                  </p>
                </div>

                {/* Odds + Confidence */}
                <div className="text-right flex-shrink-0">
                  <p className={`text-xs font-mono font-bold ${isOver ? "text-neon" : "text-purple"}`}>
                    {pick.recommendation} {formatOdds(pick.bestOdds)}
                  </p>
                  {(() => {
                    const tier = getConfidenceTier(pick.confidence);
                    return (
                      <div className="flex items-center gap-1 justify-end">
                        <div className="w-8 h-1 bg-gunmetal rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${tier.bar}`} style={{ width: `${pick.confidence}%` }} />
                        </div>
                        <span className={`text-[9px] ${tier.text}`}>{pick.confidence}%</span>
                      </div>
                    );
                  })()}
                </div>

                <ChevronDown className={`w-3.5 h-3.5 text-mercury/40 flex-shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
              </button>

              {/* Expanded Detail */}
              {isExpanded && (
                <div className="px-3 sm:px-4 pb-4 animate-slide-up space-y-3">
                  {/* AI Summary */}
                  <div className="flex gap-2 p-3 rounded-lg bg-electric/5 border border-electric/15">
                    <Brain className="w-4 h-4 text-electric flex-shrink-0 mt-0.5" />
                    <p className="text-[11px] text-silver leading-relaxed">{pick.aiSummary}</p>
                  </div>

                  {/* Quick Stats */}
                  <div className="grid grid-cols-4 gap-1.5">
                    <div className="text-center p-1.5 rounded bg-gunmetal/40">
                      <p className="text-sm font-bold font-mono text-silver">{pick.stats.last10Avg}</p>
                      <p className="text-[8px] text-mercury uppercase">L10 Avg</p>
                    </div>
                    <div className="text-center p-1.5 rounded bg-gunmetal/40">
                      <p className={`text-sm font-bold font-mono ${pick.stats.hitRate > 55 ? "text-neon" : pick.stats.hitRate < 45 ? "text-danger" : "text-silver"}`}>
                        {pick.stats.hitRate}%
                      </p>
                      <p className="text-[8px] text-mercury uppercase">Hit Rate</p>
                    </div>
                    <div className="text-center p-1.5 rounded bg-gunmetal/40">
                      <p className={`text-sm font-bold font-mono ${pick.evEdge > 3 ? "text-neon" : "text-silver"}`}>
                        +{(pick.evEdge ?? 0).toFixed(1)}%
                      </p>
                      <p className="text-[8px] text-mercury uppercase">EV Edge</p>
                    </div>
                    {(() => {
                      const fp = pick.fairProb ?? 50;
                      const tier = getConfidenceTier(fp);
                      return (
                        <div className={`text-center p-1.5 rounded border ${tier.bg} ${tier.border}`}>
                          <p className={`text-sm font-bold font-mono ${tier.text}`}>{fp.toFixed(0)}%</p>
                          <p className="text-[8px] text-mercury uppercase">Fair Prob</p>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Trend */}
                  <div className="flex items-center gap-2 px-2">
                    <span className="text-[10px] text-mercury">Trend:</span>
                    <span className={`text-[10px] font-semibold ${
                      pick.stats.trend === "up" ? "text-neon" : pick.stats.trend === "down" ? "text-danger" : "text-mercury"
                    }`}>
                      {pick.stats.trend === "up" ? "Trending UP" : pick.stats.trend === "down" ? "Trending DOWN" : "Steady"}
                    </span>
                  </div>

                  {/* Detailed Reasoning */}
                  <div className="rounded-lg bg-gunmetal/20 p-3">
                    <p className="text-[9px] text-mercury uppercase tracking-wider mb-2 font-semibold flex items-center gap-1">
                      <Target className="w-3 h-3" /> Why This Prop
                    </p>
                    <div className="space-y-1">
                      {pick.reasoning.map((r, ri) => (
                        <p key={ri} className="text-[11px] text-mercury flex gap-1.5">
                          <span className="text-neon font-bold">{'>'}</span> {r}
                        </p>
                      ))}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex gap-2">
                    {getDeepLink(pick.bestBook, { sport: "mlb" }) && (
                      <a
                        href={getDeepLink(pick.bestBook, { sport: "mlb" })}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 py-2.5 rounded-lg bg-electric/10 border border-electric/20 text-electric text-xs font-semibold hover:bg-electric/20 transition-all flex items-center justify-center gap-1"
                      >
                        Open {pick.bestBook.split(" ")[0]}
                      </a>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const { addParlayLeg } = useStore.getState();
                        addParlayLeg({
                          game: pick.playerName,
                          market: "player_prop",
                          pick: `${pick.playerName} ${pick.recommendation} ${pick.line} ${MARKET_LABELS[pick.market]}`,
                          odds: pick.bestOdds,
                          fairProb: pick.fairProb / 100,
                          bookmaker: pick.bestBook,
                        });
                      }}
                      className={`flex-1 py-2.5 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1 ${
                        isOver
                          ? "bg-neon/10 border border-neon/20 text-neon hover:bg-neon/20"
                          : "bg-purple/10 border border-purple/20 text-purple hover:bg-purple/20"
                      }`}
                    >
                      {isOver ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                      Add to Parlay
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Scoring + Analysis Helpers
// ──────────────────────────────────────────────────────────

function scoreAndAnalyzeProp(prop: any, market: string): PropAnalysis | null {
  if (!prop.bestOver || !prop.bestUnder) return null;

  const overProb = (prop.fairOverProb ?? 50) / 100;
  const underProb = (prop.fairUnderProb ?? 50) / 100;

  // Determine which side has more value
  const isOver = overProb > 0.52;
  const side = isOver ? "OVER" as const : "UNDER" as const;
  const bestOdds = isOver ? prop.bestOver.price : prop.bestUnder.price;
  const bestBook = isOver ? prop.bestOver.bookmaker : prop.bestUnder.bookmaker;
  const fairProb = isOver ? overProb : underProb;

  // EV edge — with safety for bad odds data
  if (bestOdds === 0 || !isFinite(bestOdds)) return null;
  const impliedProb = bestOdds > 0 ? 100 / (bestOdds + 100) : Math.abs(bestOdds) / (Math.abs(bestOdds) + 100);
  if (impliedProb <= 0 || impliedProb >= 1 || !isFinite(impliedProb)) return null;
  const evEdge = ((fairProb - impliedProb) / impliedProb) * 100;
  if (!isFinite(evEdge)) return null;

  // Confidence based on: edge size + number of books + how far from 50/50
  const bookCount = prop.books?.length ?? 1;
  const probDeviation = Math.abs(fairProb - 0.5) * 100;
  const confidence = Math.min(
    Math.max(Math.round(evEdge * 3 + probDeviation * 2 + bookCount * 5), 0),
    90
  );

  if (confidence < 15) return null;

  return {
    rank: 0,
    playerName: prop.playerName,
    team: prop.team ?? "",
    gameTime: prop.gameTime ?? null,
    market,
    line: prop.line,
    recommendation: side,
    confidence,
    bestOdds,
    bestBook,
    fairProb: Math.round(fairProb * 1000) / 10,
    evEdge: Math.round(evEdge * 100) / 100,
    reasoning: [
      `Fair probability: ${(fairProb * 100).toFixed(1)}% ${side} (de-vigged from ${bookCount} books)`,
      `Best price: ${bestOdds > 0 ? "+" : ""}${bestOdds} at ${bestBook}`,
      evEdge > 3 ? `Strong +${evEdge.toFixed(1)}% edge over market` : `+${evEdge.toFixed(1)}% edge`,
    ],
    aiSummary: `The model favors ${side} ${prop.line} ${MARKET_LABELS[market] ?? market} for ${prop.playerName}. Best available at ${bestBook}.`,
    stats: {
      seasonAvg: 0,
      last10Avg: 0,
      hitRate: 50,
      trend: "flat" as const,
    },
  };
}

function buildDetailedReasoning(pick: PropAnalysis, analysis: any): string[] {
  const r: string[] = [];
  const ml = MARKET_LABELS[pick.market] ?? pick.market;
  const isOver = pick.recommendation === "OVER";

  // Average vs line
  if (pick.stats.last10Avg > 0) {
    const diff = pick.stats.last10Avg - pick.line;
    if (isOver && diff > 0) {
      r.push(`Averaging ${pick.stats.last10Avg} ${ml} over last 10 games — ${Math.abs(diff).toFixed(1)} above the ${pick.line} line`);
    } else if (!isOver && diff < 0) {
      r.push(`Averaging ${pick.stats.last10Avg} ${ml} over last 10 games — ${Math.abs(diff).toFixed(1)} below the ${pick.line} line`);
    } else {
      r.push(`Averaging ${pick.stats.last10Avg} ${ml} over last 10 games (line: ${pick.line})`);
    }
  }

  // Hit rate
  if (pick.stats.hitRate > 60) {
    r.push(`Hit the ${isOver ? "over" : "under"} in ${pick.stats.hitRate}% of recent games — strong consistency`);
  } else if (pick.stats.hitRate > 50) {
    r.push(`Over rate: ${pick.stats.hitRate}% in recent games`);
  }

  // Trend
  if (pick.stats.trend === "up" && isOver) {
    r.push("Trending upward — recent performance better than earlier in the stretch");
  } else if (pick.stats.trend === "down" && !isOver) {
    r.push("Trending downward — supports the under");
  }

  // Season stats context
  if (analysis.player) {
    if (analysis.player.k9 && analysis.player.k9 > 9) {
      r.push(`Elite strikeout rate: ${analysis.player.k9.toFixed(1)} K/9 this season`);
    }
    if (analysis.player.avg && analysis.player.avg > 0.290) {
      r.push(`Batting ${analysis.player.avg.toFixed(3)} — well above league average`);
    }
    if (analysis.player.ops && analysis.player.ops > 0.850) {
      r.push(`${analysis.player.ops.toFixed(3)} OPS — big power numbers support total bases`);
    }
  }

  // EV edge
  r.push(`${pick.evEdge > 3 ? "Strong" : "Positive"} +${pick.evEdge.toFixed(1)}% EV edge at ${pick.bestBook} (${pick.bestOdds > 0 ? "+" : ""}${pick.bestOdds})`);

  return r;
}

function buildAISummary(pick: PropAnalysis, analysis: any): string {
  const ml = MARKET_LABELS[pick.market] ?? pick.market;
  const isOver = pick.recommendation === "OVER";

  if (pick.confidence > 60) {
    return `Strong play. ${pick.playerName} is averaging ${pick.stats.last10Avg} ${ml} over the last 10 games against a line of ${pick.line}. The ${isOver ? "over" : "under"} has hit in ${pick.stats.hitRate}% of recent outings. ${pick.bestBook} has the best price at ${pick.bestOdds > 0 ? "+" : ""}${pick.bestOdds} with a +${pick.evEdge.toFixed(1)}% edge. ${pick.stats.trend === "up" ? "Performance is trending upward." : pick.stats.trend === "down" ? "Note: recent trend is declining." : ""}`;
  }

  return `${pick.playerName} ${isOver ? "over" : "under"} ${pick.line} ${ml} — fair probability ${pick.fairProb.toFixed(0)}% based on multi-book consensus. Averaging ${pick.stats.last10Avg} recently with a ${pick.stats.hitRate}% ${isOver ? "over" : "under"} rate. Best price at ${pick.bestBook} (${pick.bestOdds > 0 ? "+" : ""}${pick.bestOdds}).`;
}
