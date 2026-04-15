"use client";

import { useState, useEffect } from "react";
import { Diamond, Trophy, TrendingUp, TrendingDown, BarChart3, Target, CheckCircle, XCircle, Brain, Zap, Crown, Shield } from "lucide-react";

export default function ResultsPage() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    // Load from Supabase (public data)
    async function load() {
      try {
        const res = await fetch("https://grbswzfizblkekrzhadw.supabase.co/rest/v1/app_state?select=key,value&key=in.(smart_bot,model_accuracy,brain,clv_mlb,clv_nba,elo_mlb,elo_nba)", {
          headers: {
            "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdyYnN3emZpemJsa2VrcnpoYWR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNzI4MjUsImV4cCI6MjA5MDg0ODgyNX0.z-QDBxdxVaFCrNbyHChh9wC0lrwh9aE91-LJ_Fq5G9k",
          },
        });
        if (res.ok) {
          const rows = await res.json();
          const d: any = {};
          for (const row of rows) d[row.key] = row.value;
          setData(d);
        }
      } catch {}
    }
    load();
  }, []);

  const bot = data?.smart_bot;
  const accuracy = data?.model_accuracy;
  const brain = data?.brain;
  const clvRecords = data?.clv_mlb ?? [];
  const eloState = data?.elo_mlb;

  // CLV summary
  const clvWithClosing = clvRecords.filter((r: any) => r.closingOdds !== 0);
  const clvBeatCount = clvWithClosing.filter((r: any) => r.beatClosing).length;
  const clvBeatRate = clvWithClosing.length > 0 ? (clvBeatCount / clvWithClosing.length) * 100 : 0;
  const avgCLV = clvWithClosing.length > 0
    ? clvWithClosing.reduce((s: number, r: any) => s + (r.clvPercent ?? 0), 0) / clvWithClosing.length : 0;
  const isSharp = clvWithClosing.length >= 10 && clvBeatRate > 55;

  // Elo top teams
  const eloTeams = eloState?.teams ? Object.values(eloState.teams)
    .filter((t: any) => t.gamesPlayed >= 5)
    .sort((a: any, b: any) => b.rating - a.rating)
    .slice(0, 10) : [];

  const settled = bot?.picks?.filter((p: any) => p.result !== "pending") ?? [];
  const wins = settled.filter((p: any) => p.result === "win").length;
  const losses = settled.filter((p: any) => p.result === "loss").length;
  const totalStaked = settled.reduce((s: number, p: any) => s + (p.stake ?? 0), 0);
  const totalReturns = settled.reduce((s: number, p: any) => s + (p.payout ?? 0), 0);
  const profit = totalReturns - totalStaked;
  const roi = totalStaked > 0 ? (profit / totalStaked) * 100 : 0;
  const winRate = (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-[#c4c8d8]">
      {/* Header */}
      <div className="max-w-4xl mx-auto px-4 pt-8 pb-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#00ff88]/20 to-[#00d4ff]/20 flex items-center justify-center border border-[#00ff88]/20">
            <Diamond className="w-5 h-5 text-[#00ff88]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Diamond-Quant Live</h1>
            <p className="text-xs text-[#8b8fa3] font-mono">PUBLIC BOT RESULTS — VERIFIED PICKS</p>
          </div>
        </div>
        <p className="text-sm text-[#8b8fa3] mt-2">
          Transparent results from our 3-model AI system. Every pick, every result, no edits.
        </p>
      </div>

      {/* Stats */}
      <div className="max-w-4xl mx-auto px-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatCard label="Record" value={`${wins}W-${losses}L`} color={winRate > 52 ? "#00ff88" : "#c4c8d8"} />
          <StatCard label="Win Rate" value={`${winRate.toFixed(1)}%`} color={winRate > 52 ? "#00ff88" : winRate < 48 ? "#ff3b5c" : "#c4c8d8"} />
          <StatCard label="ROI" value={`${roi >= 0 ? "+" : ""}${roi.toFixed(1)}%`} color={roi > 0 ? "#00ff88" : "#ff3b5c"} />
          <StatCard label="Profit" value={`${profit >= 0 ? "+" : ""}$${profit.toFixed(0)}`} color={profit >= 0 ? "#00ff88" : "#ff3b5c"} />
        </div>

        {/* Model accuracy */}
        {accuracy?.consensus?.total > 0 && (
          <div className="rounded-xl bg-[#0f1117] border border-[#2a2d3e]/50 p-4 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Brain className="w-4 h-4 text-[#00d4ff]" />
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">Model Accuracy</h2>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <ModelStat name="Pitcher" rate={accuracy.pitcher?.winRate ?? 0} total={accuracy.pitcher?.total ?? 0} />
              <ModelStat name="Market" rate={accuracy.market?.winRate ?? 0} total={accuracy.market?.total ?? 0} />
              <ModelStat name="Trend" rate={accuracy.trend?.winRate ?? 0} total={accuracy.trend?.total ?? 0} />
              <ModelStat name="Consensus" rate={accuracy.consensus?.winRate ?? 0} total={accuracy.consensus?.total ?? 0} />
            </div>
          </div>
        )}

        {/* CLV Edge Proof */}
        {clvWithClosing.length > 0 && (
          <div className="rounded-xl bg-[#0f1117] border border-[#2a2d3e]/50 p-4 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-[#a855f7]" />
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">Closing Line Value</h2>
              {isSharp && (
                <span className="px-1.5 py-0.5 rounded bg-[#00ff88]/10 text-[#00ff88] text-[9px] font-bold">SHARP</span>
              )}
            </div>
            <p className="text-xs text-[#8b8fa3] mb-3">
              CLV measures if we get better odds than the market closing line. Beating the close consistently = proven edge.
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <p className={`text-lg font-bold font-mono ${clvBeatRate > 55 ? "text-[#00ff88]" : "text-[#c4c8d8]"}`}>
                  {clvBeatRate.toFixed(1)}%
                </p>
                <p className="text-[8px] text-[#8b8fa3]">Beat Rate ({clvWithClosing.length} bets)</p>
              </div>
              <div className="text-center">
                <p className={`text-lg font-bold font-mono ${avgCLV > 0 ? "text-[#00ff88]" : "text-[#ff3b5c]"}`}>
                  {avgCLV > 0 ? "+" : ""}{avgCLV.toFixed(2)}%
                </p>
                <p className="text-[8px] text-[#8b8fa3]">Avg CLV</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold font-mono text-[#c4c8d8]">{clvRecords.length}</p>
                <p className="text-[8px] text-[#8b8fa3]">Total Tracked</p>
              </div>
            </div>
          </div>
        )}

        {/* Elo Power Rankings */}
        {eloTeams.length > 0 && (
          <div className="rounded-xl bg-[#0f1117] border border-[#2a2d3e]/50 p-4 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Crown className="w-4 h-4 text-[#f59e0b]" />
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">Power Rankings (Elo)</h2>
              <span className="text-[9px] text-[#8b8fa3] ml-auto">{eloState?.totalGamesProcessed ?? 0} games processed</span>
            </div>
            <div className="space-y-1">
              {eloTeams.map((team: any, i: number) => (
                <div key={team.team} className="flex items-center gap-2 px-2 py-1.5 rounded bg-[#1a1d2e]/50">
                  <span className={`text-[10px] font-bold w-5 text-center ${i === 0 ? "text-[#f59e0b]" : i < 3 ? "text-[#00ff88]" : "text-[#8b8fa3]"}`}>
                    {i + 1}
                  </span>
                  <p className="text-xs text-white flex-1 font-medium">{team.team}</p>
                  <p className="text-xs font-mono text-[#00d4ff] font-bold">{team.rating}</p>
                  <p className="text-[9px] text-[#8b8fa3] w-14 text-right">{team.wins}W-{team.losses}L</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Brain info */}
        {brain && (
          <div className="rounded-xl bg-[#0f1117] border border-[#2a2d3e]/50 p-4 mb-6">
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-4 h-4 text-[#a855f7]" />
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">Intelligence</h2>
            </div>
            <p className="text-xs text-[#8b8fa3]">
              Model {brain.version} • Trained on {brain.totalGamesProcessed?.toLocaleString() ?? 0} games •
              Knows {Object.keys(brain.pitcherMemory ?? {}).length} pitchers,{" "}
              {Object.keys(brain.parkMemory ?? {}).length} parks,{" "}
              {Object.keys(brain.matchupMemory ?? {}).length} matchups
            </p>
          </div>
        )}

        {/* Recent picks */}
        <div className="rounded-xl bg-[#0f1117] border border-[#2a2d3e]/50 overflow-hidden mb-8">
          <div className="px-4 py-3 border-b border-[#2a2d3e]/50">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Recent Picks</h2>
          </div>
          {settled.length === 0 ? (
            <div className="p-8 text-center text-[#8b8fa3] text-sm">No settled picks yet — check back after games finish</div>
          ) : (
            <div className="divide-y divide-[#2a2d3e]/30">
              {[...settled].reverse().slice(0, 20).map((pick: any, i: number) => (
                <div key={i} className="px-4 py-3 flex items-center gap-3">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                    pick.result === "win" ? "bg-[#00ff88]/15" : "bg-[#ff3b5c]/15"
                  }`}>
                    {pick.result === "win" ? <CheckCircle className="w-3.5 h-3.5 text-[#00ff88]" /> : <XCircle className="w-3.5 h-3.5 text-[#ff3b5c]" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-white truncate">{pick.pick}</p>
                    <p className="text-[10px] text-[#8b8fa3] truncate">{pick.game} • {pick.date}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs font-mono text-white">{pick.odds > 0 ? "+" : ""}{pick.odds}</p>
                    <p className={`text-[10px] font-mono ${(pick.payout - pick.stake) >= 0 ? "text-[#00ff88]" : "text-[#ff3b5c]"}`}>
                      {(pick.payout - pick.stake) >= 0 ? "+" : ""}${(pick.payout - pick.stake).toFixed(0)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-center pb-8">
          <p className="text-[10px] text-[#8b8fa3]/50 font-mono">
            Diamond-Quant Live — AI-Powered Sports Intelligence
          </p>
          <a href="/" className="text-[10px] text-[#00d4ff] hover:text-[#00ff88] transition-colors">
            ← Back to Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl bg-[#0f1117] border border-[#2a2d3e]/50 p-3 text-center">
      <p className="text-lg font-bold font-mono" style={{ color }}>{value}</p>
      <p className="text-[9px] text-[#8b8fa3] uppercase">{label}</p>
    </div>
  );
}

function ModelStat({ name, rate, total }: { name: string; rate: number; total: number }) {
  return (
    <div className="text-center">
      <p className={`text-sm font-bold font-mono ${rate > 52 ? "text-[#00ff88]" : rate > 48 ? "text-[#c4c8d8]" : "text-[#ff3b5c]"}`}>
        {rate.toFixed(1)}%
      </p>
      <p className="text-[8px] text-[#8b8fa3]">{name} ({total})</p>
    </div>
  );
}
