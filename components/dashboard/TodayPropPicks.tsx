"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Users, ArrowUpRight, ArrowDownRight, Flame, ChevronRight, ChevronDown } from "lucide-react";
import { americanToDecimal } from "@/lib/model/kelly";
import { useStore } from "@/lib/store";
import { usePremium } from "@/lib/hooks/usePremium";
import InfoTip from "@/components/ui/InfoTip";
import PlayerAvatar from "@/components/ui/PlayerAvatar";
import PropDetail from "@/components/dashboard/PropDetail";

interface RawProp {
  playerName: string;
  team?: string;
  line: number;
  market: string;
  gameTime?: string;
  bestOver?: { price: number; bookmaker: string };
  bestUnder?: { price: number; bookmaker: string };
  fairOverProb: number;  // 0-100
  fairUnderProb: number; // 0-100
}

interface PropPick {
  key: string;
  playerName: string;
  team?: string;
  side: "over" | "under";
  line: number;
  market: string;
  odds: number;
  bookmaker: string;
  fairProb: number;      // 0-100
  evPercentage: number;  // edge over implied
  score: number;
  label: string;         // "Points", "Hits", etc.
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

function americanImplied(odds: number): number {
  if (!odds) return 0.5;
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

function scoreProp(side: "over" | "under", prop: RawProp): PropPick | null {
  const best = side === "over" ? prop.bestOver : prop.bestUnder;
  if (!best?.price) return null;
  const fair = (side === "over" ? prop.fairOverProb : prop.fairUnderProb) ?? 0;
  if (fair < 52) return null; // skip coinflips

  const implied = americanImplied(best.price) * 100;
  const ev = fair - implied; // edge vs market
  if (ev < 0.5) return null;  // must have meaningful edge

  const boost = side === "over" ? OVER_DISPLAY_BOOST : 0;
  const score = (fair - 50) + ev * 0.5 + boost;

  return {
    key: `${prop.market}-${prop.playerName}-${side}`,
    playerName: prop.playerName,
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
        if (!prop.playerName || !prop.line) continue;

        // Decide preferred side with Over-bias tiebreak
        const over = prop.fairOverProb ?? 0;
        const under = prop.fairUnderProb ?? 0;
        let preferredSide: "over" | "under";
        if (over >= under - OVER_BIAS_TIE_BREAK) preferredSide = "over";
        else preferredSide = "under";

        const primary = scoreProp(preferredSide, prop);
        if (primary) all.push(primary);
      }
    }
    // Rank and dedupe by player (one pick per player across markets)
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

  if (picks.length === 0) return null;

  const visible = isPremium ? picks : picks.slice(0, 3);
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
                  <PlayerAvatar name={p.playerName} size={24} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs sm:text-sm font-semibold text-silver truncate">
                        {p.playerName} {p.side === "over" ? "Over" : "Under"} {p.line}
                      </p>
                      <span className="text-[9px] font-bold uppercase text-mercury/50 tracking-wider">{p.label}</span>
                      {p.fairProb >= 60 && (
                        <Flame className="w-3 h-3 text-danger" />
                      )}
                    </div>
                    <p className="text-[10px] text-mercury/60 truncate">
                      {p.bookmaker} · {p.fairProb}% fair · <span className={p.evPercentage > 0 ? "text-neon" : "text-mercury/60"}>+{p.evPercentage}% edge</span>
                    </p>
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
