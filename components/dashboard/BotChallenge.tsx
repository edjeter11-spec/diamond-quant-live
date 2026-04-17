"use client";

import { useState, useEffect, useMemo } from "react";
import { useStore } from "@/lib/store";
import { useSport } from "@/lib/sport-context";
import {
  Bot, Brain, TrendingUp, BarChart3, Target,
  ChevronDown, RefreshCw, CheckCircle, XCircle, Minus, Clock,
  Flame, Zap, DollarSign, Crown, Activity,
} from "lucide-react";
import {
  loadSmartBot, saveSmartBot, generateSmartPicks, settleAndLearn,
  loadModelAccuracy, type SmartBotState, type SmartBotPick, type ModelAccuracy,
} from "@/lib/bot/smart-picks";
import {
  loadCLVRecords, saveCLVRecords, trackBet, updateClosingOdds, getCLVSummary,
  type CLVRecord,
} from "@/lib/bot/clv-tracker";
import { loadEloState, saveEloState, updateElo } from "@/lib/bot/elo";
import { useAuth } from "@/lib/supabase/auth";
import type { GameAnalysis } from "@/lib/bot/three-models";
import TeamLogo from "@/components/ui/TeamLogo";
import PlayerAvatar from "@/components/ui/PlayerAvatar";
import BrainPickDetail from "@/components/dashboard/BrainPickDetail";
import type { BrainReasoning } from "@/lib/bot/prop-reasoning";
import { formatPickLabel } from "@/lib/display";

export default function BotChallenge() {
  const { scores } = useStore();
  const { currentSport, config } = useSport();
  const { isAdmin } = useAuth();
  const isNBA = currentSport === "nba";

  // Sport-specific storage keys
  const storageKey = isNBA ? "dq_smart_bot_nba" : "dq_smart_bot";
  const [botState, setBotState] = useState<SmartBotState>(() => {
    if (typeof window === "undefined") return { bankroll: 5000, picks: [], dailyPnL: {} };
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) return JSON.parse(stored);
    } catch {}
    return { bankroll: 5000, picks: [], dailyPnL: {} };
  });
  const [accuracy, setAccuracy] = useState<ModelAccuracy>(loadModelAccuracy);
  const [analyses, setAnalyses] = useState<GameAnalysis[]>([]);
  const [expandedPick, setExpandedPick] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // CLV tracking state
  const [clvRecords, setClvRecords] = useState<CLVRecord[]>(() => {
    if (typeof window === "undefined") return [];
    return loadCLVRecords(currentSport);
  });

  const clvSummary = useMemo(() => getCLVSummary(clvRecords), [clvRecords]);

  const [expandedPropPick, setExpandedPropPick] = useState<string | null>(null);

  // Today's server-generated prop picks (refreshed every 2 hrs)
  const [todayPropPicks, setTodayPropPicks] = useState<Array<{
    playerName: string; team: string; propType: string; market: string;
    line: number; side: "over" | "under"; probability: number;
    projectedValue: number; odds: number; bookmaker: string;
    gameTime: string; brainConfidence: number;
    reasoning?: BrainReasoning; seasonAvg?: number; last5Avg?: number;
  }>>([]);
  const [propPicksLoading, setPropPicksLoading] = useState(false);
  const [propPicksUpdatedAt, setPropPicksUpdatedAt] = useState<string | null>(null);

  // Training state
  const [training, setTraining] = useState(false);
  const [trainingProgress, setTrainingProgress] = useState<any>(null);

  const startTraining = async () => {
    setTraining(true);
    setTrainingProgress({ status: "running", message: "Starting..." });
    try {
      const { fetchWithAuth } = await import("@/lib/supabase/fetch-with-auth");
      const res = await fetchWithAuth("/api/nba-prop-train?reset=true&seasons=2022,2023,2024");
      const data = await res.json();
      if (!res.ok) {
        setTrainingProgress({ status: "error", error: data.error ?? "Training failed" });
        setTraining(false);
        return;
      }
      setTrainingProgress({ status: "complete", ...data });
    } catch (err: any) {
      setTrainingProgress({ status: "error", error: err.message });
    }
    setTraining(false);
  };

  // Evolution state
  const [evolving, setEvolving] = useState(false);
  const [evolutionResult, setEvolutionResult] = useState<any>(null);

  // Load persisted brain, training, and evolution results on mount (NBA only)
  useEffect(() => {
    if (!isNBA) return;
    import("@/lib/supabase/client").then(({ cloudGet }) => {
      // Load training progress
      cloudGet("nba_prop_training_progress", null).then((data: any) => {
        if (data?.status === "complete") setTrainingProgress(data);
      });
      // Load evolution state
      cloudGet("nba_brain_evolution", null).then((data: any) => {
        if (data?.status === "complete") setEvolutionResult({ ok: true, ...data });
      });
      // Load brain summary for display
      cloudGet("nba_prop_brain", null).then((brain: any) => {
        if (brain?.isPreTrained && brain.totalGamesProcessed > 0) {
          // Show brain stats even without explicit training progress
          setTrainingProgress((prev: any) => prev ?? {
            status: "complete",
            gamesProcessed: brain.totalGamesProcessed,
            propEventsTotal: brain.totalPredictions,
            playersTracked: Object.keys(brain.playerMemory ?? {}).length,
            accuracy: brain.markets ? {
              player_points: { total: brain.markets.player_points?.totalPredictions ?? 0, hits: brain.markets.player_points?.hits ?? 0, winRate: brain.markets.player_points?.winRate ?? 0 },
              player_rebounds: { total: brain.markets.player_rebounds?.totalPredictions ?? 0, hits: brain.markets.player_rebounds?.hits ?? 0, winRate: brain.markets.player_rebounds?.winRate ?? 0 },
              player_assists: { total: brain.markets.player_assists?.totalPredictions ?? 0, hits: brain.markets.player_assists?.hits ?? 0, winRate: brain.markets.player_assists?.winRate ?? 0 },
            } : {},
          });
        }
      });
    }).catch(() => {});
  }, [isNBA]);

  const startEvolution = async () => {
    setEvolving(true);
    setEvolutionResult(null);
    try {
      const { fetchWithAuth } = await import("@/lib/supabase/fetch-with-auth");
      const res = await fetchWithAuth("/api/nba-prop-evolve?generations=3");
      const data = await res.json();
      if (!res.ok) {
        setEvolutionResult({ ok: false, error: data.error ?? "Evolution failed" });
        setEvolving(false);
        return;
      }
      setEvolutionResult(data);
    } catch (err: any) {
      setEvolutionResult({ ok: false, error: err.message });
    }
    setEvolving(false);
  };

  // Poll training progress
  useEffect(() => {
    if (!training) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/nba-prop-train-status");
        const data = await res.json();
        setTrainingProgress(data);
        if (data.status === "complete" || data.status === "error") {
          setTraining(false);
          clearInterval(interval);
        }
      } catch {}
    }, 5000);
    return () => clearInterval(interval);
  }, [training]);

  // Fetch server-generated prop picks (refreshed every 2 hrs by the API)
  useEffect(() => {
    if (!isNBA) { setTodayPropPicks([]); return; }
    async function fetchPropPicks(force = false) {
      setPropPicksLoading(true);
      try {
        const res = await fetch(`/api/prop-picks-today${force ? "?force=true" : ""}`);
        if (res.ok) {
          const data = await res.json();
          if (data.picks?.length > 0) {
            setTodayPropPicks(data.picks);
            setPropPicksUpdatedAt(data.updatedAt ?? data.generatedAt ?? null);
          }
        }
      } catch {}
      setPropPicksLoading(false);
    }
    fetchPropPicks(); // use cached picks (2hr TTL), only force on manual refresh
    // Auto-refresh every 90 minutes
    const interval = setInterval(() => fetchPropPicks(), 90 * 60 * 1000);
    return () => clearInterval(interval);
  }, [isNBA]);

  // Reload bot state + CLV when sport changes
  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) setBotState(JSON.parse(stored));
      else setBotState({ bankroll: 5000, picks: [], dailyPnL: {} });
    } catch {
      setBotState({ bankroll: 5000, picks: [], dailyPnL: {} });
    }
    setClvRecords(loadCLVRecords(currentSport));
  }, [currentSport, storageKey]);

  // Fetch sport-specific analysis + load pre-generated picks from Supabase
  useEffect(() => {
    async function init() {
      try {
        const today = new Date().toISOString().split("T")[0];
        const cloudKey = isNBA ? "smart_bot_nba" : "smart_bot";
        const todayKey = isNBA ? `smart_bot_today_nba_${today}` : `smart_bot_today_mlb_${today}`;

        // Try to load pre-generated picks from Supabase (set by cron for all users)
        const { cloudGet } = await import("@/lib/supabase/client");
        const [cloudBotState, todayPregen] = await Promise.all([
          cloudGet(cloudKey, null) as Promise<SmartBotState | null>,
          cloudGet(todayKey, null) as Promise<{ picks: any[]; generatedAt: string } | null>,
        ]);

        // Merge cloud state into local if user has no local picks for today
        if (cloudBotState) {
          setBotState(prev => {
            const localToday = prev.picks.filter(p => p.date === today).length;
            if (localToday === 0 && cloudBotState.picks.length > 0) {
              return cloudBotState;
            }
            return prev;
          });
        } else if (todayPregen?.picks?.length) {
          // Load pre-generated picks into local state
          setBotState(prev => {
            const localToday = prev.picks.filter(p => p.date === today).length;
            if (localToday === 0) {
              return { ...prev, picks: [...prev.picks, ...todayPregen.picks] };
            }
            return prev;
          });
        }

        const url = isNBA ? "/api/nba-analysis" : "/api/bot-analysis";
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          setAnalyses(data.analyses ?? []);
        }
      } catch {}
      setLoading(false);
    }
    init();
  }, [currentSport, isNBA]);

  // Auto-generate picks when analyses arrive and we don't have today's
  useEffect(() => {
    if (analyses.length === 0) return;
    const today = new Date().toISOString().split("T")[0];
    const hasTodayPicks = botState.picks.filter(p => p.date === today).length >= 4;
    if (hasTodayPicks) return;

    const newPicks = generateSmartPicks(analyses, botState.bankroll);
    if (newPicks.length > 0) {
      const updated: SmartBotState = {
        ...botState,
        picks: [...botState.picks, ...newPicks],
        bankroll: botState.bankroll - newPicks.reduce((s, p) => s + p.stake, 0),
      };
      saveSmartBot(updated, currentSport);
      setBotState(updated);

      // Track new picks in CLV (opening odds = bet odds)
      const updatedCLV = newPicks.reduce((recs, pick) => {
        return trackBet(recs, {
          id: pick.id, date: pick.date, game: pick.game, pick: pick.pick,
          bookmaker: pick.bookmaker, odds: pick.odds, sport: currentSport,
        });
      }, clvRecords);
      saveCLVRecords(updatedCLV, currentSport);
      setClvRecords(updatedCLV);
    }
  }, [analyses]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-settle + learn + update CLV + update Elo when scores arrive
  useEffect(() => {
    if (scores.length === 0) return;
    const { botState: updated, accuracy: newAcc } = settleAndLearn(botState, scores, currentSport);
    if (updated !== botState) {
      setBotState(updated);
      setAccuracy(newAcc);

      // Find picks that just transitioned from pending → settled
      const newlySettled = updated.picks.filter(p =>
        p.result !== "pending" &&
        botState.picks.find(prev => prev.id === p.id)?.result === "pending"
      );

      if (newlySettled.length > 0) {
        // --- Update Elo ratings from settled game results ---
        let eloState = loadEloState(currentSport);
        for (const pick of newlySettled) {
          if (!pick.finalScore) continue;
          const parts = pick.game.split(" @ ");
          if (parts.length !== 2) continue;
          const [awayTeam, homeTeam] = parts;
          // finalScore format: "CHC 3 - NYY 7"
          const scoreMatch = pick.finalScore.match(/\S+\s+(\d+)\s*-\s*\S+\s+(\d+)/);
          if (!scoreMatch) continue;
          const awayScore = parseInt(scoreMatch[1]);
          const homeScore = parseInt(scoreMatch[2]);
          if (isNaN(awayScore) || isNaN(homeScore)) continue;
          eloState = updateElo(eloState, homeTeam, awayTeam, homeScore > awayScore, Math.abs(homeScore - awayScore));
        }
        saveEloState(eloState);

        // --- Fetch closing odds and update CLV for settled picks ---
        fetch("/api/odds")
          .then(r => r.json())
          .then((oddsGames: any[]) => {
            // Build closing-odds map: "Team ML" → current odds
            const allClosingOdds: Record<string, number> = {};
            for (const game of oddsGames) {
              if (!game.homeTeam || !game.awayTeam) continue;
              let bestHome = 0, bestAway = 0;
              for (const line of game.oddsLines ?? []) {
                if (line.homeML !== 0 && (bestHome === 0 || Math.abs(line.homeML) < Math.abs(bestHome))) {
                  bestHome = line.homeML;
                }
                if (line.awayML !== 0 && (bestAway === 0 || Math.abs(line.awayML) < Math.abs(bestAway))) {
                  bestAway = line.awayML;
                }
              }
              if (bestHome !== 0) allClosingOdds[`${game.homeTeam} ML`] = bestHome;
              if (bestAway !== 0) allClosingOdds[`${game.awayTeam} ML`] = bestAway;
            }

            // Update CLV records: closing odds + result
            let updatedCLV = clvRecords;
            for (const pick of newlySettled) {
              updatedCLV = updateClosingOdds(updatedCLV, pick.game, allClosingOdds);
              updatedCLV = updatedCLV.map(r =>
                r.id === pick.id ? { ...r, result: pick.result } : r
              );
            }
            saveCLVRecords(updatedCLV, currentSport);
            setClvRecords(updatedCLV);
          })
          .catch(() => {});
      }
    }
  }, [scores]); // eslint-disable-line react-hooks/exhaustive-deps

  const formatOdds = (odds: number) => (odds > 0 ? `+${odds}` : `${odds}`);
  const today = new Date().toISOString().split("T")[0];
  const todayPicks = botState.picks.filter(p => p.date === today);
  const settled = botState.picks.filter(p => p.result !== "pending");
  const pendingPicks = botState.picks.filter(p => p.result === "pending");
  const wins = settled.filter(p => p.result === "win").length;
  const losses = settled.filter(p => p.result === "loss").length;
  const totalStaked = settled.reduce((s, p) => s + p.stake, 0);
  const totalReturns = settled.reduce((s, p) => s + p.payout, 0);
  const pendingStaked = pendingPicks.reduce((s, p) => s + p.stake, 0);
  const settledProfit = totalReturns - totalStaked;
  // ROI from settled bets
  const settledROI = totalStaked > 0 ? (settledProfit / totalStaked) * 100 : 0;
  // Overall P&L = bankroll change from $5000 (includes pending exposure)
  const overallPL = botState.bankroll - 5000;
  // Display: use settled stats if available, otherwise show bankroll-based numbers
  const displayROI = settled.length > 0 ? settledROI : (overallPL !== 0 ? (overallPL / 5000) * 100 : 0);
  const displayPL = settled.length > 0 ? settledProfit : overallPL;
  const pending = pendingPicks.length;

  // Build CLV record map for quick lookup by pick ID
  const clvMap = useMemo(() => {
    const map = new Map<string, CLVRecord>();
    for (const r of clvRecords) map.set(r.id, r);
    return map;
  }, [clvRecords]);

  return (
    <div className="space-y-3">
      {/* Header Card */}
      <div className="glass rounded-xl overflow-hidden border border-electric/20">
        <div className="px-4 py-3 bg-gradient-to-r from-electric/10 to-purple/5 border-b border-electric/15 flex items-center gap-3">
          <Bot className="w-5 h-5 text-electric" />
          <div className="flex-1">
            <h2 className="text-sm font-bold text-silver">Bot Challenge — 3-Model Powered</h2>
            <p className="text-[10px] text-mercury/60">$5K sim • 4 picks/day • {config.model1Label} + Market + {config.model3Label} consensus</p>
          </div>
          <div className="text-right">
            <p className={`text-lg font-bold font-mono ${botState.bankroll >= 5000 ? "text-neon" : "text-danger"}`}>
              ${botState.bankroll.toFixed(0)}
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-px bg-slate/10">
          <MiniStat label="Record" value={`${wins}W-${losses}L`} color="text-silver" />
          <MiniStat label="ROI" value={`${displayROI >= 0 ? "+" : ""}${displayROI.toFixed(1)}%`} color={displayROI >= 0 ? "text-neon" : "text-danger"} />
          <MiniStat label="P/L" value={`${displayPL >= 0 ? "+" : ""}$${displayPL.toFixed(0)}`} color={displayPL >= 0 ? "text-neon" : "text-danger"} />
          <MiniStat label="In Play" value={pending > 0 ? `$${pendingStaked.toFixed(0)}` : "—"} color="text-amber" />
        </div>

        {/* Per-Model Accuracy — NBA shows Prop Brain accuracy, MLB shows 3-model accuracy */}
        {isNBA ? (
          trainingProgress?.accuracy && Object.keys(trainingProgress.accuracy).length > 0 && (
            <div className="px-4 py-2 border-t border-slate/10">
              <p className="text-[9px] text-mercury uppercase tracking-wider mb-1.5 font-semibold">Prop Brain Accuracy (trained)</p>
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(trainingProgress.accuracy as Record<string, any>).map(([key, val]: [string, any]) => (
                  <div key={key} className="text-center">
                    <Brain className={`w-3 h-3 mx-auto mb-0.5 ${val.winRate > 50 ? "text-neon" : "text-amber"}`} />
                    <p className={`text-xs font-bold font-mono ${val.winRate > 50 ? "text-neon" : val.winRate > 45 ? "text-electric" : "text-danger"}`}>
                      {val.winRate}%
                    </p>
                    <p className="text-[7px] text-mercury/50 capitalize">{key.replace("player_", "")} ({val.total ?? 0})</p>
                  </div>
                ))}
              </div>
            </div>
          )
        ) : (
          accuracy.consensus.total > 0 && (
            <div className="px-4 py-2 border-t border-slate/10">
              <p className="text-[9px] text-mercury uppercase tracking-wider mb-1.5 font-semibold">Model Accuracy (live tracking)</p>
              <div className="grid grid-cols-4 gap-2">
                <ModelAccStat name={config.model1Label} icon={Brain} color="text-purple" acc={accuracy.pitcher} />
                <ModelAccStat name="Market" icon={BarChart3} color="text-electric" acc={accuracy.market} />
                <ModelAccStat name={config.model3Label} icon={Activity} color="text-neon" acc={accuracy.trend} />
                <ModelAccStat name="Consensus" icon={Target} color="text-gold" acc={accuracy.consensus} />
              </div>
            </div>
          )
        )}

        {/* CLV Summary — shown once we have closing-line data */}
        {clvSummary.betsWithCLV > 0 && (
          <div className="px-4 py-2 border-t border-slate/10">
            <p className="text-[9px] text-mercury uppercase tracking-wider mb-1.5 font-semibold flex items-center gap-1">
              <Activity className="w-3 h-3" /> Closing Line Value
            </p>
            <div className="grid grid-cols-3 gap-2">
              <div className="text-center">
                <p className={`text-xs font-bold font-mono ${clvSummary.beatClosingRate >= 55 ? "text-neon" : clvSummary.beatClosingRate >= 45 ? "text-electric" : "text-danger"}`}>
                  {clvSummary.beatClosingRate}%
                </p>
                <p className="text-[7px] text-mercury/50">Beat-Close</p>
              </div>
              <div className="text-center">
                <p className={`text-xs font-bold font-mono ${clvSummary.avgCLV >= 0 ? "text-neon" : "text-danger"}`}>
                  {clvSummary.avgCLV >= 0 ? "+" : ""}{clvSummary.avgCLV}%
                </p>
                <p className="text-[7px] text-mercury/50">Avg CLV</p>
              </div>
              <div className="text-center">
                <p className={`text-xs font-bold font-mono ${clvSummary.isSharp ? "text-gold" : "text-mercury/60"}`}>
                  {clvSummary.isSharp ? "SHARP" : `${clvSummary.betsWithCLV} pts`}
                </p>
                <p className="text-[7px] text-mercury/50">{clvSummary.isSharp ? "Sharp Bettor" : "Sample Size"}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* NBA Brain — Public sees status, Admin sees controls */}
      {isNBA && (
        <div className="glass rounded-xl overflow-hidden border border-purple/15">
          <div className="px-4 py-3 bg-gradient-to-r from-purple/10 to-electric/5 border-b border-purple/15 flex items-center gap-2">
            <Brain className="w-4 h-4 text-purple" />
            <div className="flex-1">
              <h3 className="text-xs font-bold text-silver uppercase tracking-wider">NBA Prop Brain</h3>
              <p className="text-[9px] text-mercury/50">
                {trainingProgress?.status === "complete"
                  ? `Trained on ${trainingProgress.gamesProcessed?.toLocaleString()} games — ${trainingProgress.propEventsTotal?.toLocaleString()} props quizzed`
                  : evolutionResult?.ok
                  ? `Evolved ${evolutionResult.generations} generations — Best: ${evolutionResult.bestWinRate}%`
                  : "AI-powered player prop predictions"}
              </p>
            </div>
            {/* Admin-only: Training + Evolution buttons */}
            {isAdmin && !training && !evolving && (
              <div className="flex gap-1">
                <button onClick={startTraining} className="px-2 py-1 rounded-lg bg-purple/15 border border-purple/25 text-purple text-[9px] font-semibold hover:bg-purple/25 transition-all">
                  Train
                </button>
                <button onClick={startEvolution} className="px-2 py-1 rounded-lg bg-neon/15 border border-neon/25 text-neon text-[9px] font-semibold hover:bg-neon/25 transition-all">
                  Evolve
                </button>
              </div>
            )}
          </div>
          {/* Training progress (admin only) */}
          {training && trainingProgress && (
            <div className="px-4 py-3 space-y-2">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-3.5 h-3.5 text-purple animate-spin" />
                <p className="text-xs text-mercury">{trainingProgress.message ?? "Training..."}</p>
              </div>
              {trainingProgress.gamesProcessed > 0 && (
                <div className="w-full bg-gunmetal/50 rounded-full h-1.5">
                  <div className="bg-purple h-1.5 rounded-full transition-all" style={{ width: `${Math.min(100, (trainingProgress.gamesProcessed / Math.max(trainingProgress.totalGames, 1)) * 100)}%` }} />
                </div>
              )}
            </div>
          )}
          {/* Evolution progress */}
          {evolving && (
            <div className="px-4 py-3 flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 text-neon animate-spin" />
              <p className="text-xs text-neon">Evolving — breeding variants, testing on held-out data...</p>
            </div>
          )}
          {/* Training/Evolution results — visible to all */}
          {(trainingProgress?.status === "complete" && trainingProgress.accuracy) && (
            <div className="px-4 py-2.5 border-t border-slate/10">
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(trainingProgress.accuracy as Record<string, any>).map(([key, val]: [string, any]) => (
                  <div key={key} className="text-center">
                    <p className={`text-sm font-bold font-mono ${val.winRate > 52 ? "text-neon" : val.winRate > 48 ? "text-electric" : "text-danger"}`}>{val.winRate}%</p>
                    <p className="text-[7px] text-mercury/50 uppercase">{key.replace("player_", "")}</p>
                  </div>
                ))}
              </div>
              {trainingProgress.playersTracked && (
                <p className="text-[9px] text-mercury/40 text-center mt-1">{trainingProgress.playersTracked} players tracked</p>
              )}
            </div>
          )}
          {/* Evolution results */}
          {evolutionResult?.ok && (
            <div className="px-4 py-2.5 border-t border-slate/10 space-y-2">
              <div className="flex items-center gap-2">
                <Crown className="w-3.5 h-3.5 text-gold" />
                <p className="text-xs text-silver font-semibold">
                  Best: {evolutionResult.bestVariant} — <span className="text-neon font-mono">{evolutionResult.bestWinRate}%</span> test accuracy
                </p>
              </div>
              {/* Generation history */}
              {evolutionResult.history?.map((h: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-[10px] text-mercury/60">
                  <span className="w-12 text-mercury/40">Gen {h.generation}</span>
                  <span className="flex-1 truncate">{h.winnerName}</span>
                  <span className={`font-mono font-bold ${h.winRate > 50 ? "text-neon" : "text-amber"}`}>{h.winRate}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Today's Picks Status */}
      {loading ? (
        <div className="glass rounded-xl p-4 flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 text-electric animate-spin" />
          <span className="text-sm text-mercury">Running 3-model analysis...</span>
        </div>
      ) : todayPicks.length === 0 ? (
        <div className="glass rounded-xl p-4 text-center">
          <p className="text-sm text-mercury">Waiting for enough game data to generate picks</p>
          <p className="text-[10px] text-mercury/50 mt-1">Picks auto-generate from 3-model consensus — no manual action needed</p>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-neon/5 border border-neon/15">
          <CheckCircle className="w-3.5 h-3.5 text-neon" />
          <span className="text-xs text-neon font-medium">Today's {todayPicks.length} picks locked — generated from 3-model analysis</span>
        </div>
      )}

      {/* Today's Picks */}
      {todayPicks.length > 0 && (
        <div className="glass rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate/30 bg-electric/5 flex items-center gap-2">
            <Zap className="w-4 h-4 text-electric" />
            <span className="text-xs font-bold text-silver uppercase tracking-wider">Today's Picks</span>
          </div>
          <div className="divide-y divide-slate/10">
            {todayPicks.map(pick => (
              <PickRow
                key={pick.id}
                pick={pick}
                clvRecord={clvMap.get(pick.id)}
                isExpanded={expandedPick === pick.id}
                onToggle={() => setExpandedPick(expandedPick === pick.id ? null : pick.id)}
                formatOdds={formatOdds}
              />
            ))}
          </div>
        </div>
      )}

      {/* TODAY'S PROP PICKS — Server-generated, refreshed every 2hrs */}
      {isNBA && (
        <div className="glass rounded-xl overflow-hidden border border-purple/20">
          <div className="px-4 py-2.5 bg-gradient-to-r from-purple/10 to-neon/5 border-b border-purple/15 flex items-center gap-2">
            <Brain className="w-4 h-4 text-purple" />
            <div className="flex-1">
              <h3 className="text-xs font-bold text-silver uppercase tracking-wider">Today's Prop Picks</h3>
              <p className="text-[9px] text-mercury/50">
                {propPicksUpdatedAt
                  ? `Updated ${Math.round((Date.now() - new Date(propPicksUpdatedAt).getTime()) / 60000)}m ago • auto-refreshes every 2h`
                  : "Brain selects 4 best props each morning, updates lines hourly"}
              </p>
            </div>
            <button
              onClick={async () => {
                setPropPicksLoading(true);
                try {
                  const res = await fetch("/api/prop-picks-today?force=true");
                  if (res.ok) {
                    const data = await res.json();
                    if (data.picks?.length > 0) {
                      setTodayPropPicks(data.picks);
                      setPropPicksUpdatedAt(data.updatedAt ?? data.generatedAt);
                    }
                  }
                } catch {}
                setPropPicksLoading(false);
              }}
              className="p-1.5 hover:bg-gunmetal/30 rounded transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-mercury ${propPicksLoading ? "animate-spin" : ""}`} />
            </button>
          </div>

          {propPicksLoading && todayPropPicks.length === 0 ? (
            <div className="px-4 py-6 flex items-center justify-center gap-2">
              <Brain className="w-4 h-4 text-purple animate-pulse" />
              <span className="text-xs text-mercury">Brain analyzing today's props...</span>
            </div>
          ) : (
            <div className="divide-y divide-slate/10">
              {todayPropPicks.map((prop, i) => {
                const tier = (prop as any).tier as "HIGH" | "MEDIUM" | "LEAN" | undefined;
                const tierColor = tier === "HIGH" ? "bg-neon/15 text-neon border-neon/20"
                  : tier === "MEDIUM" ? "bg-amber/15 text-amber border-amber/20"
                  : "bg-electric/10 text-electric border-electric/20";
                const pickKey = `${prop.playerName}-${prop.propType}-${i}`;
                const isExpanded = expandedPropPick === pickKey;
                return (
                  <div key={i}>
                    <button
                      onClick={() => setExpandedPropPick(isExpanded ? null : pickKey)}
                      className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gunmetal/20 text-left transition-colors"
                    >
                      {/* Rank */}
                      <span className={`w-6 h-6 rounded-full text-[9px] font-bold flex items-center justify-center flex-shrink-0 ${
                        i === 0 ? "bg-gold/20 text-gold" : "bg-purple/20 text-purple"
                      }`}>{i + 1}</span>

                      {/* Player */}
                      <PlayerAvatar name={prop.playerName} size={26} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-semibold text-silver truncate">{prop.playerName}</p>
                          {tier && (
                            <span className={`text-[7px] font-bold px-1 py-0.5 rounded border flex-shrink-0 ${tierColor}`}>
                              {tier}
                            </span>
                          )}
                          {!(prop as any).liveOdds && (
                            <span className="text-[7px] px-1 py-0.5 rounded border border-mercury/20 text-mercury/40 flex-shrink-0">PROJ</span>
                          )}
                        </div>
                        <p className="text-[9px] text-mercury/60">
                          {prop.team} • {prop.propType}
                          {prop.gameTime ? ` • ${new Date(prop.gameTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : " • Brain projection"}
                        </p>
                      </div>

                      {/* Pick */}
                      <div className="flex flex-col items-end flex-shrink-0 gap-0.5">
                        <div className="flex items-center gap-1">
                          <span className={`text-xs font-bold font-mono ${prop.side === "over" ? "text-neon" : "text-purple"}`}>
                            {prop.side === "over" ? "OVER" : "UNDER"} {prop.line}
                          </span>
                          {prop.odds !== 0 && (
                            <span className="text-[9px] text-mercury/70 font-mono">
                              ({prop.odds > 0 ? "+" : ""}{prop.odds})
                            </span>
                          )}
                        </div>
                        <span className="text-[8px] text-mercury/50">Proj: {prop.projectedValue} • {prop.brainConfidence}% conf</span>
                      </div>
                      <ChevronDown className={`w-3.5 h-3.5 text-mercury/40 flex-shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                    </button>

                    {isExpanded && prop.reasoning && (
                      <div className="px-4 pb-3 animate-slide-up">
                        <BrainPickDetail
                          reasoning={prop.reasoning}
                          seasonAvg={prop.seasonAvg}
                          last5Avg={prop.last5Avg}
                          projectedValue={prop.projectedValue}
                          probability={prop.probability}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
              {todayPropPicks.length === 0 && (
                <div className="px-4 py-5 text-center">
                  <p className="text-[10px] text-mercury/50">Odds not yet posted for today — picks generate at tip-off</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* History */}
      {botState.picks.length > todayPicks.length && (
        <div className="glass rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate/30 flex items-center gap-2">
            <Clock className="w-4 h-4 text-mercury" />
            <span className="text-xs font-bold text-silver uppercase tracking-wider">History</span>
          </div>
          <div className="divide-y divide-slate/10 max-h-[300px] overflow-y-auto">
            {[...botState.picks].reverse().filter(p => p.date !== today).slice(0, 16).map(pick => (
              <PickRow
                key={pick.id}
                pick={pick}
                clvRecord={clvMap.get(pick.id)}
                isExpanded={expandedPick === pick.id}
                onToggle={() => setExpandedPick(expandedPick === pick.id ? null : pick.id)}
                formatOdds={formatOdds}
                compact
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PickRow({ pick, clvRecord, isExpanded, onToggle, formatOdds, compact }: {
  pick: SmartBotPick; clvRecord?: CLVRecord; isExpanded: boolean; onToggle: () => void;
  formatOdds: (n: number) => string; compact?: boolean;
}) {
  const { config } = useSport();
  const resultStyles: Record<string, string> = {
    win: "bg-neon/15 text-neon", loss: "bg-danger/15 text-danger",
    push: "bg-mercury/15 text-mercury", pending: "bg-amber/15 text-amber",
  };

  return (
    <div>
      <button onClick={onToggle} className="w-full px-3 sm:px-4 py-2.5 flex items-center gap-2 hover:bg-gunmetal/20 text-left">
        <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${resultStyles[pick.result]}`}>
          {pick.result === "win" ? <CheckCircle className="w-3.5 h-3.5" /> :
           pick.result === "loss" ? <XCircle className="w-3.5 h-3.5" /> :
           pick.result === "push" ? <Minus className="w-3.5 h-3.5" /> :
           <Clock className="w-3.5 h-3.5" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {pick.confidence === "HIGH" && <Crown className="w-3 h-3 text-gold flex-shrink-0" />}
            <p className="text-xs sm:text-sm font-medium text-silver truncate">{formatPickLabel(pick.pick, (config as any).key ?? "mlb")}</p>
            {/* Inline CLV badge on settled picks */}
            {clvRecord && clvRecord.closingOdds !== 0 && (
              <span className={`text-[8px] font-bold px-1 py-0.5 rounded flex-shrink-0 ${clvRecord.beatClosing ? "bg-neon/15 text-neon" : "bg-danger/15 text-danger"}`}>
                CLV {clvRecord.clvPercent > 0 ? "+" : ""}{clvRecord.clvPercent}%
              </span>
            )}
          </div>
          <p className="text-[9px] text-mercury/60 truncate">
            {pick.game} {pick.finalScore ? `• ${pick.finalScore}` : `• ${pick.bookmaker}`}
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-xs font-mono font-bold text-silver">{formatOdds(pick.odds)}</p>
          <p className="text-[9px] text-mercury">${pick.stake.toFixed(0)}</p>
        </div>
        {pick.result !== "pending" && (
          <span className={`text-xs font-mono font-bold flex-shrink-0 ${pick.payout - pick.stake >= 0 ? "text-neon" : "text-danger"}`}>
            {pick.payout - pick.stake >= 0 ? "+" : ""}${(pick.payout - pick.stake).toFixed(0)}
          </span>
        )}
        {!compact && <ChevronDown className={`w-3.5 h-3.5 text-mercury/40 transition-transform ${isExpanded ? "rotate-180" : ""}`} />}
      </button>

      {isExpanded && (
        <div className="px-3 sm:px-4 pb-3 animate-slide-up space-y-2">
          {/* 3 Model Scores */}
          <div className="grid grid-cols-3 gap-1.5">
            <div className="text-center p-1.5 rounded bg-purple/10">
              <Brain className="w-3 h-3 text-purple mx-auto mb-0.5" />
              <p className="text-sm font-bold font-mono text-purple">{pick.pitcherScore}%</p>
              <p className="text-[8px] text-mercury">{config.model1Label}</p>
              {pick.pitcherCorrect !== undefined && (
                <p className={`text-[8px] font-bold ${pick.pitcherCorrect ? "text-neon" : "text-danger"}`}>
                  {pick.pitcherCorrect ? "RIGHT" : "WRONG"}
                </p>
              )}
            </div>
            <div className="text-center p-1.5 rounded bg-electric/10">
              <BarChart3 className="w-3 h-3 text-electric mx-auto mb-0.5" />
              <p className="text-sm font-bold font-mono text-electric">{pick.marketScore}%</p>
              <p className="text-[8px] text-mercury">Market</p>
              {pick.marketCorrect !== undefined && (
                <p className={`text-[8px] font-bold ${pick.marketCorrect ? "text-neon" : "text-danger"}`}>
                  {pick.marketCorrect ? "RIGHT" : "WRONG"}
                </p>
              )}
            </div>
            <div className="text-center p-1.5 rounded bg-neon/10">
              <Activity className="w-3 h-3 text-neon mx-auto mb-0.5" />
              <p className="text-sm font-bold font-mono text-neon">{pick.trendScore}%</p>
              <p className="text-[8px] text-mercury">{config.model3Label}</p>
              {pick.trendCorrect !== undefined && (
                <p className={`text-[8px] font-bold ${pick.trendCorrect ? "text-neon" : "text-danger"}`}>
                  {pick.trendCorrect ? "RIGHT" : "WRONG"}
                </p>
              )}
            </div>
          </div>

          {/* CLV Detail — shown on settled picks that have closing odds */}
          {pick.result !== "pending" && clvRecord && clvRecord.closingOdds !== 0 && (
            <div className="rounded bg-gunmetal/20 p-2.5">
              <p className="text-[9px] text-mercury uppercase tracking-wider mb-1.5 font-semibold">Closing Line Value</p>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-xs font-bold font-mono ${clvRecord.clvPercent > 0 ? "text-neon" : "text-danger"}`}>
                  {clvRecord.clvPercent > 0 ? "+" : ""}{clvRecord.clvPercent}% CLV
                </span>
                <span className="text-[10px] text-mercury/50">
                  Open {formatOdds(clvRecord.openingOdds)} → Close {formatOdds(clvRecord.closingOdds)}
                </span>
                <span className={`ml-auto text-[10px] font-bold ${clvRecord.beatClosing ? "text-neon" : "text-danger"}`}>
                  {clvRecord.beatClosing ? "✓ Beat the close" : "✗ Closed worse"}
                </span>
              </div>
            </div>
          )}

          {/* Reasoning */}
          <div className="rounded bg-gunmetal/20 p-2.5">
            <p className="text-[9px] text-mercury uppercase tracking-wider mb-1.5 font-semibold">Analysis</p>
            {pick.reasoning.map((r, i) => (
              <p key={i} className="text-[11px] text-mercury mb-0.5 flex gap-1">
                <span className="text-electric">{'>'}</span> {r}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="text-center py-2 px-1 bg-bunker/50">
      <p className={`text-sm font-bold font-mono ${color}`}>{value}</p>
      <p className="text-[8px] text-mercury/50 uppercase">{label}</p>
    </div>
  );
}

function ModelAccStat({ name, icon: Icon, color, acc }: {
  name: string; icon: any; color: string; acc: { correct: number; total: number; winRate: number };
}) {
  return (
    <div className="text-center">
      <Icon className={`w-3 h-3 ${color} mx-auto mb-0.5`} />
      <p className={`text-xs font-bold font-mono ${acc.winRate > 52 ? "text-neon" : acc.winRate > 48 ? color : "text-danger"}`}>
        {acc.winRate}%
      </p>
      <p className="text-[7px] text-mercury/50">{name} ({acc.total})</p>
    </div>
  );
}
