"use client";

import { useState, useEffect, useCallback } from "react";
import { useStore } from "@/lib/store";
import {
  Trophy, Zap, Layers, TrendingUp, Target, ChevronDown, ChevronUp,
  Star, DollarSign, ArrowUpRight, ArrowDownRight, BarChart3,
  Flame, Brain, Clock, Shield, Swords, Activity, CircleDot,
} from "lucide-react";

// ──────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────

interface Pick {
  id: string;
  game: string;
  pick: string;
  market: string;
  odds: number;
  bookmaker: string;
  evPercentage: number;
  fairProb: number;
  confidence: string;
  kellyStake: number;
  reasoning: string[];
  // Extended analysis
  teamStats?: { home: any; away: any };
  history?: string[];
  aiTip?: string;
}

interface Section {
  key: string;
  title: string;
  subtitle: string;
  icon: any;
  iconColor: string;
  bgColor: string;
  borderColor: string;
  picks: Pick[];
}

// ──────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────

export default function PicksBoard() {
  const { oddsData, scores, addParlayLeg, analyses } = useStore() as any;
  const [expandedPick, setExpandedPick] = useState<string | null>(null);
  const [playerData, setPlayerData] = useState<Record<string, any>>({});
  const [loadingPlayer, setLoadingPlayer] = useState<string | null>(null);

  // Collect ALL EV bets across all games
  const allEV: Pick[] = [];
  for (const game of oddsData) {
    if (game.evBets) {
      for (const bet of game.evBets) {
        allEV.push({
          id: `${game.id}-${bet.pick}-${bet.bookmaker}`,
          game: bet.game || `${game.awayTeam} @ ${game.homeTeam}`,
          pick: bet.pick,
          market: bet.market,
          odds: bet.odds,
          bookmaker: bet.bookmaker,
          evPercentage: bet.evPercentage,
          fairProb: bet.fairProb,
          confidence: bet.confidence,
          kellyStake: bet.kellyStake,
          reasoning: bet.reasoning?.length > 0 ? bet.reasoning : generateReasons(bet, game),
          aiTip: generateAITip(bet, game),
          history: generateHistory(bet, game),
        });
      }
    }
  }

  // Sort by EV
  allEV.sort((a, b) => b.evPercentage - a.evPercentage);

  // ── Build Sections ──

  // Top Locks: highest confidence ML picks
  const topLocks = allEV
    .filter((p) => p.confidence === "HIGH" || p.evPercentage > 5)
    .slice(0, 4);

  // Longshots: underdogs with +EV
  const longshots = allEV
    .filter((p) => p.odds > 120)
    .sort((a, b) => b.evPercentage - a.evPercentage)
    .slice(0, 4);

  // Moneylines
  const moneylines = allEV
    .filter((p) => p.market === "moneyline")
    .slice(0, 6);

  // Team Totals / Over-Unders
  const totals = allEV
    .filter((p) => p.market === "total")
    .slice(0, 6);

  // Parlay of the Day: top 3 highest-confidence uncorrelated picks
  const parlayLegs = allEV
    .filter((p) => p.market === "moneyline" && p.evPercentage > 2)
    .reduce((acc: Pick[], pick) => {
      // Only one pick per game
      if (!acc.find((p) => p.game === pick.game)) acc.push(pick);
      return acc;
    }, [])
    .slice(0, 3);

  const parlayOdds = parlayLegs.reduce((acc, p) => {
    const dec = p.odds > 0 ? (p.odds / 100) + 1 : (100 / Math.abs(p.odds)) + 1;
    return acc * dec;
  }, 1);
  const parlayAmerican = parlayOdds >= 2
    ? Math.round((parlayOdds - 1) * 100)
    : Math.round(-100 / (parlayOdds - 1));

  // Fetch player analysis when expanding a pick
  const fetchPlayerAnalysis = useCallback(async (playerName: string, market: string) => {
    if (playerData[playerName]) return;
    setLoadingPlayer(playerName);
    try {
      const res = await fetch(`/api/player-analysis?name=${encodeURIComponent(playerName)}&market=${market}&line=0`);
      if (res.ok) {
        const data = await res.json();
        setPlayerData((prev) => ({ ...prev, [playerName]: data }));
      }
    } catch {}
    setLoadingPlayer(null);
  }, [playerData]);

  const togglePick = (pickId: string, pick?: Pick) => {
    if (expandedPick === pickId) {
      setExpandedPick(null);
    } else {
      setExpandedPick(pickId);
      // Try to fetch player data if it's a player prop
      if (pick?.pick) {
        const nameParts = pick.pick.replace(/ ML$| Over.*| Under.*/, "").trim();
        if (nameParts && !nameParts.includes("@")) {
          fetchPlayerAnalysis(nameParts, pick.market);
        }
      }
    }
  };

  const formatOdds = (odds: number) => (odds > 0 ? `+${odds}` : `${odds}`);

  const sections: Section[] = [
    {
      key: "locks",
      title: "TOP LOCKS OF THE DAY",
      subtitle: "Highest confidence picks from the model",
      icon: Trophy,
      iconColor: "text-gold",
      bgColor: "bg-gold/5",
      borderColor: "border-gold/20",
      picks: topLocks,
    },
    {
      key: "longshots",
      title: "LONGSHOT VALUE",
      subtitle: "Underdogs with positive expected value",
      icon: Zap,
      iconColor: "text-amber",
      bgColor: "bg-amber/5",
      borderColor: "border-amber/20",
      picks: longshots,
    },
    {
      key: "moneylines",
      title: "MONEYLINES",
      subtitle: "Best ML value across all games",
      icon: Swords,
      iconColor: "text-neon",
      bgColor: "bg-neon/5",
      borderColor: "border-neon/20",
      picks: moneylines,
    },
    {
      key: "totals",
      title: "TEAM TOTALS & OVER/UNDERS",
      subtitle: "Game totals with the best edge",
      icon: BarChart3,
      iconColor: "text-electric",
      bgColor: "bg-electric/5",
      borderColor: "border-electric/20",
      picks: totals,
    },
  ];

  return (
    <div className="space-y-4">
      {/* ═══ PARLAY OF THE DAY ═══ */}
      {parlayLegs.length >= 2 && (
        <div className="glass rounded-xl overflow-hidden border border-purple/20 glow-neon">
          <div className="px-4 py-3 bg-gradient-to-r from-purple/10 to-neon/5 border-b border-purple/15 flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-purple/20 flex items-center justify-center">
              <Layers className="w-4 h-4 text-purple" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-silver uppercase tracking-wider">Parlay of the Day</h2>
              <p className="text-[10px] text-mercury/60">Best correlated value parlay</p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-lg font-bold font-mono text-purple">{formatOdds(parlayAmerican)}</p>
              <p className="text-[10px] text-mercury/50">{parlayLegs.length} legs</p>
            </div>
          </div>
          <div className="p-3 space-y-2">
            {parlayLegs.map((leg, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-gunmetal/30">
                <span className="w-5 h-5 rounded-full bg-purple/20 text-purple text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-silver truncate">{leg.pick}</p>
                  <p className="text-[10px] text-mercury/60 truncate">{leg.game} • {leg.bookmaker}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-mono font-semibold text-silver">{formatOdds(leg.odds)}</p>
                  <p className="text-[10px] text-neon">+{leg.evPercentage.toFixed(1)}% EV</p>
                </div>
              </div>
            ))}
            <button
              onClick={() => {
                for (const leg of parlayLegs) {
                  addParlayLeg({
                    game: leg.game,
                    market: leg.market as any,
                    pick: leg.pick,
                    odds: leg.odds,
                    fairProb: leg.fairProb / 100,
                    bookmaker: leg.bookmaker,
                  });
                }
              }}
              className="w-full py-2.5 rounded-lg bg-purple/15 border border-purple/25 text-purple text-sm font-semibold hover:bg-purple/25 active:scale-[0.98] transition-all"
            >
              Add All to Parlay Builder
            </button>
          </div>
        </div>
      )}

      {/* ═══ SECTIONS ═══ */}
      {sections.map((section) => (
        <div key={section.key} className="glass rounded-xl overflow-hidden">
          <div className={`px-4 py-3 border-b ${section.borderColor} ${section.bgColor} flex items-center gap-2`}>
            <section.icon className={`w-5 h-5 ${section.iconColor}`} />
            <div>
              <h2 className="text-sm font-bold text-silver uppercase tracking-wider">{section.title}</h2>
              <p className="text-[10px] text-mercury/60">{section.subtitle}</p>
            </div>
            {section.picks.length > 0 && (
              <span className="ml-auto px-2 py-0.5 rounded text-[10px] font-bold bg-gunmetal text-mercury">
                {section.picks.length}
              </span>
            )}
          </div>

          {section.picks.length === 0 ? (
            <div className="p-6 text-center">
              <p className="text-sm text-mercury/60">No picks found for this market yet</p>
              <p className="text-[10px] text-mercury/40 mt-1">Check back closer to game time</p>
            </div>
          ) : (
            <div className="divide-y divide-slate/10">
              {section.picks.map((pick) => (
                <PickCard
                  key={pick.id}
                  pick={pick}
                  isExpanded={expandedPick === pick.id}
                  onToggle={() => togglePick(pick.id, pick)}
                  onAddToParlay={() => addParlayLeg({
                    game: pick.game,
                    market: pick.market as any,
                    pick: pick.pick,
                    odds: pick.odds,
                    fairProb: pick.fairProb / 100,
                    bookmaker: pick.bookmaker,
                  })}
                  playerData={playerData}
                  loadingPlayer={loadingPlayer}
                  formatOdds={formatOdds}
                />
              ))}
            </div>
          )}
        </div>
      ))}

      {/* ═══ STRIKEOUTS SECTION ═══ */}
      <PropMarketSection
        title="STRIKEOUTS"
        subtitle="Pitcher K props with the best edge"
        icon={Flame}
        iconColor="text-danger"
        market="pitcher_strikeouts"
        expandedPick={expandedPick}
        onToggle={(id, pick) => togglePick(id, pick)}
        playerData={playerData}
        loadingPlayer={loadingPlayer}
        addParlayLeg={addParlayLeg}
      />

      {/* ═══ HITS SECTION ═══ */}
      <PropMarketSection
        title="HITS"
        subtitle="Batter hit props across all books"
        icon={CircleDot}
        iconColor="text-neon"
        market="batter_hits"
        expandedPick={expandedPick}
        onToggle={(id, pick) => togglePick(id, pick)}
        playerData={playerData}
        loadingPlayer={loadingPlayer}
        addParlayLeg={addParlayLeg}
      />

      {/* ═══ HOME RUNS SECTION ═══ */}
      <PropMarketSection
        title="HOME RUNS"
        subtitle="HR props — high risk, high reward"
        icon={Star}
        iconColor="text-gold"
        market="batter_home_runs"
        expandedPick={expandedPick}
        onToggle={(id, pick) => togglePick(id, pick)}
        playerData={playerData}
        loadingPlayer={loadingPlayer}
        addParlayLeg={addParlayLeg}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// PickCard: Individual expandable pick
// ──────────────────────────────────────────────────────────

function PickCard({
  pick, isExpanded, onToggle, onAddToParlay, playerData, loadingPlayer, formatOdds,
}: {
  pick: Pick;
  isExpanded: boolean;
  onToggle: () => void;
  onAddToParlay: () => void;
  playerData: Record<string, any>;
  loadingPlayer: string | null;
  formatOdds: (n: number) => string;
}) {
  const confColors: Record<string, string> = {
    HIGH: "text-neon bg-neon/10",
    MEDIUM: "text-electric bg-electric/10",
    LOW: "text-amber bg-amber/10",
    NO_EDGE: "text-mercury bg-mercury/10",
  };

  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full px-3 sm:px-4 py-3 flex items-center gap-2 sm:gap-3 hover:bg-gunmetal/20 active:bg-gunmetal/30 transition-colors text-left"
      >
        {/* Confidence dot */}
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
          pick.confidence === "HIGH" ? "bg-neon" : pick.confidence === "MEDIUM" ? "bg-electric" : "bg-mercury/50"
        }`} />

        {/* Pick info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-silver truncate">{pick.pick}</p>
          <p className="text-[10px] text-mercury/60 truncate">{pick.game} • {pick.bookmaker}</p>
        </div>

        {/* Odds + EV */}
        <div className="text-right flex-shrink-0">
          <p className="text-sm font-mono font-bold text-silver">{formatOdds(pick.odds)}</p>
          <p className="text-[10px] font-mono text-neon font-semibold">+{pick.evPercentage.toFixed(1)}% EV</p>
        </div>

        {/* Confidence badge */}
        <span className={`hidden sm:inline text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${confColors[pick.confidence] ?? confColors.LOW}`}>
          {pick.confidence}
        </span>

        <ChevronDown className={`w-4 h-4 text-mercury/40 flex-shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
      </button>

      {/* Expanded Analysis */}
      {isExpanded && (
        <div className="px-3 sm:px-4 pb-4 animate-slide-up">
          <div className="space-y-3">
            {/* AI Tip */}
            {pick.aiTip && (
              <div className="flex gap-2 p-3 rounded-lg bg-electric/5 border border-electric/15">
                <Brain className="w-4 h-4 text-electric flex-shrink-0 mt-0.5" />
                <p className="text-xs text-silver leading-relaxed">{pick.aiTip}</p>
              </div>
            )}

            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-2">
              <div className="text-center p-2 rounded-lg bg-gunmetal/40">
                <p className="text-lg font-bold font-mono text-silver">{(pick.fairProb).toFixed(0)}%</p>
                <p className="text-[9px] text-mercury uppercase">Fair Prob</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-gunmetal/40">
                <p className="text-lg font-bold font-mono text-neon">+{pick.evPercentage.toFixed(1)}%</p>
                <p className="text-[9px] text-mercury uppercase">EV Edge</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-gunmetal/40">
                <p className="text-lg font-bold font-mono text-gold">${pick.kellyStake.toFixed(0)}</p>
                <p className="text-[9px] text-mercury uppercase">Kelly Bet</p>
              </div>
            </div>

            {/* Reasoning */}
            <div className="rounded-lg bg-gunmetal/20 p-3">
              <p className="text-[10px] text-mercury uppercase tracking-wider mb-2 font-semibold flex items-center gap-1.5">
                <Target className="w-3 h-3" /> Why This Pick
              </p>
              <div className="space-y-1.5">
                {pick.reasoning.map((reason, ri) => (
                  <div key={ri} className="flex items-start gap-1.5">
                    <span className="text-neon text-[10px] mt-0.5">{'>'}</span>
                    <p className="text-xs text-mercury">{reason}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* History */}
            {pick.history && pick.history.length > 0 && (
              <div className="rounded-lg bg-gunmetal/20 p-3">
                <p className="text-[10px] text-mercury uppercase tracking-wider mb-2 font-semibold flex items-center gap-1.5">
                  <Clock className="w-3 h-3" /> Recent History
                </p>
                <div className="space-y-1">
                  {pick.history.map((h, hi) => (
                    <p key={hi} className="text-xs text-mercury/80">{h}</p>
                  ))}
                </div>
              </div>
            )}

            {/* Add to parlay */}
            <button
              onClick={(e) => { e.stopPropagation(); onAddToParlay(); }}
              className="w-full py-2.5 rounded-lg bg-neon/10 border border-neon/20 text-neon text-sm font-semibold hover:bg-neon/20 active:scale-[0.98] transition-all"
            >
              + Add to Parlay
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// PropMarketSection: Fetches and displays player prop picks
// ──────────────────────────────────────────────────────────

function PropMarketSection({
  title, subtitle, icon: Icon, iconColor, market,
  expandedPick, onToggle, playerData, loadingPlayer, addParlayLeg,
}: {
  title: string;
  subtitle: string;
  icon: any;
  iconColor: string;
  market: string;
  expandedPick: string | null;
  onToggle: (id: string, pick?: Pick) => void;
  playerData: Record<string, any>;
  loadingPlayer: string | null;
  addParlayLeg: any;
}) {
  const [props, setProps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/players?market=${market}`)
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setProps(data.props ?? []); })
      .catch(() => { if (!cancelled) setProps([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [market]);

  const formatOdds = (odds: number) => (odds > 0 ? `+${odds}` : `${odds}`);

  return (
    <div className="glass rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate/30 flex items-center gap-2">
        <Icon className={`w-5 h-5 ${iconColor}`} />
        <div>
          <h2 className="text-sm font-bold text-silver uppercase tracking-wider">{title}</h2>
          <p className="text-[10px] text-mercury/60">{subtitle}</p>
        </div>
        {props.length > 0 && (
          <span className="ml-auto px-2 py-0.5 rounded text-[10px] font-bold bg-gunmetal text-mercury">
            {props.length}
          </span>
        )}
      </div>

      {loading ? (
        <div className="p-6 text-center">
          <Activity className="w-5 h-5 text-mercury/30 animate-spin mx-auto mb-1" />
          <p className="text-xs text-mercury/50">Loading {title.toLowerCase()}...</p>
        </div>
      ) : props.length === 0 ? (
        <div className="p-6 text-center">
          <p className="text-sm text-mercury/60">No {title.toLowerCase()} props posted yet</p>
          <p className="text-[10px] text-mercury/40 mt-1">Books typically post these closer to game time</p>
        </div>
      ) : (
        <div className="divide-y divide-slate/10">
          {props.slice(0, 6).map((prop: any, i: number) => {
            const pickId = `${market}-${prop.playerName}-${i}`;
            const isExpanded = expandedPick === pickId;

            return (
              <div key={i}>
                <button
                  onClick={() => onToggle(pickId, {
                    id: pickId,
                    game: prop.team || prop.playerName,
                    pick: `${prop.playerName} ${market.includes("over") ? "Over" : ""} ${prop.line}`,
                    market,
                    odds: prop.bestOver?.price ?? -110,
                    bookmaker: prop.bestOver?.bookmaker ?? "Best",
                    evPercentage: 0,
                    fairProb: prop.fairOverProb ?? 50,
                    confidence: "MEDIUM",
                    kellyStake: 0,
                    reasoning: [],
                  } as Pick)}
                  className="w-full px-3 sm:px-4 py-3 flex items-center gap-3 hover:bg-gunmetal/20 active:bg-gunmetal/30 transition-colors text-left"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-silver truncate">{prop.playerName}</p>
                    <p className="text-[10px] text-mercury/60 truncate">{prop.team}</p>
                  </div>
                  <span className="text-base font-bold font-mono text-electric flex-shrink-0">{prop.line}</span>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <span className="text-[11px] font-mono text-neon bg-neon/10 px-1.5 py-0.5 rounded">
                      O {formatOdds(prop.bestOver?.price ?? 0)}
                    </span>
                    <span className="text-[11px] font-mono text-purple bg-purple/10 px-1.5 py-0.5 rounded">
                      U {formatOdds(prop.bestUnder?.price ?? 0)}
                    </span>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-mercury/40 flex-shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                </button>

                {isExpanded && (
                  <div className="px-3 sm:px-4 pb-4 animate-slide-up space-y-3">
                    {/* All books */}
                    <div className="rounded-lg bg-gunmetal/30 p-3">
                      <p className="text-[10px] text-mercury uppercase tracking-wider mb-2 font-semibold">Odds by Book</p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                        {(prop.books ?? []).map((book: any, bi: number) => (
                          <div key={bi} className="flex items-center justify-between px-2 py-1.5 rounded bg-bunker/50 border border-slate/15">
                            <span className="text-[10px] text-mercury truncate mr-1">{book.bookmaker?.split(" ").pop()?.slice(0, 5)}</span>
                            <div className="flex gap-1.5 flex-shrink-0">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  addParlayLeg({
                                    game: prop.playerName, market: "player_prop",
                                    pick: `${prop.playerName} Over ${prop.line}`,
                                    odds: book.overPrice, fairProb: (prop.fairOverProb ?? 50) / 100,
                                    bookmaker: book.bookmaker,
                                  });
                                }}
                                className="text-[10px] font-mono text-neon/80 hover:text-neon"
                              >
                                O{formatOdds(book.overPrice)}
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  addParlayLeg({
                                    game: prop.playerName, market: "player_prop",
                                    pick: `${prop.playerName} Under ${prop.line}`,
                                    odds: book.underPrice, fairProb: (prop.fairUnderProb ?? 50) / 100,
                                    bookmaker: book.bookmaker,
                                  });
                                }}
                                className="text-[10px] font-mono text-purple/80 hover:text-purple"
                              >
                                U{formatOdds(book.underPrice)}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Fair prob bar */}
                    <div className="flex items-center gap-3 px-1">
                      <span className="text-[10px] text-neon">Over {prop.fairOverProb}%</span>
                      <div className="flex-1 h-2 bg-gunmetal rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-neon to-electric rounded-full" style={{ width: `${prop.fairOverProb}%` }} />
                      </div>
                      <span className="text-[10px] text-purple">{prop.fairUnderProb}% Under</span>
                    </div>

                    {/* Quick add buttons */}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          addParlayLeg({
                            game: prop.playerName, market: "player_prop",
                            pick: `${prop.playerName} Over ${prop.line}`,
                            odds: prop.bestOver?.price ?? -110, fairProb: (prop.fairOverProb ?? 50) / 100,
                            bookmaker: prop.bestOver?.bookmaker ?? "Best",
                          });
                        }}
                        className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-neon/10 border border-neon/20 text-neon text-xs font-semibold hover:bg-neon/20 transition-all"
                      >
                        <ArrowUpRight className="w-3.5 h-3.5" /> Over {prop.line}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          addParlayLeg({
                            game: prop.playerName, market: "player_prop",
                            pick: `${prop.playerName} Under ${prop.line}`,
                            odds: prop.bestUnder?.price ?? -110, fairProb: (prop.fairUnderProb ?? 50) / 100,
                            bookmaker: prop.bestUnder?.bookmaker ?? "Best",
                          });
                        }}
                        className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-purple/10 border border-purple/20 text-purple text-xs font-semibold hover:bg-purple/20 transition-all"
                      >
                        <ArrowDownRight className="w-3.5 h-3.5" /> Under {prop.line}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Helper functions for generating analysis
// ──────────────────────────────────────────────────────────

function generateReasons(bet: any, game: any): string[] {
  const reasons: string[] = [];
  if (bet.evPercentage > 8) reasons.push(`Strong ${bet.evPercentage.toFixed(1)}% edge — well above the 3% threshold`);
  else if (bet.evPercentage > 4) reasons.push(`Solid ${bet.evPercentage.toFixed(1)}% edge over market consensus`);
  else reasons.push(`${bet.evPercentage.toFixed(1)}% edge — marginal but positive`);

  reasons.push(`Best price at ${bet.bookmaker} (${bet.odds > 0 ? "+" : ""}${bet.odds})`);

  if (bet.market === "moneyline") {
    const impliedProb = bet.odds > 0 ? 100 / (bet.odds + 100) : Math.abs(bet.odds) / (Math.abs(bet.odds) + 100);
    const fairProb = bet.fairProb / 100;
    if (fairProb > impliedProb + 0.05) {
      reasons.push(`Model gives ${(fairProb * 100).toFixed(0)}% win probability vs ${(impliedProb * 100).toFixed(0)}% implied — significant mismatch`);
    }
  }

  if (bet.market === "total") {
    reasons.push("Total based on de-vigged market consensus across all books");
  }

  reasons.push(`Quarter-Kelly suggests $${bet.kellyStake.toFixed(0)} stake on a $1000 bankroll`);
  return reasons;
}

function generateAITip(bet: any, game: any): string {
  if (bet.evPercentage > 8) {
    return `This is a premium edge. The market is significantly mispriced at ${bet.bookmaker}. The model's fair value is well above what the odds imply. Consider this a strong play with proper bankroll management.`;
  }
  if (bet.evPercentage > 4) {
    return `Good value here. The line at ${bet.bookmaker} is softer than the market average. This is the kind of consistent +EV play that builds bankroll over time. Don't oversize — quarter-Kelly keeps you safe.`;
  }
  if (bet.odds > 150) {
    return `Longshot value play. The odds look juicy but the model sees more upside than the market gives credit for. Small stake, big potential return. This is a "sprinkle" bet — don't chase it.`;
  }
  return `Marginal edge detected. The market is close to fair but ${bet.bookmaker} is slightly off. Only play this if you're looking to maximize volume of +EV bets.`;
}

function generateHistory(bet: any, game: any): string[] {
  const history: string[] = [];
  if (bet.market === "moneyline") {
    history.push("Model factors in: team pitching, hitting, bullpen, defense, recent form");
    history.push("Weights shift dynamically based on game state and inning");
    history.push("Late-game bullpen matchups weighted heavily in close games");
  }
  if (bet.market === "total") {
    history.push("Total analysis considers: starting pitcher matchup, park factors");
    history.push("Wind direction and temperature impact factored into projection");
    history.push("Umpire run-scoring index used as adjustment factor");
  }
  return history;
}
