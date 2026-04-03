"use client";

import { useState } from "react";
import { loadLearningState, saveLearningState } from "@/lib/bot/learning";
import {
  GraduationCap, RefreshCw, CheckCircle, AlertTriangle,
  Database, TrendingUp, Brain, Zap,
} from "lucide-react";

export default function TrainingPanel() {
  const [training, setTraining] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");
  const [applied, setApplied] = useState(false);

  const runTraining = async () => {
    setTraining(true);
    setError("");
    setResult(null);
    setApplied(false);

    try {
      // Train on 2025 season through today
      const res = await fetch("/api/train?start=2025-03-20&reset=true");
      if (!res.ok) throw new Error("Training failed");
      const data = await res.json();
      setResult(data);
    } catch (err: any) {
      setError(err.message ?? "Training failed");
    }
    setTraining(false);
  };

  const applyWeights = () => {
    if (!result?.trainedState) return;
    saveLearningState(result.trainedState);
    setApplied(true);
  };

  return (
    <div className="glass rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate/30 flex items-center gap-2 bg-purple/5">
        <GraduationCap className="w-5 h-5 text-purple" />
        <div className="flex-1">
          <h3 className="text-sm font-bold text-silver uppercase tracking-wider">Historical Training</h3>
          <p className="text-[10px] text-mercury/60">Train the model on 2025 MLB season data</p>
        </div>
      </div>

      <div className="p-4 space-y-3">
        <p className="text-xs text-mercury">
          Processes every completed 2025 MLB game through the learning loop.
          The model learns from thousands of real results to calibrate its weights
          before making live predictions.
        </p>

        {/* Run Training button */}
        {!result && (
          <button
            onClick={runTraining}
            disabled={training}
            className="w-full py-3 rounded-lg bg-purple/15 border border-purple/25 text-purple text-sm font-bold hover:bg-purple/25 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {training ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Training on 2025 season... (fetching from MLB API)
              </>
            ) : (
              <>
                <Database className="w-4 h-4" />
                Train on Full 2025 Season
              </>
            )}
          </button>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-danger/5 border border-danger/15">
            <AlertTriangle className="w-4 h-4 text-danger flex-shrink-0" />
            <p className="text-xs text-danger">{error}</p>
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-3 animate-slide-up">
            <div className="flex items-center gap-2 p-3 rounded-lg bg-neon/5 border border-neon/15">
              <CheckCircle className="w-4 h-4 text-neon flex-shrink-0" />
              <p className="text-xs text-neon font-medium">{result.message}</p>
            </div>

            {/* Training Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="text-center p-2 rounded bg-gunmetal/40">
                <p className="text-lg font-bold font-mono text-silver">{result.stats.gamesProcessed}</p>
                <p className="text-[8px] text-mercury uppercase">Games</p>
              </div>
              <div className="text-center p-2 rounded bg-gunmetal/40">
                <p className="text-lg font-bold font-mono text-electric">{result.stats.mlWinRate.toFixed(1)}%</p>
                <p className="text-[8px] text-mercury uppercase">ML Win Rate</p>
              </div>
              <div className="text-center p-2 rounded bg-gunmetal/40">
                <p className="text-lg font-bold font-mono text-purple">{result.stats.totalWinRate.toFixed(1)}%</p>
                <p className="text-[8px] text-mercury uppercase">Total Win Rate</p>
              </div>
              <div className="text-center p-2 rounded bg-gunmetal/40">
                <p className="text-lg font-bold font-mono text-amber">{result.stats.epoch}</p>
                <p className="text-[8px] text-mercury uppercase">Epochs</p>
              </div>
            </div>

            {/* Records */}
            <div className="grid grid-cols-2 gap-2">
              <div className="px-3 py-2 rounded bg-gunmetal/30">
                <p className="text-[9px] text-mercury uppercase mb-0.5">Moneyline</p>
                <p className="text-xs font-mono text-silver">{result.stats.mlRecord}</p>
              </div>
              <div className="px-3 py-2 rounded bg-gunmetal/30">
                <p className="text-[9px] text-mercury uppercase mb-0.5">Totals</p>
                <p className="text-xs font-mono text-silver">{result.stats.totalRecord}</p>
              </div>
            </div>

            {/* Learned Weights */}
            <div>
              <p className="text-[9px] text-mercury uppercase tracking-wider mb-1.5 font-semibold">Optimized Weights</p>
              <div className="flex gap-1">
                {Object.entries(result.stats.finalWeights).map(([key, val]: [string, any]) => (
                  <div key={key} className="flex-1 text-center">
                    <div className="h-10 flex items-end justify-center">
                      <div className="w-full rounded-t bg-purple/40" style={{ height: `${val * 350}%` }} />
                    </div>
                    <p className="text-[7px] text-mercury/50 mt-0.5 truncate">{key.slice(0, 4)}</p>
                    <p className="text-[8px] font-mono text-mercury">{(val * 100).toFixed(0)}%</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Version */}
            <div className="flex items-center justify-between px-3 py-2 rounded bg-gunmetal/30">
              <div className="flex items-center gap-1.5">
                <Brain className="w-3.5 h-3.5 text-electric" />
                <span className="text-xs text-mercury">Trained Model Version</span>
              </div>
              <span className="text-xs font-mono text-electric font-bold">{result.stats.finalVersion}</span>
            </div>

            {/* Apply Button */}
            <button
              onClick={applyWeights}
              disabled={applied}
              className={`w-full py-3 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 ${
                applied
                  ? "bg-neon/15 border border-neon/25 text-neon"
                  : "bg-neon/15 border border-neon/25 text-neon hover:bg-neon/25 active:scale-[0.98]"
              }`}
            >
              {applied ? (
                <><CheckCircle className="w-4 h-4" /> Weights Applied — Model Updated</>
              ) : (
                <><Zap className="w-4 h-4" /> Apply Trained Weights to Live Model</>
              )}
            </button>

            {!applied && (
              <p className="text-[10px] text-mercury/50 text-center">
                This replaces the current model weights with the historically optimized ones.
                The model will continue learning from new bets going forward.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
