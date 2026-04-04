"use client";

import { useState, useEffect, useRef } from "react";
import {
  Brain, Cpu, Database, TrendingUp, TrendingDown, Activity,
  CheckCircle, XCircle, BookOpen, Zap, RefreshCw, ChevronDown,
  Eye, AlertTriangle, Terminal,
} from "lucide-react";
import {
  loadBrain, saveBrain, preTrainBrain, getBrainSummary,
  type BrainState, type ModelLog,
} from "@/lib/bot/brain";
import { deepTrain, type LearnedPatterns } from "@/lib/bot/deep-trainer";

export default function ModelLogs() {
  const [brain, setBrain] = useState<BrainState | null>(null);
  const [training, setTraining] = useState(false);
  const [trainProgress, setTrainProgress] = useState("");
  const [activeSection, setActiveSection] = useState<"logs" | "memory" | "weights">("logs");
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const b = loadBrain();
    setBrain(b);

    // Auto pre-train if not yet trained
    if (!b.isPreTrained) {
      autoTrain(b);
    }
  }, []);

  async function autoTrain(b: BrainState) {
    setTraining(true);
    try {
      const seasons = new Date().getFullYear() >= 2026 ? [2024, 2025, 2026] : [2024, 2025];
      const result = await deepTrain(b, seasons, (msg) => setTrainProgress(msg));
      setBrain(result.finalState);
      saveBrain(result.finalState);
      setTrainProgress(`Deep training complete: ${result.gamesProcessed} games, ${result.pitcherGamesAnalyzed} with pitcher matchups`);
    } catch (err) {
      setTrainProgress("Training failed — will retry on next load");
    }
    setTraining(false);
  }

  async function manualRetrain() {
    if (!brain) return;
    setTraining(true);
    setTrainProgress("Deep retraining from scratch...");
    const fresh = { ...brain, trainedSeasons: [], totalGamesProcessed: 0 };
    try {
      const seasons = new Date().getFullYear() >= 2026 ? [2024, 2025, 2026] : [2024, 2025];
      const result = await deepTrain(fresh, seasons, (msg) => setTrainProgress(msg));
      saveBrain(result.finalState);
      setBrain(result.finalState);
      setTrainProgress(`Done: ${result.gamesProcessed} games, ${result.pitcherGamesAnalyzed} pitcher matchups analyzed`);
    } catch {
      setTrainProgress("Retrain failed");
    }
    setTraining(false);
  }

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [brain?.logs.length]);

  if (!brain) return null;

  const summary = getBrainSummary(brain);
  const logTypeIcons: Record<string, any> = {
    train: Database, learn: Brain, adjust: Zap, swap: RefreshCw, error: AlertTriangle,
  };
  const logTypeColors: Record<string, string> = {
    train: "text-purple", learn: "text-electric", adjust: "text-amber", swap: "text-neon", error: "text-danger",
  };

  return (
    <div className="glass rounded-xl overflow-hidden border border-purple/15">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate/30 bg-gradient-to-r from-purple/10 to-electric/5">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Cpu className="w-5 h-5 text-purple" />
            {brain.isPreTrained && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-neon rounded-full" />}
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-bold text-silver uppercase tracking-wider">Model Logs</h2>
            <p className="text-[9px] text-mercury/60">
              {brain.isPreTrained
                ? `${brain.version} — Trained on ${brain.trainedSeasons.join(", ")} (${brain.totalGamesProcessed.toLocaleString()} games)`
                : "Training in progress..."
              }
            </p>
          </div>
          <span className="text-[10px] font-mono text-electric">{brain.version}</span>
        </div>

        {/* Training progress */}
        {training && (
          <div className="mt-2 flex items-center gap-2">
            <RefreshCw className="w-3.5 h-3.5 text-purple animate-spin" />
            <span className="text-[11px] text-purple">{trainProgress}</span>
          </div>
        )}
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-4 gap-px bg-slate/10">
        <MiniStat label="Games" value={brain.totalGamesProcessed.toLocaleString()} color="text-silver" />
        <MiniStat label="Predictions" value={brain.totalPredictionsMade.toLocaleString()} color="text-electric" />
        <MiniStat label="Win Rate" value={`${summary.overallWinRate}%`} color={summary.overallWinRate > 52 ? "text-neon" : "text-silver"} />
        <MiniStat label="Accuracy" value={`${((1 - summary.avgBrier) * 100).toFixed(0)}%`} color="text-purple" />
      </div>

      {/* Section Tabs */}
      <div className="flex border-b border-slate/20">
        {[
          { key: "logs" as const, label: "Live Logs", icon: Terminal },
          { key: "memory" as const, label: "Memory", icon: BookOpen },
          { key: "weights" as const, label: "Weights", icon: Activity },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveSection(tab.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-medium transition-colors ${
              activeSection === tab.key
                ? "text-electric border-b-2 border-electric bg-electric/5"
                : "text-mercury hover:text-silver hover:bg-gunmetal/20"
            }`}
          >
            <tab.icon className="w-3 h-3" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Live Logs — animated terminal style */}
      {activeSection === "logs" && (
        <div className="max-h-[350px] overflow-y-auto bg-void/50 p-3 font-mono text-[11px]">
          {summary.recentLogs.length === 0 ? (
            <p className="text-mercury/40 text-center py-4">No logs yet — model is initializing...</p>
          ) : (
            summary.recentLogs.map((log, i) => {
              const Icon = logTypeIcons[log.type] ?? Brain;
              const color = logTypeColors[log.type] ?? "text-mercury";
              const time = new Date(log.timestamp).toLocaleTimeString();
              return (
                <div key={i} className="flex items-start gap-2 py-1 animate-slide-up" style={{ animationDelay: `${i * 30}ms` }}>
                  <Icon className={`w-3 h-3 mt-0.5 flex-shrink-0 ${color}`} />
                  <span className="text-mercury/40 flex-shrink-0">{time}</span>
                  <span className={`${color} break-words`}>{log.message}</span>
                </div>
              );
            })
          )}
          <div ref={logsEndRef} />
        </div>
      )}

      {/* Memory — recent games the model remembers */}
      {activeSection === "memory" && (
        <div className="max-h-[350px] overflow-y-auto p-3 space-y-2">
          {summary.recentGames.length === 0 ? (
            <p className="text-mercury/40 text-center text-xs py-4">No game memories stored yet — games will appear here as they finish</p>
          ) : (
            summary.recentGames.slice().reverse().map((game, i) => {
              const wasRight = (game.actual === "home" && game.prediction > 0.5) || (game.actual === "away" && game.prediction < 0.5);
              return (
                <div key={i} className={`p-2.5 rounded-lg border ${wasRight ? "bg-neon/3 border-neon/10" : "bg-danger/3 border-danger/10"}`}>
                  <div className="flex items-center gap-2 mb-1">
                    {wasRight ? <CheckCircle className="w-3 h-3 text-neon" /> : <XCircle className="w-3 h-3 text-danger" />}
                    <span className="text-[11px] text-silver font-medium truncate">{game.game}</span>
                    <span className="text-[9px] text-mercury/50 ml-auto">{game.date}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-mercury mb-1">
                    <span>Predicted: {(game.prediction * 100).toFixed(0)}% home</span>
                    <span>Actual: {game.actual} ({game.totalActual} runs)</span>
                    <span>Brier: {game.brierScore.toFixed(3)}</span>
                  </div>
                  {game.lessonsLearned.length > 0 && (
                    <div className="mt-1.5 space-y-0.5">
                      {game.lessonsLearned.map((lesson, li) => (
                        <p key={li} className="text-[10px] text-electric/80 flex gap-1">
                          <Brain className="w-2.5 h-2.5 mt-0.5 flex-shrink-0" /> {lesson}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Weights — visual comparison */}
      {activeSection === "weights" && (
        <div className="p-3 space-y-3">
          {/* Current vs Initial */}
          <p className="text-[9px] text-mercury uppercase tracking-wider font-semibold">Weight Evolution (initial → current)</p>
          <div className="space-y-1.5">
            {Object.entries(summary.weights).map(([key, val]) => {
              const initial = (brain.initialWeights as any)[key] ?? 0;
              const change = (summary.weightChanges as any)[key] ?? 0;
              const isUp = change > 0;
              return (
                <div key={key} className="flex items-center gap-2">
                  <span className="text-[10px] text-mercury w-16 capitalize truncate">{key}</span>
                  <div className="flex-1 h-3 bg-gunmetal rounded-full overflow-hidden relative">
                    {/* Initial weight marker */}
                    <div className="absolute h-full w-0.5 bg-mercury/30 z-10" style={{ left: `${initial * 350}%` }} />
                    {/* Current weight */}
                    <div
                      className={`h-full rounded-full transition-all ${isUp ? "bg-neon/50" : change < 0 ? "bg-danger/50" : "bg-electric/50"}`}
                      style={{ width: `${val * 350}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-mercury w-10 text-right">{(val * 100).toFixed(1)}%</span>
                  {change !== 0 && (
                    <span className={`text-[9px] font-mono w-10 ${isUp ? "text-neon" : "text-danger"}`}>
                      {isUp ? "+" : ""}{change.toFixed(1)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Market profiles */}
          <p className="text-[9px] text-mercury uppercase tracking-wider font-semibold mt-3">Market Intelligence</p>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(summary.markets).filter(([_, m]) => m.totalBets > 0).map(([key, market]) => (
              <div key={key} className="p-2 rounded-lg bg-gunmetal/30">
                <p className="text-[10px] text-silver font-semibold capitalize mb-1">{key.replace("_", " ")}</p>
                <div className="space-y-0.5 text-[9px]">
                  <div className="flex justify-between">
                    <span className="text-mercury">Record</span>
                    <span className="text-silver font-mono">{market.wins}W-{market.losses}L</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-mercury">Win Rate</span>
                    <span className={`font-mono ${market.winRate > 52 ? "text-neon" : "text-silver"}`}>{market.winRate.toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-mercury">Min Edge</span>
                    <span className="text-electric font-mono">{market.dynamicThreshold.toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-mercury">Accuracy</span>
                    <span className="text-purple font-mono">{((1 - market.brierScore) * 100).toFixed(0)}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Retrain button */}
          <button
            onClick={manualRetrain}
            disabled={training}
            className="w-full mt-2 py-2 rounded-lg bg-purple/10 border border-purple/20 text-purple text-xs font-semibold hover:bg-purple/20 transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {training ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Database className="w-3 h-3" />}
            {training ? "Retraining..." : "Retrain from Scratch (2024+2025+2026)"}
          </button>
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
