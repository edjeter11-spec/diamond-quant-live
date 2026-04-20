"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Users, ArrowUpRight, ArrowDownRight, Flame, ChevronRight, ChevronDown, Brain } from "lucide-react";
import { americanToDecimal } from "@/lib/model/kelly";
import { useStore } from "@/lib/store";
import { usePremium } from "@/lib/hooks/usePremium";
import InfoTip from "@/components/ui/InfoTip";
import PlayerAvatar from "@/components/ui/PlayerAvatar";
import PropDetail from "@/components/dashboard/PropDetail";

interface RawProp {
  playerName: string;
  playerId?: number | string;
  team?: string;
  line: number;
  market: string;
  gameTime?: string;
  bestOver?: { price: number; bookmaker: string };
  bestUnder?: { price: number; bookmaker: string };
  fairOverProb: number;  // 0-100 — market devig
  fairUnderProb: number; // 0-100 — market devig
  // Brain projection — only set for NBA when the brain has opinion
  brainOverProb?: number;       // 0-100 from projectProp
  brainUnderProb?: number;      // 0-100
  brainSide?: "over" | "under";
  brainConfidence?: number;     // 0-100
  brainProjectedValue?: number;
  injuryStatus?: "Out" | "Doubtful" | "Questionable" | "Probable" | "Day-To-Day";
  // Best-EV alternate line from /api/players (null when main is optimal)
  bestAlt?: {
    line: number;
    side: "over" | "under";
    price: number;
    bookmaker: string;
    fairProb: number;
    edgePct: number;
  } | null;
}

interface PropPick {
  key: string;
  playerName: string;
  playerId?: number | string;
  team?: string;
  side: "over" | "under";
  line: number;
  market: string;
  odds: number;
  bookmaker: string;
  fairProb: number;      // 0-100 — used for ranking (brain or market)
  evPercentage: number;  // edge over implied (always vs market devig)
  score: number;
  label: string;         // "Points", "Hits", etc.
  usesBrain?: boolean;   // true when probability came from the brain, not devig
  projectedValue?: number; // brain's projected stat (NBA only)
  bestAlt?: RawProp["bestAlt"];
}

const MARKET_LABEL: Record<string, string> = {
  player_points: "Points",
  player_rebounds: "Rebounds",
  player_assists: "Assists",
  pitcher_strikeouts: "Strikeouts",
  batter_hits: "Hits",
  batter_home_runs: "Home Runs",
  batter_total_bases: "Total Bases",
};

// Over-bias: users prefer Overs, so when probabilities are within 1.5%,
// we nudge the Over. Also add +1 to the ranking score to prioritize displayed Overs.
const OVER_BIAS_TIE_BREAK = 1.5;
const OVER_DISPLAY_BOOST = 1.0;

// Markets where "under" is a dead bet (e.g. home runs — line is 0.5,
// under = "won't hit a homer" which has no real analytical edge).
// We force Over side and never render an Under suggestion.
const OVER_ONLY_MARKETS = new Set(["batter_home_runs"]);

function americanImplied(odds: number): number {
  if (!odds) return 0.5;
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

function scoreProp(side: "over" | "under", prop: RawProp): PropPick | null {
  const best = side === "over" ? prop.bestOver : prop.bestUnder;
  if (!best?.price) return null;

  // Prefer brain probability when present (NBA only); fall back to market devig.
  const brainFair = side === "over" ? prop.brainOverProb : prop.brainUnderProb;
  const marketFair = side === "over" ? prop.fairOverProb : prop.fairUnderProb;
  const usesBrain = typeof brainFair === "number" && brainFair > 0;
  // Always have *some* probability signal — fall back to the implied book
  // probability if both brain and devig are missing, so the row still ranks.
  const impliedFallback = americanImplied(best.price) * 100;
  const fair = usesBrain
    ? brainFair!
    : (marketFair && marketFair > 0 ? marketFair : impliedFallback);

  const implied = americanImplied(best.price) * 100;
  // EV always measured against market implied (that's what you actually bet into)
  const ev = fair - implied;

  const boost = side === "over" ? OVER_DISPLAY_BOOST : 0;
  // Slight score bonus when brain is behind the pick — brain picks go higher
  const brainBonus = usesBrain ? 0.5 : 0;
  const score = (fair - 50) + ev * 0.5 + boost + brainBonus;

  return {
    key: `${prop.market}-${prop.playerName}-${side}`,
    playerName: prop.playerName,
    playerId: prop.playerId,
    team: prop.team,
    side,
    line: prop.line,
    market: prop.market,
    odds: best.price,
    bookmaker: best.bookmaker,
    fairProb: Math.round(fair * 10) / 10,
    evPercentage: Math.round(ev * 10) / 10,
    score,
    label: MARKET_LABEL[prop.market] ?? prop.market,
    usesBrain,
    projectedValue: prop.brainProjectedValue,
    bestAlt: prop.bestAlt ?? null,
  };
}

export default function TodayPropPicks({
  sport,
  propsData,
  loading,
}: {
  sport: "mlb" | "nba";
  propsData: Record<string, RawProp[]>;
  loading: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const [openPick, setOpenPick] = useState<string | null>(null);
  const { addParlayLeg } = useStore();
  const { isPremium } = usePremium();

  const picks = useMemo<PropPick[]>(() => {
    const all: PropPick[] = [];
    for (const market of Object.keys(propsData)) {
      for (const prop of propsData[market] ?? []) {
        if (!prop.playerName) continue;
        if (prop.injuryStatus === "Out" || prop.injuryStatus === "Doubtful") continue;

        // Side pick with Over preference: when both sides are within the
        // tiebreak window, pick Over. Under still wins when the edge is
        // clearly on that side. HR / 0.5 lines always force Over.
        const marketOver = prop.fairOverProb ?? 50;
        const marketUnder = prop.fairUnderProb ?? 50;
        const forceOver = OVER_ONLY_MARKETS.has(prop.market);
        const side: "over" | "under" =
          forceOver || marketOver >= marketUnder - OVER_BIAS_TIE_BREAK ? "over" : "under";

        const best = side === "over" ? prop.bestOver : prop.bestUnder;
        if (!best?.price) continue; // truly un-priced → skip

        const fair = side === "over" ? marketOver : marketUnder;
        const implied = americanImplied(best.price) * 100;
        const ev = fair - implied;

        // Brain opinion is metadata only — it adds a badge + reasoning,
        // never filters the row out.
        const brainFair = side === "over" ? prop.brainOverProb : prop.brainUnderProb;
        const usesBrain = typeof brainFair === "number" && brainFair > 0;

        all.push({
          key: `${prop.market}-${prop.playerName}-${side}`,
          playerName: prop.playerName,
          playerId: prop.playerId,
          team: prop.team,
          side,
          line: prop.line,
          market: prop.market,
          odds: best.price,
          bookmaker: best.bookmaker,
          fairProb: Math.round(fair * 10) / 10,
          evPercentage: Math.round(ev * 10) / 10,
          score: (fair - 50) + ev * 0.5 + (usesBrain ? 0.5 : 0) + (side === "over" ? OVER_DISPLAY_BOOST : 0),
          label: MARKET_LABEL[prop.market] ?? prop.market,
          usesBrain,
          projectedValue: prop.brainProjectedValue,
          bestAlt: prop.bestAlt ?? null,
        });
      }
    }

    all.sort((a, b) => b.score - a.score);
    const seen = new Set<string>();
    const out: PropPick[] = [];
    for (const p of all) {
      if (seen.has(p.playerName)) continue;
      seen.add(p.playerName);
      out.push(p);
      if (out.length >= 8) break;
    }
    return out;
  }, [propsData]);

  if (loading) {
    return (
      <div className="glass rounded-xl overflow-hidden">
        <div className="px-3 sm:px-4 py-2.5 border-b border-purple/15 bg-purple/5 flex items-center gap-2">
          <Users className="w-4 h-4 text-purple" />
          <h2 className="text-xs sm:text-sm font-bold text-silver uppercase tracking-wider">Today&apos;s Player Props</h2>
        </div>
        <div className="divide-y divide-slate/10">
          {[0, 1, 2].map(i => <div key={i} className="px-4 py-3 h-12 animate-pulse bg-gunmetal/10" />)}
        </div>
      </div>
    );
  }

  if (picks.length === 0) {
    return (
      <div className="glass rounded-xl overflow-hidden border border-purple/15">
        <div className="px-3 sm:px-4 py-2.5 border-b border-purple/15 bg-gradient-to-r from-purple/10 to-transparent flex items-center gap-2">
          <Users className="w-4 h-4 text-purple" />
          <div>
            <h2 className="text-xs sm:text-sm font-bold text-silver uppercase tracking-wider">Today&apos;s Player Props</h2>
            <p className="text-[9px] text-mercury/60 mt-0.5">Waiting for books to post lines</p>
          </div>
        </div>
        <div className="px-4 py-6 text-center">
          <p className="text-xs text-mercury/60">No {sport.toUpperCase()} player prop lines posted yet</p>
          <p className="text-[10px] text-mercury/40 mt-1">Books typically post props 4–8 hours before tip-off. Check back closer to game time.</p>
        </div>
      </div>
    );
  }

  const visible = isPremium ? picks : picks.slice(0, 5);
  const lockedCount = picks.length - visible.length;
  const overCount = picks.filter(p => p.side === "over").length;

  return (
    <div className="glass rounded-xl overflow-hidden border border-purple/15">
      {/* Header */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full px-3 sm:px-4 py-2.5 border-b border-purple/15 bg-gradient-to-r from-purple/10 to-transparent flex items-center gap-2 hover:bg-purple/15 transition-colors text-left"
      >
        <Users className="w-4 h-4 text-purple" />
        <div className="flex-1">
          <h2 className="text-xs sm:text-sm font-bold text-silver uppercase tracking-wider flex items-center gap-1.5">
            Today&apos;s Player Props
            <InfoTip term="EV" />
          </h2>
          <p className="text-[9px] text-mercury/60 mt-0.5">
            {picks.length} picks · {overCount} Over{overCount !== 1 ? "s" : ""} · ranked by edge
          </p>
        </div>
        {sport === "nba" && (
          <Link
            href="/?tab=props"
            onClick={(e) => e.stopPropagation()}
            className="hidden sm:flex items-center gap-0.5 px-2 py-1 rounded bg-purple/10 border border-purple/25 text-purple/90 text-[10px] font-semibold hover:bg-purple/20 transition-colors"
          >
            All props <ChevronRight className="w-3 h-3" />
          </Link>
        )}
        <ChevronDown className={`w-4 h-4 text-mercury/50 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {/* Picks list */}
      {expanded && (
        <div className="divide-y divide-slate/10">
          {visible.map((p) => {
            const isOpen = openPick === p.key;
            return (
              <div key={p.key}>
                <button
                  onClick={() => setOpenPick(isOpen ? null : p.key)}
                  className="w-full px-3 sm:px-4 py-2.5 flex items-center gap-2.5 hover:bg-gunmetal/20 transition-colors text-left"
                >
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    p.side === "over" ? "bg-neon/10 text-neon" : "bg-amber/10 text-amber"
                  }`}>
                    {p.side === "over" ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                  </div>
                  <PlayerAvatar name={p.playerName} playerId={p.playerId} sport={sport} size={28} />
                  <div className="flex-1 min-w-0">
                    {/* Full name — own row, wraps if needed, never truncates */}
                    <p className="text-sm font-semibold text-silver leading-tight break-words">
                      {p.playerName}
                    </p>
                    {/* The actual pick — clear and readable on mobile */}
                    <p className={`text-xs font-bold leading-tight mt-0.5 ${p.side === "over" ? "text-neon" : "text-amber"}`}>
                      {p.side === "over" ? "OVER" : "UNDER"} {p.line} {p.label}
                    </p>
                    {/* Meta + badges — allowed to wrap */}
                    <div className="flex items-center flex-wrap gap-1.5 mt-1">
                      <span className="text-[10px] text-mercury/60">
                        {p.bookmaker} · {p.fairProb}%{p.usesBrain ? " brain" : " fair"}
                        {p.projectedValue != null && p.usesBrain && ` · proj ${p.projectedValue}`}
                      </span>
                      <span className={`text-[10px] font-semibold ${p.evPercentage > 0 ? "text-neon" : "text-mercury/60"}`}>
                        +{p.evPercentage}% edge
                      </span>
                      {p.usesBrain && (
                        <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-purple/15 border border-purple/30 text-purple text-[8px] font-bold">
                          <Brain className="w-2.5 h-2.5" />
                          BRAIN
                        </span>
                      )}
                      {p.fairProb >= 60 && <Flame className="w-3 h-3 text-danger" />}
                      {p.bestAlt && p.bestAlt.edgePct >= 3 && (
                        <span
                          className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-amber/15 border border-amber/30 text-amber text-[8px] font-bold"
                          title={`Alt ${p.bestAlt.side} ${p.bestAlt.line} @ ${p.bestAlt.price > 0 ? "+" : ""}${p.bestAlt.price} (${p.bestAlt.bookmaker})`}
                        >
                          ALT {p.bestAlt.side === "over" ? "O" : "U"}{p.bestAlt.line} +{p.bestAlt.edgePct}%
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs sm:text-sm font-mono font-bold text-silver">
                      {p.odds > 0 ? "+" : ""}{p.odds}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        addParlayLeg({
                          game: p.playerName,
                          market: "player_prop" as any,
                          pick: `${p.playerName} ${p.side === "over" ? "Over" : "Under"} ${p.line} ${p.label}`,
                          odds: p.odds,
                          fairProb: p.fairProb / 100,
                          bookmaker: p.bookmaker ?? "",
                        });
                      }}
                      className="px-2 py-1 rounded bg-neon/10 border border-neon/20 text-neon text-[10px] font-bold hover:bg-neon/20 transition-colors"
                      title="Add to parlay builder"
                    >
                      + Parlay
                    </button>
                    <ChevronDown className={`w-3.5 h-3.5 text-mercury/50 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  </div>
                </button>
                {isOpen && (
                  <PropDetail
                    sport={sport}
                    playerName={p.playerName}
                    market={p.market}
                    line={p.line}
                    side={p.side}
                  />
                )}
              </div>
            );
          })}
          {lockedCount > 0 && !isPremium && (
            <Link
              href="/pricing"
              className="block px-4 py-3 text-center bg-gradient-to-br from-neon/10 to-electric/5 hover:from-neon/20 transition-colors group"
            >
              <p className="text-xs font-bold text-neon">
                +{lockedCount} more prop pick{lockedCount !== 1 ? "s" : ""} locked
              </p>
              <p className="text-[10px] text-mercury/70 mt-0.5">
                Upgrade to Pro · $15/mo · <span className="text-electric group-hover:underline">Start 7-day free trial →</span>
              </p>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
