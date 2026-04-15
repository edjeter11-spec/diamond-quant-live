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
import { loadNbaPropBrain, type NbaPropBrainState } from "@/lib/bot/nba-prop-brain";
import { projectProp } from "@/lib/bot/nba-prop-projector";
import type { GameAnalysis } from "@/lib/bot/three-models";
import TeamLogo from "@/components/ui/TeamLogo";
import PlayerAvatar from "@/components/ui/PlayerAvatar";

export default function BotChallenge() {
  const { scores } = useStore();
  const { currentSport, config } = useSport();
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

  // NBA Prop Brain picks (prop parlay of the day)
  const [propParlayPicks, setPropParlayPicks] = useState<Array<{
    playerName: string; propType: string; line: number; side: string;
    probability: number; projectedValue: number;
  }>>([]);

  useEffect(() => {
    if (!isNBA) { setPropParlayPicks([]); return; }
    // Generate prop parlay from Brain projections on today's props
    async function generatePropParlay() {
      try {
        const brain = loadNbaPropBrain();
        const propsRes = await fetch("/api/players?sport=basketball_nba&market=player_points");
        if (!propsRes.ok) return;
        const propsData = await propsRes.json();
        const props = propsData.props ?? [];

        const projections: typeof propParlayPicks = [];
        for (const prop of props.slice(0, 20)) {
          const stats = { ppg: prop.line, rpg: 5, apg: 3 };
          const ctx = { isHome: false, isB2B: false, leagueAvgTotal: 224 };
          const proj = projectProp(stats, "player_points", prop.line, brain.weights, ctx);
          if (proj.confidence >= 15) {
            projections.push({
              playerName: prop.playerName,
              propType: "Points",
              line: prop.line,
              side: proj.side,
              probability: proj.probability,
              projectedValue: proj.projectedValue,
            });
          }
        }
        // Sort by confidence, take top 4
        projections.sort((a, b) => Math.abs(b.probability - 0.5) - Math.abs(a.probability - 0.5));
        setPropParlayPicks(projections.slice(0, 4));
      } catch {}
    }
    generatePropParlay();
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

  // Fetch sport-specific analysis
  useEffect(() => {
    async function init() {
      try {
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
  const wins = settled.filter(p => p.result === "win").length;
  const losses = settled.filter(p => p.result === "loss").length;
  const totalStaked = settled.reduce((s, p) => s + p.stake, 0);
  const totalReturns = settled.reduce((s, p) => s + p.payout, 0);
  const profit = totalReturns - totalStaked;
  const roi = totalStaked > 0 ? (profit / totalStaked) * 100 : 0;
  const pending = botState.picks.filter(p => p.result === "pending").length;

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
          <MiniStat label="ROI" value={`${roi >= 0 ? "+" : ""}${roi.toFixed(1)}%`} color={roi >= 0 ? "text-neon" : "text-danger"} />
          <MiniStat label="P/L" value={`${profit >= 0 ? "+" : ""}$${profit.toFixed(0)}`} color={profit >= 0 ? "text-neon" : "text-danger"} />
          <MiniStat label="Pending" value={`${pending}`} color="text-amber" />
        </div>

        {/* Per-Model Accuracy */}
        {accuracy.consensus.total > 0 && (
          <div className="px-4 py-2 border-t border-slate/10">
            <p className="text-[9px] text-mercury uppercase tracking-wider mb-1.5 font-semibold">Model Accuracy (live tracking)</p>
            <div className="grid grid-cols-4 gap-2">
              <ModelAccStat name={config.model1Label} icon={Brain} color="text-purple" acc={accuracy.pitcher} />
              <ModelAccStat name="Market" icon={BarChart3} color="text-electric" acc={accuracy.market} />
              <ModelAccStat name={config.model3Label} icon={Activity} color="text-neon" acc={accuracy.trend} />
              <ModelAccStat name="Consensus" icon={Target} color="text-gold" acc={accuracy.consensus} />
            </div>
          </div>
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

      {/* NBA Prop Parlay of the Day — Brain's best player prop picks */}
      {isNBA && propParlayPicks.length > 0 && (
        <div className="glass rounded-xl overflow-hidden border border-purple/20">
          <div className="px-4 py-2.5 bg-gradient-to-r from-purple/10 to-neon/5 border-b border-purple/15 flex items-center gap-2">
            <Brain className="w-4 h-4 text-purple" />
            <div className="flex-1">
              <h3 className="text-xs font-bold text-silver uppercase tracking-wider">Prop Parlay of the Day</h3>
              <p className="text-[9px] text-mercury/50">Brain's top 4 player prop projections</p>
            </div>
            <span className="text-xs font-bold font-mono text-purple">{propParlayPicks.length} legs</span>
          </div>
          <div className="divide-y divide-slate/10">
            {propParlayPicks.map((prop, i) => (
              <div key={i} className="px-4 py-2.5 flex items-center gap-2.5">
                <span className="w-5 h-5 rounded-full bg-purple/20 text-purple text-[9px] font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>
                <PlayerAvatar name={prop.playerName} size={22} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-silver truncate">{prop.playerName}</p>
                  <p className="text-[9px] text-mercury/50">{prop.propType} • Proj: {prop.projectedValue}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <span className={`text-xs font-bold font-mono ${prop.side === "over" ? "text-neon" : "text-purple"}`}>
                    {prop.side === "over" ? "O" : "U"} {prop.line}
                  </span>
                  <p className="text-[8px] text-mercury/50">{(prop.probability * 100).toFixed(0)}%</p>
                </div>
              </div>
            ))}
          </div>
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
            <p className="text-xs sm:text-sm font-medium text-silver truncate">{pick.pick}</p>
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
