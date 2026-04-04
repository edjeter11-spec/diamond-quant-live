"use client";

import { useState, useEffect } from "react";
import { useStore } from "@/lib/store";
import {
  Bot, Brain, TrendingUp, TrendingDown, BarChart3, Target,
  ChevronDown, RefreshCw, CheckCircle, XCircle, Minus, Clock,
  Flame, Zap, DollarSign, Crown, Activity,
} from "lucide-react";
import {
  loadSmartBot, saveSmartBot, generateSmartPicks, settleAndLearn,
  loadModelAccuracy, type SmartBotState, type SmartBotPick, type ModelAccuracy,
} from "@/lib/bot/smart-picks";
import type { GameAnalysis } from "@/lib/bot/three-models";

export default function BotChallenge() {
  const { scores } = useStore();
  const [botState, setBotState] = useState<SmartBotState>(loadSmartBot);
  const [accuracy, setAccuracy] = useState<ModelAccuracy>(loadModelAccuracy);
  const [analyses, setAnalyses] = useState<GameAnalysis[]>([]);
  const [expandedPick, setExpandedPick] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch 3-model analysis on mount
  useEffect(() => {
    async function init() {
      try {
        const res = await fetch("/api/bot-analysis");
        if (res.ok) {
          const data = await res.json();
          setAnalyses(data.analyses ?? []);
        }
      } catch {}
      setLoading(false);
    }
    init();
  }, []);

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
      saveSmartBot(updated);
      setBotState(updated);
    }
  }, [analyses]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-settle + learn when scores update
  useEffect(() => {
    if (scores.length === 0) return;
    const { botState: updated, accuracy: newAcc } = settleAndLearn(botState, scores);
    if (updated !== botState) {
      setBotState(updated);
      setAccuracy(newAcc);
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

  return (
    <div className="space-y-3">
      {/* Header Card */}
      <div className="glass rounded-xl overflow-hidden border border-electric/20">
        <div className="px-4 py-3 bg-gradient-to-r from-electric/10 to-purple/5 border-b border-electric/15 flex items-center gap-3">
          <Bot className="w-5 h-5 text-electric" />
          <div className="flex-1">
            <h2 className="text-sm font-bold text-silver">Bot Challenge — 3-Model Powered</h2>
            <p className="text-[10px] text-mercury/60">$5K sim • 4 picks/day • Pitcher + Market + Trend consensus</p>
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
              <ModelAccStat name="Pitcher" icon={Brain} color="text-purple" acc={accuracy.pitcher} />
              <ModelAccStat name="Market" icon={BarChart3} color="text-electric" acc={accuracy.market} />
              <ModelAccStat name="Trend" icon={TrendingUp} color="text-neon" acc={accuracy.trend} />
              <ModelAccStat name="Consensus" icon={Target} color="text-gold" acc={accuracy.consensus} />
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
                isExpanded={expandedPick === pick.id}
                onToggle={() => setExpandedPick(expandedPick === pick.id ? null : pick.id)}
                formatOdds={formatOdds}
              />
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

function PickRow({ pick, isExpanded, onToggle, formatOdds, compact }: {
  pick: SmartBotPick; isExpanded: boolean; onToggle: () => void;
  formatOdds: (n: number) => string; compact?: boolean;
}) {
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
              <p className="text-[8px] text-mercury">Pitcher</p>
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
              <TrendingUp className="w-3 h-3 text-neon mx-auto mb-0.5" />
              <p className="text-sm font-bold font-mono text-neon">{pick.trendScore}%</p>
              <p className="text-[8px] text-mercury">Trend</p>
              {pick.trendCorrect !== undefined && (
                <p className={`text-[8px] font-bold ${pick.trendCorrect ? "text-neon" : "text-danger"}`}>
                  {pick.trendCorrect ? "RIGHT" : "WRONG"}
                </p>
              )}
            </div>
          </div>

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
