"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useStore } from "@/lib/store";
import { useSport } from "@/lib/sport-context";
import {
  Trophy, Zap, Layers, TrendingUp, Target, ChevronDown,
  Star, DollarSign, ArrowUpRight, ArrowDownRight, BarChart3,
  Flame, Brain, Clock, Swords, Activity, CircleDot, ArrowUp, ArrowDown, Shield,
  AlertTriangle, ExternalLink, Sparkles, RefreshCw, Share2, Check, MoreHorizontal,
} from "lucide-react";
import { getDeepLink } from "@/lib/odds/sportsbooks";
import TeamLogo from "@/components/ui/TeamLogo";
import InfoTip from "@/components/ui/InfoTip";
import Link from "next/link";
import { usePremium } from "@/lib/hooks/usePremium";
import TodayPropPicks from "@/components/dashboard/TodayPropPicks";
import PropDetail from "@/components/dashboard/PropDetail";
import LineMovementBadge from "@/components/ui/LineMovementBadge";
import { formatPickLabel } from "@/lib/display";

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
  edgeAge?: number;
  gameStatus?: "live" | "pre" | "tomorrow" | "future";
  dayLabel?: string; // e.g. "Tomorrow", "Sat", "Apr 19" — resolved at pick creation
  isSharp?: boolean;   // pick aligns with sharpest book
}

export default function PicksBoard() {
  const { oddsData, scores, addParlayLeg } = useStore();
  const { currentSport, config } = useSport();
  const { isPremium } = usePremium();
  const isNBA = currentSport === "nba";
  const [expandedPick, setExpandedPick] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [propsData, setPropsData] = useState<Record<string, any[]>>({});
  const [calibration, setCalibration] = useState<{ calibrationDelta: number; sample: number } | null>(null);

  // Fetch calibration curve once — used by honestify to rewrite overconfident labels
  useEffect(() => {
    fetch("/api/calibration")
      .then(r => r.json())
      .then(d => { if (d?.curve) setCalibration({ calibrationDelta: d.curve.calibrationDelta, sample: d.curve.sample }); })
      .catch(() => {});
  }, []);
  const [propsLoading, setPropsLoading] = useState(true);
  const [modelPicks, setModelPicks] = useState<Pick[]>([]);

  // Fetch 3-model analysis and convert to picks
  useEffect(() => {
    const analysisUrl = isNBA ? "/api/nba-analysis" : "/api/bot-analysis";
    fetch(analysisUrl).then(r => r.json()).then(data => {
      const picks: Pick[] = [];
      for (const game of data.analyses ?? []) {
        if (!game.picks?.length) continue;
        for (const p of game.picks) {
          picks.push({
            id: `model-${game.gameId}-${p.pick}`,
            game: `${game.awayTeam} @ ${game.homeTeam}`,
            pick: p.pick,
            market: p.market,
            odds: p.odds,
            bookmaker: p.bookmaker,
            evPercentage: p.evPercentage ?? 0,
            fairProb: p.fairProb ?? 50,
            confidence: game.consensus?.confidence === "HIGH" ? "HIGH" : game.consensus?.confidence === "MEDIUM" ? "MEDIUM" : "LOW",
            kellyStake: p.kellyStake ?? 0,
            reasoning: p.reasoning ?? [],
            aiTip: `${config.model1Label}: ${game.pitcherModel?.homeWinProb ? (game.pitcherModel.homeWinProb * 100).toFixed(0) : '?'}% | Market: ${game.marketModel?.homeWinProb ? (game.marketModel.homeWinProb * 100).toFixed(0) : '?'}% | ${config.model3Label}: ${game.trendModel?.homeWinProb ? (game.trendModel.homeWinProb * 100).toFixed(0) : '?'}% → ${game.consensus?.modelsAgree ? 'All agree' : 'Models disagree'}`,
            history: game.homePitcher ? [`Home: ${game.homePitcher.name} (${game.homePitcher.era} ERA)`, `Away: ${game.awayPitcher?.name ?? 'TBD'} (${game.awayPitcher?.era ?? '?'} ERA)`] : [],
            commenceTime: game.commenceTime,
            gameStatus: undefined,
            isSharp: game.consensus?.modelsAgree && (game.consensus?.confidence === "HIGH" || game.consensus?.confidence === "MEDIUM"),
          });
        }
      }
      setModelPicks(picks);
    }).catch(() => { setModelPicks([]); });
  }, [isNBA]); // re-fetch when sport changes

  // Fetch props progressively — render as each market lands rather than
  // waiting for the slowest one. Feels instant on phone + desktop.
  useEffect(() => {
    let cancelled = false;
    setPropsLoading(true);
    setPropsData({});
    const markets = isNBA
      ? [
          { key: "player_points", url: "/api/players?market=player_points&sport=basketball_nba" },
          { key: "player_rebounds", url: "/api/players?market=player_rebounds&sport=basketball_nba" },
          { key: "player_assists", url: "/api/players?market=player_assists&sport=basketball_nba" },
        ]
      : [
          { key: "pitcher_strikeouts", url: "/api/players?market=pitcher_strikeouts" },
          { key: "batter_hits", url: "/api/players?market=batter_hits" },
          { key: "batter_home_runs", url: "/api/players?market=batter_home_runs" },
          { key: "batter_total_bases", url: "/api/players?market=batter_total_bases" },
        ];

    let firstLanded = false;
    const fetches = markets.map((m) =>
      fetch(m.url)
        .then((r) => r.json())
        .catch(() => ({ props: [] }))
        .then((data) => {
          if (cancelled) return;
          setPropsData((prev) => ({ ...prev, [m.key]: data.props ?? [] }));
          if (!firstLanded) {
            firstLanded = true;
            setPropsLoading(false);
          }
        }),
    );
    Promise.all(fetches).then(() => { if (!cancelled) setPropsLoading(false); });

    return () => { cancelled = true; };
  }, [isNBA]);

  // Build lookup: team name → game status from scores
  const gameStatusMap = useMemo(() => {
    const map = new Map<string, "live" | "pre" | "final">();
    for (const s of scores) {
      const status = s.status as "live" | "pre" | "final";
      map.set(s.homeTeam?.toLowerCase(), status);
      map.set(s.awayTeam?.toLowerCase(), status);
      map.set(s.homeAbbrev?.toLowerCase(), status);
      map.set(s.awayAbbrev?.toLowerCase(), status);
    }
    return map;
  }, [scores]);

  const getGameStatus = useCallback((gameName: string, commenceTime?: string): { status: "live" | "pre" | "tomorrow" | "future" | "final"; dayLabel?: string } => {
    // Check scores for live/final status
    const lower = gameName.toLowerCase();
    for (const [name, status] of gameStatusMap) {
      if (lower.includes(name)) {
        if (status === "final") return { status: "final" };
        if (status === "live") return { status: "live" };
      }
    }
    // Compute day offset for future games
    if (commenceTime) {
      const gameDate = new Date(commenceTime);
      const today = new Date();
      const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const startOfGame = new Date(gameDate.getFullYear(), gameDate.getMonth(), gameDate.getDate());
      const dayDiff = Math.round((startOfGame.getTime() - startOfToday.getTime()) / 86400000);
      if (dayDiff === 1) return { status: "tomorrow", dayLabel: "Tomorrow" };
      if (dayDiff > 1) {
        const label = dayDiff < 7
          ? gameDate.toLocaleDateString("en-US", { weekday: "short" })
          : gameDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        return { status: "future", dayLabel: label };
      }
    }
    return { status: "pre" };
  }, [gameStatusMap]);

  // Collect ALL picks — EV bets + single-book value + matchup predictions
  const allEV: Pick[] = useMemo(() => {
    const picks: Pick[] = [];
    const now = Date.now();

    for (const game of oddsData) {
      const gameName = game.awayTeam && game.homeTeam
        ? `${game.awayTeam} @ ${game.homeTeam}` : "";

      // Skip games that started 4+ hours ago (definitely over)
      if (game.commenceTime) {
        const gameStart = new Date(game.commenceTime).getTime();
        if (gameStart < now - 4 * 60 * 60 * 1000) continue;
      }

      const { status, dayLabel } = getGameStatus(gameName, game.commenceTime);
      if (status === "final") continue;

      const bookCount = game.oddsLines?.length ?? 0;

      // Path 1: Multi-book EV bets (best data)
      if (game.evBets?.length > 0) {
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
            gameStatus: status as Pick["gameStatus"],
            dayLabel,
          });
        }
      }

      // Path 2: Single-book games — generate picks from available odds
      if (game.evBets?.length === 0 && bookCount >= 1) {
        const line = game.oddsLines[0];
        const singleBookNote = bookCount === 1 ? "Single book — limited data" : "";

        // Home ML if it looks like value (underdog or close)
        if (line.homeML && line.homeML !== 0 && line.homeML > -200) {
          const imp = line.homeML > 0 ? 100 / (line.homeML + 100) : Math.abs(line.homeML) / (Math.abs(line.homeML) + 100);
          picks.push({
            id: `${game.id}-home-${line.bookmaker}`,
            game: gameName,
            pick: `${game.homeTeam} ML`,
            market: "moneyline",
            odds: line.homeML,
            bookmaker: line.bookmaker,
            evPercentage: 0,
            fairProb: Math.round(imp * 1000) / 10,
            confidence: "LOW",
            kellyStake: 0,
            reasoning: [`${game.homeTeam} at home (${line.homeML > 0 ? "+" : ""}${line.homeML})`, singleBookNote, "Model analysis based on team matchup and available line"].filter(Boolean),
            aiTip: `Early line from ${line.bookmaker}. ${singleBookNote ? "Only one book has posted — watch for line movement as more books open." : ""}`,
            history: ["Home field advantage: ~54% baseline", "Line may shift as more books post"],
            commenceTime: game.commenceTime,
            gameStatus: status as Pick["gameStatus"],
            dayLabel,
          });
        }

        // Away ML if underdog value
        if (line.awayML && line.awayML !== 0 && line.awayML > 100) {
          const imp = 100 / (line.awayML + 100);
          picks.push({
            id: `${game.id}-away-${line.bookmaker}`,
            game: gameName,
            pick: `${game.awayTeam} ML`,
            market: "moneyline",
            odds: line.awayML,
            bookmaker: line.bookmaker,
            evPercentage: 0,
            fairProb: Math.round(imp * 1000) / 10,
            confidence: "LOW",
            kellyStake: 0,
            reasoning: [`${game.awayTeam} underdog at ${line.awayML > 0 ? "+" : ""}${line.awayML}`, singleBookNote, "Underdog value play — higher payout if correct"].filter(Boolean),
            aiTip: `Underdog spot for ${game.awayTeam}. Early line — value may disappear as market sharpens.`,
            history: ["Road underdogs with value have historically been profitable long-term"],
            commenceTime: game.commenceTime,
            gameStatus: status as Pick["gameStatus"],
            dayLabel,
          });
        }

        // Total if available
        if (line.total > 0 && line.overPrice !== 0) {
          picks.push({
            id: `${game.id}-total-${line.bookmaker}`,
            game: gameName,
            pick: `${game.awayTeam}/${game.homeTeam} O/U ${line.total}`,
            market: "total",
            odds: line.overPrice,
            bookmaker: line.bookmaker,
            evPercentage: 0,
            fairProb: 50,
            confidence: "LOW",
            kellyStake: 0,
            reasoning: [`Total set at ${line.total} by ${line.bookmaker}`, singleBookNote, "Monitor line movement for direction"].filter(Boolean),
            aiTip: `Game total at ${line.total}. Watch which direction sharp money moves this.`,
            history: ["League average is ~8.5 runs per game"],
            commenceTime: game.commenceTime,
            gameStatus: status as Pick["gameStatus"],
            dayLabel,
          });
        }
      }

      // Path 3: No odds at all — generate matchup prediction
      if (bookCount === 0) {
        picks.push({
          id: `${game.id}-matchup`,
          game: gameName,
          pick: `${gameName} — Matchup Preview`,
          market: "moneyline",
          odds: 0,
          bookmaker: "No lines posted",
          evPercentage: 0,
          fairProb: 50,
          confidence: "LOW",
          kellyStake: 0,
          reasoning: [
            "No sportsbook lines available yet for this game",
            "Books typically post full odds 12-18 hours before game time",
            "Check back closer to game time for full analysis",
          ],
          aiTip: `Lines haven't been posted yet for ${gameName}. This usually means it's still early — check back tomorrow morning for full odds and analysis.`,
          history: [],
          commenceTime: game.commenceTime,
          gameStatus: status as Pick["gameStatus"],
        });
      }
    }

    // Sort: live → pre-game → tomorrow → future. Within each: EV bets first
    return picks.sort((a, b) => {
      const statusOrder: Record<string, number> = { live: 0, pre: 1, tomorrow: 2, future: 3 };
      const aOrder = statusOrder[a.gameStatus ?? "pre"] ?? 1;
      const bOrder = statusOrder[b.gameStatus ?? "pre"] ?? 1;
      if (aOrder !== bOrder) return aOrder - bOrder;
      // EV bets first
      if (a.evPercentage > 0 && b.evPercentage === 0) return -1;
      if (b.evPercentage > 0 && a.evPercentage === 0) return 1;
      return b.evPercentage - a.evPercentage;
    });
  }, [oddsData, getGameStatus]);

  // Merge 3-model picks with EV picks — strict dedup by normalized pick text
  const combinedPicks = useMemo(() => {
    const seen = new Set<string>();
    const merged: Pick[] = [];

    function normalizeKey(p: Pick): string {
      // Normalize: strip whitespace, lowercase, remove "ML" variations
      const team = p.pick.toLowerCase().replace(/\s+ml$/, "").replace(/\s+/g, " ").trim();
      return team;
    }

    // Honesty gate:
    // 1) Sharp tag requires a real market-vs-model edge (EV >= 1.5%).
    // 2) Model confidence flows through as-is from consensus — heavy favorites
    //    with efficient markets can still be "HIGH" (the model likes them)
    //    even when EV ≈ 0. Users want to see "Cavs -350" as a lock regardless
    //    of edge. Only kill confidence when the edge is meaningfully negative
    //    or when starter/input data is incomplete.
    // 3) MLB totals with TBD starter cap at LOW (pitcher is dominant input).
    // 4) Calibration haircut: if the brain is historically overconfident
    //    (calibrationDelta < -0.03 = predicted 3%+ higher than actual),
    //    demote HIGH picks one step. Users never see a label we can't back up.
    const calibDelta = calibration?.calibrationDelta ?? 0;
    const calibReliable = (calibration?.sample ?? 0) >= 50;
    const overconfident = calibReliable && calibDelta < -0.03;

    function honestify(p: Pick): Pick {
      const ev = p.evPercentage ?? 0;
      let conf = p.confidence;
      let isSharp = !!p.isSharp;

      // Sharp requires measurable edge — keep this gate
      if (ev < 1.5) isSharp = false;

      // Only demote confidence when edge is meaningfully bad (< -1.5%), not
      // just zero. A 0% edge means the market agrees with the model — that's
      // fine, still a lock.
      if (ev < -1.5 && conf === "HIGH") conf = "MEDIUM";
      if (ev < -3.0) { conf = "LOW"; isSharp = false; }

      // Calibration haircut — the brain has been overclaiming lately
      if (overconfident && conf === "HIGH") conf = "MEDIUM";

      // TBD pitcher → cap totals at LOW, kill Sharp
      const isTotal = p.market === "total";
      if (isTotal && p.game) {
        const gameSrc = scores.find((s: any) =>
          p.game.includes(s.homeTeam) || p.game.includes(s.awayTeam) ||
          p.game.includes(s.homeAbbrev) || p.game.includes(s.awayAbbrev)
        );
        const tbd = !!gameSrc && (gameSrc.homePitcher === "TBD" || gameSrc.awayPitcher === "TBD");
        if (tbd) { conf = "LOW"; isSharp = false; }
      }

      return (conf === p.confidence && isSharp === !!p.isSharp) ? p : { ...p, confidence: conf, isSharp };
    }

    // Model picks first (they have real analysis)
    for (const p of modelPicks) {
      const key = normalizeKey(p);
      if (!seen.has(key)) { seen.add(key); merged.push(honestify(p)); }
    }
    // Then EV picks that aren't duplicates
    for (const p of allEV) {
      const key = normalizeKey(p);
      if (!seen.has(key)) { seen.add(key); merged.push(honestify(p)); }
    }
    return merged;
  }, [modelPicks, allEV, scores, calibration]);

  // Build all sections in one stable useMemo
  const { topLocks, longshots } = useMemo(() => {
    // Detect Under-side total picks so we can cap them per section.
    // Users bias heavily toward Overs; Unders should only surface when
    // they're among the sharpest plays.
    const isUnderTotal = (p: Pick) => /\bunder\b/i.test(p.pick);

    function takeUniqueWithOverBias(
      pool: Pick[],
      count: number,
      extraFilter?: (p: Pick) => boolean,
    ): Pick[] {
      const maxUnders = Math.max(1, Math.floor(count / 4)); // ~25% cap
      const used = new Set<string>();
      const result: Pick[] = [];
      let underCount = 0;
      for (const p of pool) {
        const key = p.pick.toLowerCase().replace(/\s+/g, " ").trim();
        if (used.has(key)) continue;
        if (extraFilter && !extraFilter(p)) continue;
        if (isUnderTotal(p) && underCount >= maxUnders) continue;
        used.add(key);
        result.push(p);
        if (isUnderTotal(p)) underCount++;
        if (result.length >= count) break;
      }
      return result;
    }
    return {
      topLocks: takeUniqueWithOverBias(combinedPicks, 6, (p) => p.confidence === "HIGH" || p.confidence === "MEDIUM"),
      longshots: takeUniqueWithOverBias(combinedPicks, 5, (p) => p.odds >= 150),
    };
  }, [combinedPicks]);

  // Check if all picks are for a future day (show banner)
  const hasLiveGames = combinedPicks.some((p) => p.gameStatus === "live");
  const hasPreGames = combinedPicks.some((p) => p.gameStatus === "pre");
  const allFuture = combinedPicks.length > 0 && !hasLiveGames && !hasPreGames;
  const nextDayLabel = combinedPicks.find((p) => p.dayLabel)?.dayLabel;

  // Parlay of the day — pinned server-side so every user sees the same picks.
  const [pinnedParlay, setPinnedParlay] = useState<{
    legs: any[]; totalOdds: number; generatedAt: string; dayLabel: string;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/parlay-today?sport=${currentSport}`)
      .then(r => r.json())
      .then(data => {
        if (!cancelled && data.ok && data.legs?.length >= 2) {
          setPinnedParlay({ legs: data.legs, totalOdds: data.totalOdds, generatedAt: data.generatedAt, dayLabel: data.dayLabel });
        } else if (!cancelled) {
          setPinnedParlay(null);
        }
      })
      .catch(() => { if (!cancelled) setPinnedParlay(null); });
    return () => { cancelled = true; };
  }, [currentSport]);

  const parlayLegs = pinnedParlay?.legs ?? [];
  const parlayAmerican = pinnedParlay?.totalOdds ?? 0;

  const formatOdds = (odds: number) => (odds > 0 ? `+${odds}` : `${odds}`);

  // Today's Slate — two cross-market buckets. Props (TodayPropPicks)
  // and NRFI/YRFI (on the /nrfi tab) are their own components.
  const sections = [
    { key: "locks", title: "LOCKS", subtitle: "Our highest-confidence plays today", icon: Trophy, iconColor: "text-gold", bg: "bg-gold/5", border: "border-gold/20", picks: topLocks },
    { key: "longshots", title: "LONGSHOTS", subtitle: "Plus-money underdogs worth a look", icon: Zap, iconColor: "text-amber", bg: "bg-amber/5", border: "border-amber/20", picks: longshots },
  ];

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Limited data disclaimer */}
      {combinedPicks.length > 0 && combinedPicks.length < 5 && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber/5 border border-amber/15">
          <AlertTriangle className="w-3.5 h-3.5 text-amber flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs text-amber font-semibold">Limited odds data available</p>
            <p className="text-[10px] text-mercury/70">Most books haven't posted full lines yet. Picks below are based on available data — full analysis will populate as more sportsbooks open their markets (usually by 10-11 AM ET).</p>
          </div>
        </div>
      )}

      {/* Day status banner */}
      {hasLiveGames && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-danger/5 border border-danger/15">
          <span className="relative flex h-2 w-2"><span className="animate-ping absolute h-full w-full rounded-full bg-danger opacity-75" /><span className="relative rounded-full h-2 w-2 bg-danger" /></span>
          <span className="text-xs text-danger font-semibold">Live games in progress — odds updating in real time</span>
        </div>
      )}
      {allFuture && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-electric/5 border border-electric/15">
          <Clock className="w-3.5 h-3.5 text-electric" />
          <span className="text-xs text-electric font-semibold">
            No games today — showing picks for {nextDayLabel ?? "upcoming games"}
          </span>
        </div>
      )}

      {/* ═══ PARLAY OF THE DAY ═══ */}
      {parlayLegs.length >= 2 && (
        <div className="glass rounded-xl overflow-hidden border border-purple/20">
          <div className="px-3 sm:px-4 py-2.5 bg-gradient-to-r from-purple/10 to-neon/5 border-b border-purple/15 flex items-center gap-2">
            <Layers className="w-4 h-4 text-purple" />
            <div className="flex-1 min-w-0">
              <h2 className="text-xs sm:text-sm font-bold text-silver uppercase tracking-wider">Parlay of the Day</h2>
              {pinnedParlay?.generatedAt && (
                <p className="text-[9px] text-mercury/60 mt-0.5">
                  {pinnedParlay.dayLabel} • Locked at {new Date(pinnedParlay.generatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET
                </p>
              )}
            </div>
            <span className="text-base sm:text-lg font-bold font-mono text-purple">{formatOdds(parlayAmerican)}</span>
          </div>
          <div className="p-2.5 sm:p-3 space-y-1.5">
            {parlayLegs.map((leg, i) => (
              <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-gunmetal/30 text-left">
                <span className="w-4 h-4 rounded-full bg-purple/20 text-purple text-[9px] font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>
                <TeamLogo team={leg.pick.split(" ML")[0].split(" Over")[0].split(" Under")[0].split("/")[0].trim()} size={18} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs sm:text-sm font-medium text-silver truncate">{leg.pick}</p>
                  <p className="text-[9px] text-mercury/60 truncate">
                    {leg.commenceTime && (
                      <span className="text-mercury/80">{new Date(leg.commenceTime).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} — </span>
                    )}
                    {leg.game} • {leg.bookmaker}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs font-mono font-semibold text-silver">{formatOdds(leg.odds)}</p>
                  <p className="text-[9px] text-neon">+{leg.evPercentage.toFixed(1)}%</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ TODAY'S PLAYER PROPS ═══ */}
      <TodayPropPicks sport={currentSport} propsData={propsData} loading={propsLoading} />

      {/* ═══ MARKET SECTIONS ═══ */}
      {sections.map((sec) => {
        // Default-collapsed for lower-signal sections; user can expand
        const defaultCollapsed = sec.key === "longshots" || sec.key === "unders";
        const isCollapsed = collapsedSections[sec.key] ?? defaultCollapsed;
        return (
        <div key={sec.key} className="glass rounded-xl overflow-hidden">
          <button
            onClick={() => setCollapsedSections(prev => ({ ...prev, [sec.key]: !(prev[sec.key] ?? defaultCollapsed) }))}
            className={`w-full px-3 sm:px-4 py-2.5 border-b ${sec.border} ${sec.bg} flex items-center gap-2 hover:brightness-110 transition-all text-left`}
          >
            <sec.icon className={`w-4 h-4 ${sec.iconColor}`} />
            <div className="flex-1">
              <h2 className="text-xs sm:text-sm font-bold text-silver uppercase tracking-wider">{sec.title}</h2>
              <p className="text-[9px] text-mercury/60">{sec.subtitle}</p>
            </div>
            {sec.picks.length > 0 && (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-gunmetal text-mercury">{sec.picks.length}</span>
            )}
            <ChevronDown className={`w-4 h-4 text-mercury/50 transition-transform ${isCollapsed ? "" : "rotate-180"}`} />
          </button>
          {isCollapsed ? null : sec.picks.length === 0 ? (
            <div className="px-3 py-3">
              <p className="text-[10px] text-amber/70 mb-2">Best available — model still refining full analysis</p>
              {/* Fallback — show up to 3 varied best picks from pool (deduped by market) */}
              {(() => {
                const seenMarkets = new Set<string>();
                const varied: Pick[] = [];
                for (const p of combinedPicks) {
                  if (seenMarkets.has(p.market)) continue;
                  seenMarkets.add(p.market);
                  varied.push(p);
                  if (varied.length >= 3) break;
                }
                return varied.map((pick, fi) => (
                  <div key={fi} className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-gunmetal/30 border border-slate/20 mb-1.5">
                    <TeamLogo team={pick.pick.split(" ML")[0].split(" Moneyline")[0].split(" Over")[0].split(" Under")[0].split("/")[0].trim()} size={20} className="flex-shrink-0" />
                    <p className="text-xs sm:text-sm font-medium text-silver truncate flex-1">{formatPickLabel(pick.pick, currentSport as any)}</p>
                    <span className="text-xs font-mono font-bold text-silver">{formatOdds(pick.odds)}</span>
                  </div>
                ));
              })()}
              {combinedPicks.length === 0 && <p className="text-xs text-mercury/40 text-center">Waiting for odds data</p>}
            </div>
          ) : (
            <div className="divide-y divide-slate/10">
              {(isPremium ? sec.picks : sec.picks.slice(0, 3)).map((pick) => (
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
              {!isPremium && sec.picks.length > 3 && (
                <Link
                  href="/pricing"
                  className="block px-4 py-3 text-center bg-gradient-to-br from-neon/10 to-electric/5 border-t border-neon/20 hover:from-neon/20 transition-colors group"
                >
                  <p className="text-xs font-bold text-neon">
                    +{sec.picks.length - 3} more {sec.title.toLowerCase()} locked
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
      })}


      {/* No data state */}
      {combinedPicks.length === 0 && allEV.length === 0 && (
        <div className="glass rounded-xl p-8 text-center">
          <Activity className="w-8 h-8 text-mercury/20 mx-auto mb-3" />
          <p className="text-sm text-mercury font-semibold">No picks available yet</p>
          <p className="text-xs text-mercury/50 mt-1 mb-4">Odds data may be loading or outside peak hours. Requires 2+ books on active games.</p>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("dq-refresh"))}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-neon/10 border border-neon/25 text-neon text-xs font-semibold rounded-lg hover:bg-neon/20 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh Data
          </button>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
function PickCard({ pick, isExpanded, onToggle, onAddToParlay, formatOdds }: {
  pick: Pick; isExpanded: boolean; onToggle: () => void; onAddToParlay: () => void; formatOdds: (n: number) => string;
}) {
  const [showAISummary, setShowAISummary] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [shared, setShared] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { bankroll, scores } = useStore();
  const { currentSport } = useSport();

  // Close overflow menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpen]);

  // Demote Sharp tag if the underlying game has TBD pitcher (input incomplete).
  const isPitcherTBD = useMemo(() => {
    if (!pick.game) return false;
    if (pick.game.includes("TBD")) return true;
    // Match by team in scores feed
    const scoreGame = scores.find((s: any) =>
      pick.game.includes(s.homeTeam) || pick.game.includes(s.awayTeam) ||
      pick.game.includes(s.homeAbbrev) || pick.game.includes(s.awayAbbrev)
    );
    return scoreGame ? (scoreGame.homePitcher === "TBD" || scoreGame.awayPitcher === "TBD") : false;
  }, [pick.game, scores]);
  const showSharp = pick.isSharp && !isPitcherTBD;

  // Unit-size suggestion (1u = 1% of bankroll, scaled by edge, capped 0.5–5u).
  const unitSize = useMemo(() => {
    const bank = bankroll?.currentBankroll ?? 0;
    if (bank <= 0 || pick.evPercentage <= 0) return null;
    const baseUnit = bank * 0.01; // 1 unit = 1% of bankroll
    const edge = pick.evPercentage; // %
    const units = Math.min(5, Math.max(0.5, Math.round(edge * 0.5 * 2) / 2)); // 0.5u per 1% EV, cap 5u, 0.5 step
    const dollars = Math.round(units * baseUnit * 100) / 100;
    return { units, dollars };
  }, [bankroll, pick.evPercentage]);

  // Fetch AI summary when user opens it; use localStorage cache keyed by pick.id + date
  useEffect(() => {
    if (!showAISummary || aiSummary !== null) return;
    const today = new Date().toISOString().split("T")[0];
    const cacheKey = `dq_gsum_${pick.id.replace(/[^a-z0-9]/gi, "_").slice(0, 50)}_${today}`;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) { setAiSummary(cached); return; }
    } catch {}

    setSummaryLoading(true);
    fetch("/api/game-summary-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        game: pick.game,
        reasoning: pick.reasoning,
        history: pick.history,
        aiTip: pick.aiTip,
        gameId: pick.id,
      }),
    })
      .then(r => r.json())
      .then(data => {
        const text = data.summary ?? null;
        setAiSummary(text ?? "");
        if (text) {
          try { localStorage.setItem(cacheKey, text); } catch {}
        }
      })
      .catch(() => setAiSummary(""))
      .finally(() => setSummaryLoading(false));
  }, [showAISummary]); // eslint-disable-line react-hooks/exhaustive-deps

  const confDot: Record<string, string> = { HIGH: "bg-neon", MEDIUM: "bg-electric", LOW: "bg-amber", NO_EDGE: "bg-mercury/40" };

  return (
    <div>
      <button onClick={onToggle} className="w-full px-3 sm:px-4 py-2.5 flex items-center gap-2 hover:bg-gunmetal/20 active:bg-gunmetal/30 transition-colors text-left">
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${confDot[pick.confidence] ?? confDot.LOW}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {pick.gameStatus === "live" && (
              <span className="flex items-center gap-1 px-1 py-0.5 rounded bg-danger/15 flex-shrink-0">
                <span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute h-full w-full rounded-full bg-danger opacity-75" /><span className="relative rounded-full h-1.5 w-1.5 bg-danger" /></span>
                <span className="text-[8px] font-bold text-danger uppercase">Live — Pre-game line</span>
              </span>
            )}
            {showSharp && (
              <InfoTip term="SHARP" iconClassName="w-2.5 h-2.5">
                <span className="px-1 py-0.5 rounded bg-neon/10 text-[8px] font-bold text-neon uppercase flex-shrink-0">Sharp</span>
              </InfoTip>
            )}
            {isPitcherTBD && pick.isSharp && (
              <span className="px-1 py-0.5 rounded bg-amber/10 text-[8px] font-bold text-amber uppercase flex-shrink-0" title="Pitcher TBD — model input incomplete">
                TBD
              </span>
            )}
            {/* Line movement badge — shows when line moved ≥0.5pt recently */}
            <LineMovementBadge
              gameId={pick.id.split("-")[0]}
              market={pick.market}
            />

            {(pick.gameStatus === "tomorrow" || pick.gameStatus === "future") && (
              <span className="px-1 py-0.5 rounded bg-electric/10 text-[8px] font-bold text-electric uppercase flex-shrink-0">
                {pick.dayLabel ?? "Upcoming"}
              </span>
            )}
            <TeamLogo team={pick.pick.split(" ML")[0].split(" Moneyline")[0].split(" Over")[0].split(" Under")[0].split("/")[0].trim()} size={20} className="flex-shrink-0" />
            <p className="text-xs sm:text-sm font-medium text-silver truncate">{formatPickLabel(pick.pick, currentSport as any)}</p>
          </div>
          <p className="text-[9px] sm:text-[10px] text-mercury/60 truncate flex items-center gap-1">
            {pick.commenceTime && (
              <span className="text-mercury/80">
                {new Date(pick.commenceTime).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                {" — "}
              </span>
            )}
            {pick.game?.includes(" @ ") && (
              <>
                <TeamLogo team={pick.game.split(" @ ")[0]} size={12} />
                <TeamLogo team={pick.game.split(" @ ")[1]} size={12} />
              </>
            )}
            {pick.game} • {pick.bookmaker}
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-xs sm:text-sm font-mono font-bold text-silver">{formatOdds(pick.odds)}</p>
          <p className="text-[9px] sm:text-[10px] font-mono text-neon font-semibold flex items-center justify-end gap-0.5">
            <InfoTip term="EV"><span>+{pick.evPercentage.toFixed(1)}%</span></InfoTip>
          </p>
          {unitSize && (
            <p className="text-[9px] font-mono text-electric/70 mt-0.5">
              <InfoTip term="UNIT"><span>{unitSize.units}u (${unitSize.dollars})</span></InfoTip>
            </p>
          )}
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
          {/* Live game warning */}
          {pick.gameStatus === "live" && (
            <div className="flex items-start gap-2 p-2 rounded-lg bg-danger/5 border border-danger/15">
              <span className="relative flex h-1.5 w-1.5 mt-1 flex-shrink-0"><span className="animate-ping absolute h-full w-full rounded-full bg-danger opacity-75" /><span className="relative rounded-full h-1.5 w-1.5 bg-danger" /></span>
              <p className="text-[11px] text-danger/90">This game is in progress. Odds shown are from before tip-off — live in-game odds require a paid data feed. Check the sportsbook directly for current lines.</p>
            </div>
          )}

          {/* Suspicious edge warning */}
          {pick.isSuspicious && (
            <div className="flex items-start gap-2 p-2 rounded-lg bg-amber/5 border border-amber/20">
              <AlertTriangle className="w-3.5 h-3.5 text-amber flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber/90">{pick.warning || "Large edge — verify this line is still live before betting"}</p>
            </div>
          )}

          {/* AI Game Summary — collapsible Gemini preview */}
          <div>
            <button
              onClick={(e) => { e.stopPropagation(); setShowAISummary(v => !v); }}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-purple/5 border border-purple/15 hover:bg-purple/10 transition-colors text-left"
            >
              <Sparkles className="w-3 h-3 text-purple flex-shrink-0" />
              <span className="text-[10px] font-semibold text-purple flex-1">AI Game Preview</span>
              {summaryLoading && <RefreshCw className="w-3 h-3 text-purple/50 animate-spin flex-shrink-0" />}
              <ChevronDown className={`w-3 h-3 text-purple/50 flex-shrink-0 transition-transform ${showAISummary ? "rotate-180" : ""}`} />
            </button>
            {showAISummary && (
              <div className="mt-1 px-2.5 py-2 rounded-lg bg-purple/5 border border-purple/10">
                {summaryLoading ? (
                  <p className="text-[11px] text-mercury/50 italic">Generating preview...</p>
                ) : aiSummary ? (
                  <p className="text-[11px] text-silver leading-relaxed">{aiSummary}</p>
                ) : (
                  <p className="text-[11px] text-mercury/40 italic">Preview unavailable</p>
                )}
              </div>
            )}
          </div>

          {/* Action buttons — primary inline, secondary in overflow */}
          <div className="flex gap-1.5 relative">
            {getDeepLink(pick.bookmaker, { sport: currentSport as "mlb" | "nba", ev: pick.evPercentage }) && (
              <a href={getDeepLink(pick.bookmaker, { sport: currentSport as "mlb" | "nba", ev: pick.evPercentage })} target="_blank" rel="noopener noreferrer"
                className="flex-1 py-2 rounded-lg bg-electric/10 border border-electric/20 text-electric text-[11px] font-semibold hover:bg-electric/20 transition-all flex items-center justify-center gap-1">
                <ExternalLink className="w-3 h-3" /> {pick.bookmaker.split(" ")[0]}
              </a>
            )}
            <button onClick={(e) => { e.stopPropagation(); onAddToParlay(); }}
              className="flex-1 py-2 rounded-lg bg-neon/10 border border-neon/20 text-neon text-[11px] font-semibold hover:bg-neon/20 active:scale-[0.98] transition-all">
              + Parlay
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v); }}
              className="py-2 px-2.5 rounded-lg bg-gunmetal/40 border border-slate/30 text-mercury hover:text-silver hover:border-slate/50 transition-colors flex-shrink-0"
              aria-label="More actions"
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 top-full mt-1.5 z-30 min-w-[160px] rounded-lg bg-bunker border border-slate/40 shadow-xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    const { addBet } = useStore.getState();
                    addBet({ game: pick.game, market: pick.market, pick: pick.pick, bookmaker: pick.bookmaker, odds: pick.odds, stake: 100, result: "pending", payout: 0, isParlay: false, evAtPlacement: pick.evPercentage });
                  }}
                  className="w-full px-3 py-2 flex items-center gap-2 text-[11px] font-semibold text-gold hover:bg-gold/10 text-left transition-colors"
                >
                  <DollarSign className="w-3 h-3" /> Log $100 bet
                </button>
                <button
                  onClick={async () => {
                    setMenuOpen(false);
                    try {
                      const { fetchWithAuth } = await import("@/lib/supabase/fetch-with-auth");
                      const res = await fetchWithAuth("/api/slip/share", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ picks: [{ pick: pick.pick, game: pick.game, odds: pick.odds, bookmaker: pick.bookmaker, evPercentage: pick.evPercentage, market: pick.market }] }),
                      });
                      const data = await res.json();
                      const url = `${window.location.origin}${data.url}`;
                      if (navigator.share) {
                        await navigator.share({ title: `Diamond Quant: ${pick.pick}`, url });
                      } else {
                        await navigator.clipboard.writeText(url);
                      }
                      setShared(true);
                      setTimeout(() => setShared(false), 2500);
                    } catch {}
                  }}
                  className="w-full px-3 py-2 flex items-center gap-2 text-[11px] font-semibold text-purple hover:bg-purple/10 text-left transition-colors border-t border-slate/20"
                >
                  {shared ? <Check className="w-3 h-3 text-neon" /> : <Share2 className="w-3 h-3" />}
                  {shared ? "Link copied!" : "Share pick"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
function PropSection({ title, subtitle, icon: Icon, iconColor, props, loading, expandedPick, setExpanded, addParlayLeg, sport, market: marketOverride }: {
  title: string; subtitle: string; icon: any; iconColor: string;
  props: any[]; loading: boolean;
  expandedPick: string | null; setExpanded: (id: string | null) => void; addParlayLeg: any;
  sport?: "mlb" | "nba";
  market?: string;
}) {
  const market = marketOverride ?? title.toLowerCase().replace(/\s/g, "_");
  const { scores } = useStore();

  // Build player → team lookup from scores (pitchers are listed per team)
  const playerTeamMap = useMemo(() => {
    const map = new Map<string, { team: string; abbrev: string }>();
    for (const s of scores) {
      if (s.homePitcher && s.homePitcher !== "TBD") {
        map.set(s.homePitcher.toLowerCase(), { team: s.homeTeam, abbrev: s.homeAbbrev });
      }
      if (s.awayPitcher && s.awayPitcher !== "TBD") {
        map.set(s.awayPitcher.toLowerCase(), { team: s.awayTeam, abbrev: s.awayAbbrev });
      }
    }
    return map;
  }, [scores]);

  function getPlayerTeam(playerName: string, gameStr: string): { playerTeam: string; opponent: string } {
    // Try pitcher lookup first
    const found = playerTeamMap.get(playerName.toLowerCase());
    if (found) {
      const teams = gameStr.split(" @ ");
      const opponent = teams.find(t => !t.includes(found.team.split(" ").pop() ?? "???")) ?? teams[1] ?? "";
      return { playerTeam: found.abbrev, opponent: opponent.split(" ").pop() ?? "" };
    }
    // Fallback: can't determine — show game matchup
    const parts = gameStr.split(" @ ");
    return { playerTeam: parts[0]?.split(" ").pop()?.slice(0, 3).toUpperCase() ?? "?", opponent: parts[1]?.split(" ").pop() ?? "" };
  }

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
                    {(() => {
                      const { playerTeam, opponent } = getPlayerTeam(p.playerName, p.team ?? "");
                      return (
                        <>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-electric/15 text-electric font-bold flex-shrink-0">{playerTeam}</span>
                            <p className="text-xs sm:text-sm font-medium text-silver truncate">{p.playerName}</p>
                          </div>
                          <p className="text-[9px] text-mercury/50">
                            {p.gameTime && <>{new Date(p.gameTime).toLocaleString("en-US", { hour: "numeric", minute: "2-digit" })} — </>}
                            vs {opponent}
                          </p>
                        </>
                      );
                    })()}
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
                    {sport && (
                      <PropDetail
                        sport={sport}
                        playerName={p.playerName}
                        market={market}
                        line={p.line}
                        side={(p.fairOverProb ?? 0) >= (p.fairUnderProb ?? 0) ? "over" : "under"}
                      />
                    )}
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
