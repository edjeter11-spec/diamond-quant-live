"use client";

import { useState, useEffect, useCallback } from "react";
import { useStore } from "@/lib/store";
import {
  Bot, TrendingUp, TrendingDown, DollarSign, Target, ChevronDown,
  CheckCircle, XCircle, Minus, Clock, Flame, RefreshCw, Brain,
  Eye, Calendar, Zap,
} from "lucide-react";
import {
  loadBotState, saveBotState, hasTodaysPicks, generateDailyPicks,
  settlePicksFromScores, type BotState, type BotPick,
} from "@/lib/bot/bot-picks";

export default function BotChallenge() {
  const { oddsData, scores } = useStore();
  const [botState, setBotState] = useState<BotState>(loadBotState);
  const [expandedPick, setExpandedPick] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  // Auto-settle pending picks when scores update
  useEffect(() => {
    if (scores.length === 0) return;
    const updated = settlePicksFromScores(botState, scores);
    if (updated !== botState) {
      setBotState(updated);
    }
  }, [scores]); // eslint-disable-line react-hooks/exhaustive-deps

  // Generate picks function
  const generatePicks = useCallback(() => {
    if (oddsData.length === 0) return;
    if (hasTodaysPicks(botState)) return; // already have today's
    setGenerating(true);

    const picks = generateDailyPicks(oddsData, botState.currentBankroll);

    if (picks.length > 0) {
      const updated: BotState = {
        ...botState,
        picks: [...botState.picks, ...picks],
        currentBankroll: botState.currentBankroll - picks.reduce((s, p) => s + p.stake, 0),
      };
      saveBotState(updated);
      setBotState(updated);
    }

    setGenerating(false);
  }, [oddsData, botState]);

  // AUTO-GENERATE: when odds data loads and we don't have today's picks yet
  useEffect(() => {
    if (oddsData.length > 0 && !hasTodaysPicks(botState)) {
      generatePicks();
    }
  }, [oddsData]); // eslint-disable-line react-hooks/exhaustive-deps

  const formatOdds = (odds: number) => (odds > 0 ? `+${odds}` : `${odds}`);
  const today = new Date().toISOString().split("T")[0];
  const todaysPicks = botState.picks.filter((p) => p.date === today);
  const hasToday = todaysPicks.length >= 4;
  const allPicks = [...botState.picks].reverse();

  // Stats
  const settled = botState.picks.filter((p) => p.result !== "pending");
  const wins = settled.filter((p) => p.result === "win").length;
  const losses = settled.filter((p) => p.result === "loss").length;
  const totalStaked = settled.reduce((s, p) => s + p.stake, 0);
  const totalReturns = settled.reduce((s, p) => s + p.payout, 0);
  const profit = totalReturns - totalStaked;
  const roi = totalStaked > 0 ? (profit / totalStaked) * 100 : 0;
  const winRate = (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0;
  const pendingCount = botState.picks.filter((p) => p.result === "pending").length;
  const daysActive = new Set(botState.picks.map((p) => p.date)).size;

  // Streak
  let streak = 0;
  let streakType = "";
  for (let i = settled.length - 1; i >= 0; i--) {
    const r = settled[i].result;
    if (r === "push") continue;
    if (!streakType) { streakType = r === "win" ? "W" : "L"; streak = 1; }
    else if ((r === "win" && streakType === "W") || (r === "loss" && streakType === "L")) streak++;
    else break;
  }

  // Daily PnL for chart
  const days = Object.entries(botState.dailyPnL).sort((a, b) => a[0].localeCompare(b[0]));
  let runningPnL = 0;
  const equityCurve = days.map(([day, pnl]) => {
    runningPnL += pnl;
    return { day, pnl, cumulative: runningPnL };
  });

  return (
    <div className="space-y-4">
      {/* Header Card */}
      <div className="glass rounded-xl overflow-hidden border border-electric/20">
        <div className="px-4 py-3 bg-gradient-to-r from-electric/10 to-purple/5 border-b border-electric/15 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-electric/15 flex items-center justify-center border border-electric/20">
            <Bot className="w-5 h-5 text-electric" />
          </div>
          <div className="flex-1">
            <h2 className="text-sm sm:text-base font-bold text-silver">Bot Challenge</h2>
            <p className="text-[10px] text-mercury/60">$5,000 simulated bankroll • 4 picks/day • FanDuel odds only</p>
          </div>
          <div className="text-right">
            <p className={`text-lg sm:text-xl font-bold font-mono ${botState.currentBankroll >= 5000 ? "text-neon" : "text-danger"}`}>
              ${botState.currentBankroll.toFixed(0)}
            </p>
            <p className="text-[9px] text-mercury/50">bankroll</p>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-4 sm:grid-cols-5 gap-px bg-slate/10">
          <MiniStat label="Record" value={`${wins}W-${losses}L`} color="text-silver" />
          <MiniStat label="Win Rate" value={`${winRate.toFixed(0)}%`} color={winRate > 52 ? "text-neon" : "text-silver"} />
          <MiniStat label="ROI" value={`${roi >= 0 ? "+" : ""}${roi.toFixed(1)}%`} color={roi >= 0 ? "text-neon" : "text-danger"} />
          <MiniStat label="P/L" value={`${profit >= 0 ? "+" : ""}$${profit.toFixed(0)}`} color={profit >= 0 ? "text-neon" : "text-danger"} />
          <div className="hidden sm:block">
            <MiniStat label="Days" value={`${daysActive}`} color="text-electric" />
          </div>
        </div>

        {/* Equity curve (simple text-based) */}
        {equityCurve.length > 1 && (
          <div className="px-4 py-2 border-t border-slate/10">
            <div className="flex items-end gap-0.5 h-10">
              {equityCurve.slice(-14).map((d, i) => {
                const max = Math.max(...equityCurve.map((x) => Math.abs(x.cumulative)), 1);
                const height = Math.abs(d.cumulative) / max * 100;
                return (
                  <div key={i} className="flex-1 flex flex-col justify-end items-center" title={`${d.day}: ${d.cumulative >= 0 ? "+" : ""}$${d.cumulative.toFixed(0)}`}>
                    <div
                      className={`w-full rounded-t ${d.cumulative >= 0 ? "bg-neon/40" : "bg-danger/40"}`}
                      style={{ height: `${Math.max(height, 4)}%` }}
                    />
                  </div>
                );
              })}
            </div>
            <p className="text-[8px] text-mercury/40 text-center mt-0.5">Cumulative P/L — last {Math.min(equityCurve.length, 14)} days</p>
          </div>
        )}

        {streak > 1 && (
          <div className="px-4 py-1.5 border-t border-slate/10 flex items-center justify-center gap-1">
            <Flame className={`w-3 h-3 ${streakType === "W" ? "text-neon" : "text-danger"}`} />
            <span className={`text-xs font-bold ${streakType === "W" ? "text-neon" : "text-danger"}`}>
              {streak}{streakType} streak
            </span>
          </div>
        )}
      </div>

      {/* Status / Manual Generate Button */}
      {!hasToday && (
        <div className="glass rounded-xl p-4 text-center">
          {generating ? (
            <div className="flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 text-electric animate-spin" />
              <span className="text-sm text-electric font-medium">Bot is analyzing markets and selecting picks...</span>
            </div>
          ) : oddsData.length === 0 ? (
            <div className="flex items-center justify-center gap-2">
              <Clock className="w-4 h-4 text-amber" />
              <span className="text-sm text-mercury">Waiting for odds data to load — picks will generate automatically</span>
            </div>
          ) : (
            <div>
              <p className="text-sm text-mercury mb-2">Couldn't find 4 qualifying picks yet. More games need to have lines posted.</p>
              <button
                onClick={generatePicks}
                className="px-4 py-2 rounded-lg bg-electric/15 border border-electric/25 text-electric text-xs font-bold hover:bg-electric/25 transition-all"
              >
                <Zap className="w-3.5 h-3.5 inline mr-1" /> Try Again
              </button>
            </div>
          )}
        </div>
      )}
      {hasToday && (
        <div className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-neon/5 border border-neon/15">
          <CheckCircle className="w-3.5 h-3.5 text-neon" />
          <span className="text-xs text-neon font-medium">Today's picks locked in — auto-generated from live odds</span>
        </div>
      )}

      {/* Today's Picks */}
      {todaysPicks.length > 0 && (
        <div className="glass rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate/30 flex items-center gap-2 bg-electric/5">
            <Calendar className="w-4 h-4 text-electric" />
            <span className="text-xs font-bold text-silver uppercase tracking-wider">Today's Picks</span>
            <span className="ml-auto text-[10px] text-mercury">{today}</span>
          </div>
          <div className="divide-y divide-slate/10">
            {todaysPicks.map((pick) => (
              <BotPickCard
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
      {botState.picks.length > todaysPicks.length && (
        <div className="glass rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate/30 flex items-center gap-2">
            <Clock className="w-4 h-4 text-mercury" />
            <span className="text-xs font-bold text-silver uppercase tracking-wider">Pick History</span>
            <span className="ml-auto text-[10px] text-mercury">{settled.length} settled • {pendingCount} pending</span>
          </div>
          <div className="divide-y divide-slate/10 max-h-[400px] overflow-y-auto">
            {allPicks.filter((p) => p.date !== today).slice(0, 20).map((pick) => (
              <BotPickCard
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

      {/* Methodology */}
      <div className="glass rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <Eye className="w-4 h-4 text-mercury" />
          <span className="text-xs font-bold text-silver uppercase tracking-wider">How It Works</span>
        </div>
        <div className="space-y-1.5 text-[11px] text-mercury/80">
          <p><span className="text-electric font-semibold">1.</span> Scans all games with FanDuel lines and 2+ books for comparison</p>
          <p><span className="text-electric font-semibold">2.</span> De-vigs odds from every sportsbook to find the true fair probability</p>
          <p><span className="text-electric font-semibold">3.</span> Compares FanDuel's implied probability vs market fair value</p>
          <p><span className="text-electric font-semibold">4.</span> Selects the 4 highest +EV picks (minimum 1.5% edge, max 1 per game)</p>
          <p><span className="text-electric font-semibold">5.</span> Sizes bets using quarter-Kelly criterion ($25 minimum)</p>
          <p><span className="text-electric font-semibold">6.</span> Auto-settles when final scores come in from MLB Stats API</p>
          <p className="text-mercury/50 mt-2">All picks, reasoning, and results are 100% transparent. No hindsight editing.</p>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
function BotPickCard({ pick, isExpanded, onToggle, formatOdds, compact }: {
  pick: BotPick; isExpanded: boolean; onToggle: () => void;
  formatOdds: (n: number) => string; compact?: boolean;
}) {
  const resultStyles: Record<string, string> = {
    win: "bg-neon/15 text-neon",
    loss: "bg-danger/15 text-danger",
    push: "bg-mercury/15 text-mercury",
    pending: "bg-amber/15 text-amber",
  };
  const resultIcons: Record<string, any> = {
    win: CheckCircle,
    loss: XCircle,
    push: Minus,
    pending: Clock,
  };
  const ResultIcon = resultIcons[pick.result];

  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full px-3 sm:px-4 py-2.5 flex items-center gap-2 hover:bg-gunmetal/20 active:bg-gunmetal/30 transition-colors text-left"
      >
        {/* Result badge */}
        <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${resultStyles[pick.result]}`}>
          <ResultIcon className="w-3.5 h-3.5" />
        </div>

        {/* Pick info */}
        <div className="flex-1 min-w-0">
          <p className="text-xs sm:text-sm font-medium text-silver truncate">{pick.pick}</p>
          <p className="text-[9px] sm:text-[10px] text-mercury/60 truncate">
            {pick.game} {pick.finalScore ? `• Final: ${pick.finalScore}` : ""}
          </p>
        </div>

        {/* Odds + Stake */}
        <div className="text-right flex-shrink-0">
          <p className="text-xs font-mono font-bold text-silver">{formatOdds(pick.odds)}</p>
          <p className="text-[9px] text-mercury">${pick.stake.toFixed(0)}</p>
        </div>

        {/* P/L */}
        {pick.result !== "pending" && (
          <div className="text-right flex-shrink-0 w-14">
            <p className={`text-xs font-mono font-bold ${pick.payout - pick.stake >= 0 ? "text-neon" : "text-danger"}`}>
              {pick.payout - pick.stake >= 0 ? "+" : ""}${(pick.payout - pick.stake).toFixed(0)}
            </p>
          </div>
        )}

        {!compact && (
          <ChevronDown className={`w-3.5 h-3.5 text-mercury/40 flex-shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
        )}
      </button>

      {/* Expanded reasoning */}
      {isExpanded && (
        <div className="px-3 sm:px-4 pb-3 animate-slide-up space-y-2.5">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-1.5">
            <div className="text-center p-1.5 rounded bg-gunmetal/40">
              <p className="text-sm font-bold font-mono text-electric">{pick.fairProb}%</p>
              <p className="text-[8px] text-mercury uppercase">Fair Prob</p>
            </div>
            <div className="text-center p-1.5 rounded bg-gunmetal/40">
              <p className="text-sm font-bold font-mono text-mercury">{pick.impliedProb}%</p>
              <p className="text-[8px] text-mercury uppercase">FD Implied</p>
            </div>
            <div className="text-center p-1.5 rounded bg-gunmetal/40">
              <p className="text-sm font-bold font-mono text-neon">+{pick.evEdge}%</p>
              <p className="text-[8px] text-mercury uppercase">EV Edge</p>
            </div>
          </div>

          {/* Reasoning */}
          <div className="rounded bg-gunmetal/20 p-2.5">
            <p className="text-[9px] text-mercury uppercase tracking-wider mb-1.5 font-semibold flex items-center gap-1">
              <Brain className="w-3 h-3 text-electric" /> Bot's Thought Process
            </p>
            <div className="space-y-1">
              {pick.reasoning.map((r, i) => (
                <p key={i} className="text-[11px] text-mercury leading-relaxed">
                  <span className="text-electric font-mono">{r.split(":")[0]}:</span>
                  {r.includes(":") ? r.split(":").slice(1).join(":") : ""}
                </p>
              ))}
            </div>
          </div>

          {/* Confidence */}
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] text-mercury">Confidence</span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
              pick.confidence === "HIGH" ? "bg-neon/10 text-neon" :
              pick.confidence === "MEDIUM" ? "bg-electric/10 text-electric" :
              "bg-amber/10 text-amber"
            }`}>{pick.confidence}</span>
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
