"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useStore } from "@/lib/store";
import {
  Trophy, Zap, Layers, TrendingUp, Target, ChevronDown,
  Star, DollarSign, ArrowUpRight, ArrowDownRight, BarChart3,
  Flame, Brain, Clock, Swords, Activity, CircleDot, ArrowUp, ArrowDown, Shield,
  AlertTriangle, ExternalLink,
} from "lucide-react";
import { getDeepLink } from "@/lib/odds/sportsbooks";

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
  aiTip?: string;
  history?: string[];
  commenceTime?: string;
  isSuspicious?: boolean;
  warning?: string;
  edgeAge?: number; // seconds since first spotted
}

export default function PicksBoard() {
  const { oddsData, scores, addParlayLeg } = useStore();
  const [expandedPick, setExpandedPick] = useState<string | null>(null);
  const [propsData, setPropsData] = useState<Record<string, any[]>>({});
  const [propsLoading, setPropsLoading] = useState(true);

  // Batch-fetch all prop markets in one go on mount
  useEffect(() => {
    let cancelled = false;
    setPropsLoading(true);
    Promise.all([
      fetch("/api/players?market=pitcher_strikeouts").then(r => r.json()).catch(() => ({ props: [] })),
      fetch("/api/players?market=batter_hits").then(r => r.json()).catch(() => ({ props: [] })),
      fetch("/api/players?market=batter_home_runs").then(r => r.json()).catch(() => ({ props: [] })),
      fetch("/api/players?market=batter_total_bases").then(r => r.json()).catch(() => ({ props: [] })),
      fetch("/api/players?market=pitcher_outs").then(r => r.json()).catch(() => ({ props: [] })),
    ]).then(([ks, hits, hrs, tb, outs]) => {
      if (!cancelled) {
        setPropsData({
          pitcher_strikeouts: ks.props ?? [],
          batter_hits: hits.props ?? [],
          batter_home_runs: hrs.props ?? [],
          batter_total_bases: tb.props ?? [],
          pitcher_outs: outs.props ?? [],
        });
        setPropsLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  // Get set of finished game names to exclude
  const finishedGames = useMemo(() => {
    const finished = new Set<string>();
    for (const s of scores) {
      if (s.status === "final") {
        finished.add(s.homeTeam);
        finished.add(s.awayTeam);
        finished.add(s.homeAbbrev);
        finished.add(s.awayAbbrev);
      }
    }
    return finished;
  }, [scores]);

  const isGameFinished = useCallback((gameName: string) => {
    if (!gameName) return false;
    for (const name of finishedGames) {
      if (gameName.toLowerCase().includes(name.toLowerCase())) return true;
    }
    return false;
  }, [finishedGames]);

  // Collect ALL +EV bets, filter out finished games
  const allEV: Pick[] = useMemo(() => {
    const picks: Pick[] = [];
    for (const game of oddsData) {
      const gameName = game.awayTeam && game.homeTeam
        ? `${game.awayTeam} @ ${game.homeTeam}`
        : "";
      if (isGameFinished(gameName)) continue;

      // Skip games with only 1 bookmaker (not enough data for real EV)
      if ((game.oddsLines?.length ?? 0) < 2) continue;

      if (game.evBets) {
        for (const bet of game.evBets) {
          picks.push({
            id: `${game.id}-${bet.pick}-${bet.bookmaker}`,
            game: bet.game || gameName,
            pick: bet.pick,
            market: bet.market,
            odds: bet.odds,
            bookmaker: bet.bookmaker,
            evPercentage: bet.evPercentage,
            fairProb: bet.fairProb,
            confidence: bet.confidence,
            kellyStake: bet.kellyStake,
            reasoning: generateReasons(bet),
            aiTip: generateAITip(bet),
            history: generateHistory(bet),
            commenceTime: game.commenceTime,
            isSuspicious: bet.isSuspicious ?? false,
            warning: bet.warning,
            edgeAge: bet.edgeAge ?? 0,
          });
        }
      }
    }
    return picks.sort((a, b) => b.evPercentage - a.evPercentage);
  }, [oddsData, isGameFinished]);

  // Deduplication: track used game+pick combos so sections don't repeat
  const usedIds = new Set<string>();
  function takeUnique(pool: Pick[], count: number, extraFilter?: (p: Pick) => boolean): Pick[] {
    const result: Pick[] = [];
    for (const p of pool) {
      const key = `${p.game}::${p.pick}`;
      if (usedIds.has(key)) continue;
      if (extraFilter && !extraFilter(p)) continue;
      usedIds.add(key);
      result.push(p);
      if (result.length >= count) break;
    }
    return result;
  }

  // Build sections with unique picks — each pick only appears ONCE across all sections
  const topLocks = takeUnique(allEV, 4, (p) => p.confidence === "HIGH" || p.evPercentage > 5);
  const longshots = takeUnique(allEV, 4, (p) => p.odds > 120);
  const moneylines = takeUnique(allEV, 5, (p) => p.market === "moneyline");
  const runLines = takeUnique(allEV, 5, (p) => p.market === "spread");
  const overs = takeUnique(allEV, 5, (p) => p.market === "total" && p.pick.toLowerCase().includes("over"));
  const unders = takeUnique(allEV, 5, (p) => p.market === "total" && p.pick.toLowerCase().includes("under"));

  // Parlay of the day: best uncorrelated ML picks (different games)
  const parlayPool = allEV.filter((p) => p.market === "moneyline" && p.evPercentage > 1 && !isGameFinished(p.game));
  const parlayLegs: Pick[] = [];
  const parlayGames = new Set<string>();
  for (const p of parlayPool) {
    if (parlayGames.has(p.game)) continue;
    parlayGames.add(p.game);
    parlayLegs.push(p);
    if (parlayLegs.length >= 3) break;
  }

  const parlayOdds = parlayLegs.reduce((acc, p) => {
    const dec = p.odds > 0 ? (p.odds / 100) + 1 : (100 / Math.abs(p.odds)) + 1;
    return acc * dec;
  }, 1);
  const parlayAmerican = parlayOdds >= 2 ? Math.round((parlayOdds - 1) * 100) : Math.round(-100 / (parlayOdds - 1));

  const formatOdds = (odds: number) => (odds > 0 ? `+${odds}` : `${odds}`);

  const sections = [
    { key: "locks", title: "TOP LOCKS", subtitle: "Highest confidence — model's best plays", icon: Trophy, iconColor: "text-gold", bg: "bg-gold/5", border: "border-gold/20", picks: topLocks },
    { key: "longshots", title: "LONGSHOT VALUE", subtitle: "Underdogs with +EV edge", icon: Zap, iconColor: "text-amber", bg: "bg-amber/5", border: "border-amber/20", picks: longshots },
    { key: "ml", title: "MONEYLINES", subtitle: "Best ML value today", icon: Swords, iconColor: "text-neon", bg: "bg-neon/5", border: "border-neon/20", picks: moneylines },
    { key: "rl", title: "RUN LINES", subtitle: "Spread picks with value", icon: Shield, iconColor: "text-purple", bg: "bg-purple/5", border: "border-purple/20", picks: runLines },
    { key: "overs", title: "OVERS", subtitle: "Game totals leaning over", icon: ArrowUp, iconColor: "text-neon", bg: "bg-neon/5", border: "border-neon/15", picks: overs },
    { key: "unders", title: "UNDERS", subtitle: "Game totals leaning under", icon: ArrowDown, iconColor: "text-electric", bg: "bg-electric/5", border: "border-electric/15", picks: unders },
  ];

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* ═══ PARLAY OF THE DAY ═══ */}
      {parlayLegs.length >= 2 && (
        <div className="glass rounded-xl overflow-hidden border border-purple/20">
          <div className="px-3 sm:px-4 py-2.5 bg-gradient-to-r from-purple/10 to-neon/5 border-b border-purple/15 flex items-center gap-2">
            <Layers className="w-4 h-4 text-purple" />
            <div className="flex-1">
              <h2 className="text-xs sm:text-sm font-bold text-silver uppercase tracking-wider">Parlay of the Day</h2>
            </div>
            <span className="text-base sm:text-lg font-bold font-mono text-purple">{formatOdds(parlayAmerican)}</span>
          </div>
          <div className="p-2.5 sm:p-3 space-y-1.5">
            {parlayLegs.map((leg, i) => (
              <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-gunmetal/30 text-left">
                <span className="w-4 h-4 rounded-full bg-purple/20 text-purple text-[9px] font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs sm:text-sm font-medium text-silver truncate">{leg.pick}</p>
                  <p className="text-[9px] text-mercury/60 truncate">{leg.game} • {leg.bookmaker}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs font-mono font-semibold text-silver">{formatOdds(leg.odds)}</p>
                  <p className="text-[9px] text-neon">+{leg.evPercentage.toFixed(1)}%</p>
                </div>
              </div>
            ))}
            <button
              onClick={() => parlayLegs.forEach((leg) => addParlayLeg({
                game: leg.game, market: leg.market as any, pick: leg.pick,
                odds: leg.odds, fairProb: leg.fairProb / 100, bookmaker: leg.bookmaker,
              }))}
              className="w-full py-2 rounded-lg bg-purple/15 border border-purple/25 text-purple text-xs font-semibold hover:bg-purple/25 active:scale-[0.98] transition-all"
            >
              Add All to Parlay Builder
            </button>
          </div>
        </div>
      )}

      {/* ═══ MARKET SECTIONS ═══ */}
      {sections.map((sec) => (
        <div key={sec.key} className="glass rounded-xl overflow-hidden">
          <div className={`px-3 sm:px-4 py-2.5 border-b ${sec.border} ${sec.bg} flex items-center gap-2`}>
            <sec.icon className={`w-4 h-4 ${sec.iconColor}`} />
            <div className="flex-1">
              <h2 className="text-xs sm:text-sm font-bold text-silver uppercase tracking-wider">{sec.title}</h2>
              <p className="text-[9px] text-mercury/60">{sec.subtitle}</p>
            </div>
            {sec.picks.length > 0 && (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-gunmetal text-mercury">{sec.picks.length}</span>
            )}
          </div>
          {sec.picks.length === 0 ? (
            <div className="px-4 py-5 text-center">
              <p className="text-xs text-mercury/50">No picks for this market right now</p>
            </div>
          ) : (
            <div className="divide-y divide-slate/10">
              {sec.picks.map((pick) => (
                <PickCard
                  key={pick.id}
                  pick={pick}
                  isExpanded={expandedPick === pick.id}
                  onToggle={() => setExpandedPick(expandedPick === pick.id ? null : pick.id)}
                  onAddToParlay={() => addParlayLeg({
                    game: pick.game, market: pick.market as any, pick: pick.pick,
                    odds: pick.odds, fairProb: pick.fairProb / 100, bookmaker: pick.bookmaker,
                  })}
                  formatOdds={formatOdds}
                />
              ))}
            </div>
          )}
        </div>
      ))}

      {/* ═══ PROP SECTIONS ═══ */}
      <PropSection title="STRIKEOUTS" subtitle="Pitcher K props — correlated: high K games often go Under on total" icon={Flame} iconColor="text-danger" props={propsData.pitcher_strikeouts ?? []} loading={propsLoading} expandedPick={expandedPick} setExpanded={setExpandedPick} addParlayLeg={addParlayLeg} />
      <PropSection title="HITS" subtitle="Batter hits — correlated: pitcher Over K = opposing hitters Under hits" icon={CircleDot} iconColor="text-neon" props={propsData.batter_hits ?? []} loading={propsLoading} expandedPick={expandedPick} setExpanded={setExpandedPick} addParlayLeg={addParlayLeg} />
      <PropSection title="HOME RUNS" subtitle="HR props — high risk, high reward" icon={Star} iconColor="text-gold" props={propsData.batter_home_runs ?? []} loading={propsLoading} expandedPick={expandedPick} setExpanded={setExpandedPick} addParlayLeg={addParlayLeg} />
      <PropSection title="TOTAL BASES" subtitle="TB props — correlated with team runs and game total Over" icon={TrendingUp} iconColor="text-electric" props={propsData.batter_total_bases ?? []} loading={propsLoading} expandedPick={expandedPick} setExpanded={setExpandedPick} addParlayLeg={addParlayLeg} />
      <PropSection title="PITCHER OUTS" subtitle="Outs recorded — correlated with low-scoring games" icon={Target} iconColor="text-purple" props={propsData.pitcher_outs ?? []} loading={propsLoading} expandedPick={expandedPick} setExpanded={setExpandedPick} addParlayLeg={addParlayLeg} />

      {/* No data state */}
      {allEV.length === 0 && (
        <div className="glass rounded-xl p-8 text-center">
          <Activity className="w-8 h-8 text-mercury/20 mx-auto mb-3" />
          <p className="text-sm text-mercury">Waiting for odds data...</p>
          <p className="text-xs text-mercury/50 mt-1">Make sure your Odds API key has remaining quota. MLB games with 2+ books are required for analysis.</p>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
function PickCard({ pick, isExpanded, onToggle, onAddToParlay, formatOdds }: {
  pick: Pick; isExpanded: boolean; onToggle: () => void; onAddToParlay: () => void; formatOdds: (n: number) => string;
}) {
  const confDot: Record<string, string> = { HIGH: "bg-neon", MEDIUM: "bg-electric", LOW: "bg-amber", NO_EDGE: "bg-mercury/40" };

  return (
    <div>
      <button onClick={onToggle} className="w-full px-3 sm:px-4 py-2.5 flex items-center gap-2 hover:bg-gunmetal/20 active:bg-gunmetal/30 transition-colors text-left">
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${confDot[pick.confidence] ?? confDot.LOW}`} />
        <div className="flex-1 min-w-0">
          <p className="text-xs sm:text-sm font-medium text-silver truncate">{pick.pick}</p>
          <p className="text-[9px] sm:text-[10px] text-mercury/60 truncate">{pick.game} • {pick.bookmaker}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-xs sm:text-sm font-mono font-bold text-silver">{formatOdds(pick.odds)}</p>
          <p className="text-[9px] sm:text-[10px] font-mono text-neon font-semibold">+{pick.evPercentage.toFixed(1)}%</p>
        </div>
        {/* Edge age / freshness */}
        {pick.edgeAge !== undefined && pick.edgeAge > 0 && (
          <span className={`hidden sm:inline text-[8px] font-mono px-1 py-0.5 rounded flex-shrink-0 ${
            pick.edgeAge < 120 ? "bg-neon/10 text-neon" : pick.edgeAge < 600 ? "bg-amber/10 text-amber" : "bg-danger/10 text-danger"
          }`} title="Time since this edge was first detected">
            {pick.edgeAge < 60 ? `${pick.edgeAge}s` : `${Math.floor(pick.edgeAge / 60)}m`}
          </span>
        )}
        <ChevronDown className={`w-3.5 h-3.5 text-mercury/40 flex-shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
      </button>

      {isExpanded && (
        <div className="px-3 sm:px-4 pb-3 animate-slide-up space-y-2.5">
          {pick.aiTip && (
            <div className="flex gap-2 p-2.5 rounded-lg bg-electric/5 border border-electric/15">
              <Brain className="w-3.5 h-3.5 text-electric flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-silver leading-relaxed">{pick.aiTip}</p>
            </div>
          )}
          <div className="grid grid-cols-3 gap-1.5">
            <div className="text-center p-1.5 rounded bg-gunmetal/40">
              <p className="text-sm font-bold font-mono text-silver">{pick.fairProb.toFixed(0)}%</p>
              <p className="text-[8px] text-mercury uppercase">Fair Prob</p>
            </div>
            <div className="text-center p-1.5 rounded bg-gunmetal/40">
              <p className="text-sm font-bold font-mono text-neon">+{pick.evPercentage.toFixed(1)}%</p>
              <p className="text-[8px] text-mercury uppercase">EV Edge</p>
            </div>
            <div className="text-center p-1.5 rounded bg-gunmetal/40">
              <p className="text-sm font-bold font-mono text-gold">${pick.kellyStake.toFixed(0)}</p>
              <p className="text-[8px] text-mercury uppercase">Kelly</p>
            </div>
          </div>
          <div className="rounded bg-gunmetal/20 p-2.5">
            <p className="text-[9px] text-mercury uppercase tracking-wider mb-1.5 font-semibold flex items-center gap-1"><Target className="w-3 h-3" /> Why This Pick</p>
            {pick.reasoning.map((r, i) => (
              <p key={i} className="text-[11px] text-mercury flex gap-1 mb-0.5"><span className="text-neon">{'>'}</span> {r}</p>
            ))}
          </div>
          {pick.history && pick.history.length > 0 && (
            <div className="rounded bg-gunmetal/20 p-2.5">
              <p className="text-[9px] text-mercury uppercase tracking-wider mb-1.5 font-semibold flex items-center gap-1"><Clock className="w-3 h-3" /> Context</p>
              {pick.history.map((h, i) => <p key={i} className="text-[11px] text-mercury/70 mb-0.5">{h}</p>)}
            </div>
          )}
          {/* Suspicious edge warning */}
          {pick.isSuspicious && (
            <div className="flex items-start gap-2 p-2 rounded-lg bg-amber/5 border border-amber/20">
              <AlertTriangle className="w-3.5 h-3.5 text-amber flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber/90">{pick.warning || "Large edge — verify this line is still live before betting"}</p>
            </div>
          )}

          {/* Deep link + Add to Parlay */}
          <div className="flex gap-2">
            {getDeepLink(pick.bookmaker) && (
              <a
                href={getDeepLink(pick.bookmaker)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 py-2 rounded-lg bg-electric/10 border border-electric/20 text-electric text-xs font-semibold hover:bg-electric/20 transition-all flex items-center justify-center gap-1"
              >
                <ExternalLink className="w-3 h-3" /> Open {pick.bookmaker.split(" ")[0]}
              </a>
            )}
            <button onClick={(e) => { e.stopPropagation(); onAddToParlay(); }} className={`${getDeepLink(pick.bookmaker) ? "flex-1" : "w-full"} py-2 rounded-lg bg-neon/10 border border-neon/20 text-neon text-xs font-semibold hover:bg-neon/20 active:scale-[0.98] transition-all`}>
              + Add to Parlay
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
function PropSection({ title, subtitle, icon: Icon, iconColor, props, loading, expandedPick, setExpanded, addParlayLeg }: {
  title: string; subtitle: string; icon: any; iconColor: string;
  props: any[]; loading: boolean;
  expandedPick: string | null; setExpanded: (id: string | null) => void; addParlayLeg: any;
}) {
  const market = title.toLowerCase().replace(/\s/g, "_");

  const fmt = (o: number) => (o > 0 ? `+${o}` : `${o}`);

  return (
    <div className="glass rounded-xl overflow-hidden">
      <div className="px-3 sm:px-4 py-2.5 border-b border-slate/30 flex items-center gap-2">
        <Icon className={`w-4 h-4 ${iconColor}`} />
        <div className="flex-1">
          <h2 className="text-xs sm:text-sm font-bold text-silver uppercase tracking-wider">{title}</h2>
          <p className="text-[9px] text-mercury/60">{subtitle}</p>
        </div>
        {props.length > 0 && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-gunmetal text-mercury">{props.length}</span>}
      </div>
      {loading ? (
        <div className="p-5 text-center"><Activity className="w-4 h-4 text-mercury/30 animate-spin mx-auto" /></div>
      ) : props.length === 0 ? (
        <div className="px-4 py-5 text-center"><p className="text-xs text-mercury/50">No {title.toLowerCase()} props posted yet</p></div>
      ) : (
        <div className="divide-y divide-slate/10">
          {props.slice(0, 5).map((p: any, i: number) => {
            const pid = `${market}-${p.playerName}-${i}`;
            const open = expandedPick === pid;
            return (
              <div key={i}>
                <button onClick={() => setExpanded(open ? null : pid)} className="w-full px-3 sm:px-4 py-2.5 flex items-center gap-2 hover:bg-gunmetal/20 text-left">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs sm:text-sm font-medium text-silver truncate">{p.playerName}</p>
                    <p className="text-[9px] text-mercury/60 truncate">{p.team}</p>
                  </div>
                  <span className="text-sm font-bold font-mono text-electric flex-shrink-0">{p.line}</span>
                  <span className="text-[10px] font-mono text-neon bg-neon/10 px-1 py-0.5 rounded">O{fmt(p.bestOver?.price ?? 0)}</span>
                  <span className="text-[10px] font-mono text-purple bg-purple/10 px-1 py-0.5 rounded">U{fmt(p.bestUnder?.price ?? 0)}</span>
                  <ChevronDown className={`w-3.5 h-3.5 text-mercury/40 transition-transform ${open ? "rotate-180" : ""}`} />
                </button>
                {open && (
                  <div className="px-3 sm:px-4 pb-3 animate-slide-up space-y-2">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                      {(p.books ?? []).map((b: any, bi: number) => (
                        <div key={bi} className="flex items-center justify-between px-2 py-1.5 rounded bg-bunker/50 border border-slate/15 text-[10px]">
                          <span className="text-mercury truncate mr-1">{b.bookmaker?.split(" ").pop()?.slice(0, 6)}</span>
                          <div className="flex gap-1 flex-shrink-0 font-mono">
                            <button onClick={() => addParlayLeg({ game: p.playerName, market: "player_prop", pick: `${p.playerName} Over ${p.line}`, odds: b.overPrice, fairProb: (p.fairOverProb ?? 50) / 100, bookmaker: b.bookmaker })} className="text-neon/80 hover:text-neon">O{fmt(b.overPrice)}</button>
                            <button onClick={() => addParlayLeg({ game: p.playerName, market: "player_prop", pick: `${p.playerName} Under ${p.line}`, odds: b.underPrice, fairProb: (p.fairUnderProb ?? 50) / 100, bookmaker: b.bookmaker })} className="text-purple/80 hover:text-purple">U{fmt(b.underPrice)}</button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 px-1">
                      <span className="text-[9px] text-neon">O {p.fairOverProb}%</span>
                      <div className="flex-1 h-1.5 bg-gunmetal rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-neon to-electric rounded-full" style={{ width: `${p.fairOverProb}%` }} />
                      </div>
                      <span className="text-[9px] text-purple">{p.fairUnderProb}% U</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button onClick={() => addParlayLeg({ game: p.playerName, market: "player_prop", pick: `${p.playerName} Over ${p.line}`, odds: p.bestOver?.price ?? -110, fairProb: (p.fairOverProb ?? 50) / 100, bookmaker: p.bestOver?.bookmaker ?? "" })} className="flex items-center justify-center gap-1 py-1.5 rounded bg-neon/10 border border-neon/20 text-neon text-[11px] font-semibold">
                        <ArrowUpRight className="w-3 h-3" /> Over {p.line}
                      </button>
                      <button onClick={() => addParlayLeg({ game: p.playerName, market: "player_prop", pick: `${p.playerName} Under ${p.line}`, odds: p.bestUnder?.price ?? -110, fairProb: (p.fairUnderProb ?? 50) / 100, bookmaker: p.bestUnder?.bookmaker ?? "" })} className="flex items-center justify-center gap-1 py-1.5 rounded bg-purple/10 border border-purple/20 text-purple text-[11px] font-semibold">
                        <ArrowDownRight className="w-3 h-3" /> Under {p.line}
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
function generateReasons(bet: any): string[] {
  const r: string[] = [];
  if (bet.evPercentage > 8) r.push(`Strong ${bet.evPercentage.toFixed(1)}% edge — well above the 3% threshold`);
  else if (bet.evPercentage > 4) r.push(`Solid ${bet.evPercentage.toFixed(1)}% edge over market consensus`);
  else r.push(`${bet.evPercentage.toFixed(1)}% positive edge detected`);
  r.push(`Best price at ${bet.bookmaker} (${bet.odds > 0 ? "+" : ""}${bet.odds})`);
  const imp = bet.odds > 0 ? 100 / (bet.odds + 100) : Math.abs(bet.odds) / (Math.abs(bet.odds) + 100);
  const fair = bet.fairProb / 100;
  if (fair > imp + 0.03) r.push(`Model: ${(fair * 100).toFixed(0)}% win prob vs ${(imp * 100).toFixed(0)}% implied — mismatch`);
  r.push(`Quarter-Kelly: $${bet.kellyStake.toFixed(0)} on $1k bankroll`);
  return r;
}

function generateAITip(bet: any): string {
  if (bet.evPercentage > 8) return `Premium edge — the market is significantly mispriced at ${bet.bookmaker}. Strong play with proper bankroll management.`;
  if (bet.evPercentage > 4) return `Good value. The line at ${bet.bookmaker} is softer than the market average. Consistent +EV plays like this build bankroll over time.`;
  if (bet.odds > 150) return `Longshot value. The model sees more upside than the market gives credit. Small stake, big potential return.`;
  return `Marginal edge at ${bet.bookmaker}. Play this as part of a high-volume +EV strategy.`;
}

function generateHistory(bet: any): string[] {
  if (bet.market === "moneyline") return ["Factors: pitching, hitting, bullpen, defense, recent form", "Weights shift by inning — bullpen dominates late", "Home field advantage: ~54% baseline"];
  if (bet.market === "total") return ["Considers: starter matchup, park factors, weather", "Wind and temperature impact scoring projections", "Umpire run-scoring index used as adjustment"];
  return ["Based on de-vigged market consensus across all books"];
}
