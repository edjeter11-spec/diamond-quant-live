"use client";

import { useState, useEffect } from "react";
import {
  Brain, Cpu, Database, TrendingUp, TrendingDown, Activity,
  Zap, Target, Shield, BookOpen, Eye, ChevronDown,
  BarChart3, Star, Clock, Flame, CheckCircle, AlertTriangle,
} from "lucide-react";
import { loadBrain, loadBrainFromCloud, getBrainSummary, type BrainState } from "@/lib/bot/brain";

export default function BrainViz() {
  const [brain, setBrain] = useState<BrainState | null>(null);
  const [activeView, setActiveView] = useState<"thoughts" | "pitchers" | "parks" | "matchups" | "timeline">("thoughts");

  useEffect(() => {
    // Try cloud first (has full pitcher/park/matchup memory), fall back to local
    loadBrainFromCloud().then(b => setBrain(b)).catch(() => setBrain(loadBrain()));
  }, []);

  if (!brain || !brain.isPreTrained) return null;

  const summary = getBrainSummary(brain);
  const pitcherCount = Object.keys(brain.pitcherMemory ?? {}).length;
  const parkCount = Object.keys(brain.parkMemory ?? {}).length;
  const matchupCount = Object.keys(brain.matchupMemory ?? {}).length;

  // Generate "thoughts" — what the brain currently believes
  const thoughts = generateThoughts(brain);

  return (
    <div className="glass rounded-xl overflow-hidden border border-purple/15">
      {/* Header — Brain identity */}
      <div className="px-4 py-4 bg-gradient-to-r from-purple/10 via-electric/5 to-neon/5 border-b border-purple/15">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple/30 to-electric/20 flex items-center justify-center border border-purple/20">
              <Brain className="w-6 h-6 text-purple" />
            </div>
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-neon rounded-full animate-pulse" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-bold text-silver">Diamond-Quant Brain</h2>
            <p className="text-[10px] text-mercury/60 font-mono">{summary.version} • Epoch {summary.epoch} • {summary.totalGamesProcessed.toLocaleString()} games learned</p>
          </div>
          <div className="text-right">
            <p className={`text-lg font-bold font-mono ${summary.overallWinRate > 52 ? "text-neon" : "text-silver"}`}>
              {summary.overallWinRate}%
            </p>
            <p className="text-[9px] text-mercury">accuracy</p>
          </div>
        </div>

        {/* Knowledge stats */}
        <div className="grid grid-cols-4 gap-2 mt-3">
          <KnowledgeStat icon={Database} label="Seasons" value={brain.trainedSeasons?.join(", ") ?? "?"} color="text-purple" />
          <KnowledgeStat icon={Target} label="Pitchers" value={String(pitcherCount)} color="text-electric" />
          <KnowledgeStat icon={Shield} label="Parks" value={String(parkCount)} color="text-neon" />
          <KnowledgeStat icon={Activity} label="Matchups" value={String(matchupCount)} color="text-amber" />
        </div>
      </div>

      {/* View tabs */}
      <div className="flex border-b border-slate/20 overflow-x-auto scrollbar-hide">
        {[
          { key: "thoughts" as const, label: "Thoughts", icon: Brain },
          { key: "pitchers" as const, label: "Pitchers", icon: Target },
          { key: "parks" as const, label: "Parks", icon: Shield },
          { key: "matchups" as const, label: "Matchups", icon: Zap },
          { key: "timeline" as const, label: "Timeline", icon: Clock },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveView(tab.key)}
            className={`flex items-center gap-1 px-3 py-2 text-[11px] font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
              activeView === tab.key
                ? "text-electric border-b-2 border-electric bg-electric/5"
                : "text-mercury hover:text-silver"
            }`}
          >
            <tab.icon className="w-3 h-3" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="max-h-[400px] overflow-y-auto">
        {activeView === "thoughts" && <ThoughtsView thoughts={thoughts} brain={brain} summary={summary} />}
        {activeView === "pitchers" && <PitchersView brain={brain} />}
        {activeView === "parks" && <ParksView brain={brain} />}
        {activeView === "matchups" && <MatchupsView brain={brain} />}
        {activeView === "timeline" && <TimelineView brain={brain} />}
      </div>
    </div>
  );
}

// ── Thoughts: What the brain currently believes ──

function ThoughtsView({ thoughts, brain, summary }: { thoughts: string[]; brain: BrainState; summary: any }) {
  return (
    <div className="p-4 space-y-3">
      {/* Current beliefs */}
      <div className="rounded-lg bg-purple/5 border border-purple/15 p-3">
        <p className="text-[9px] text-purple uppercase tracking-wider mb-2 font-semibold flex items-center gap-1">
          <Brain className="w-3 h-3" /> What I've Learned
        </p>
        <div className="space-y-2">
          {thoughts.map((t, i) => (
            <div key={i} className="flex items-start gap-2 animate-slide-up" style={{ animationDelay: `${i * 100}ms` }}>
              <Zap className="w-3 h-3 text-electric flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-silver leading-relaxed">{t}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Priorities */}
      <div className="rounded-lg bg-gunmetal/20 p-3">
        <p className="text-[9px] text-mercury uppercase tracking-wider mb-2 font-semibold flex items-center gap-1">
          <Star className="w-3 h-3" /> Current Priorities
        </p>
        <div className="space-y-1.5">
          {Object.entries(brain.weights).sort(([,a], [,b]) => (b as number) - (a as number)).slice(0, 4).map(([key, val], i) => (
            <div key={key} className="flex items-center gap-2">
              <span className="text-[10px] text-mercury w-16 capitalize">{key}</span>
              <div className="flex-1 h-2 bg-gunmetal rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-purple to-electric rounded-full transition-all" style={{ width: `${(val as number) * 400}%` }} />
              </div>
              <span className="text-[10px] font-mono text-silver w-10 text-right">{((val as number) * 100).toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* Market intelligence */}
      <div className="rounded-lg bg-gunmetal/20 p-3">
        <p className="text-[9px] text-mercury uppercase tracking-wider mb-2 font-semibold">Market Confidence</p>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(brain.markets).filter(([,m]) => (m as any).totalBets > 0).map(([key, market]: [string, any]) => (
            <div key={key} className="p-2 rounded bg-bunker/50">
              <p className="text-[10px] text-silver capitalize font-semibold">{key.replace("_", " ")}</p>
              <p className={`text-sm font-mono font-bold ${market.winRate > 52 ? "text-neon" : market.winRate < 48 ? "text-danger" : "text-silver"}`}>
                {market.winRate.toFixed(1)}%
              </p>
              <p className="text-[8px] text-mercury">{market.wins}W-{market.losses}L • min {market.dynamicThreshold.toFixed(1)}% edge</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Pitchers: What the brain knows about each pitcher ──

function PitchersView({ brain }: { brain: BrainState }) {
  const pitchers = Object.values(brain.pitcherMemory ?? {})
    .filter((p: any) => p.gamesTracked >= 5)
    .sort((a: any, b: any) => b.gamesTracked - a.gamesTracked);

  if (pitchers.length === 0) return <div className="p-6 text-center text-mercury text-sm">No pitcher data yet — will build as games settle</div>;

  return (
    <div className="divide-y divide-slate/10">
      {pitchers.slice(0, 30).map((p: any, i: number) => (
        <div key={i} className="px-4 py-2.5 flex items-center gap-2">
          <div className={`w-1.5 h-8 rounded-full flex-shrink-0 ${p.winRate > 55 ? "bg-neon" : p.winRate > 45 ? "bg-electric" : "bg-danger"}`} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-silver truncate">{p.name}</p>
            <p className="text-[9px] text-mercury/60">{p.gamesTracked} games tracked • NRFI: {p.nrfiRate}%</p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className={`text-sm font-mono font-bold ${p.winRate > 55 ? "text-neon" : p.winRate < 45 ? "text-danger" : "text-silver"}`}>
              {p.winRate}%
            </p>
            <p className="text-[8px] text-mercury">{p.wins}W-{p.losses}L</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Parks: Stadium intelligence ──

function ParksView({ brain }: { brain: BrainState }) {
  const parks = Object.entries(brain.parkMemory ?? {})
    .filter(([, p]: [string, any]) => p.games >= 10)
    .sort(([, a]: [string, any], [, b]: [string, any]) => b.avgRuns - a.avgRuns);

  if (parks.length === 0) return <div className="p-6 text-center text-mercury text-sm">No park data yet</div>;

  return (
    <div className="divide-y divide-slate/10">
      {parks.map(([name, p]: [string, any], i: number) => {
        const homeRate = p.games > 0 ? Math.round((p.homeWins / p.games) * 100) : 50;
        return (
          <div key={i} className="px-4 py-2.5 flex items-center gap-2">
            <div className={`w-1.5 h-8 rounded-full flex-shrink-0 ${p.avgRuns > 9 ? "bg-danger" : p.avgRuns > 8 ? "bg-amber" : "bg-neon"}`} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-silver truncate">{name}</p>
              <p className="text-[9px] text-mercury/60">{p.games} games • Home wins: {homeRate}% • NRFI: {Math.round(p.nrfiRate)}%</p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className={`text-sm font-mono font-bold ${p.avgRuns > 9 ? "text-danger" : p.avgRuns < 8 ? "text-neon" : "text-silver"}`}>
                {p.avgRuns.toFixed(1)}
              </p>
              <p className="text-[8px] text-mercury">avg runs</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Matchups: Team vs team ──

function MatchupsView({ brain }: { brain: BrainState }) {
  const matchups = Object.entries(brain.matchupMemory ?? {})
    .filter(([, m]: [string, any]) => m.games >= 3)
    .sort(([, a]: [string, any], [, b]: [string, any]) => b.games - a.games);

  if (matchups.length === 0) return <div className="p-6 text-center text-mercury text-sm">No matchup data yet</div>;

  return (
    <div className="divide-y divide-slate/10">
      {matchups.slice(0, 30).map(([key, m]: [string, any], i: number) => {
        const teams = key.split("::");
        const homeRate = m.games > 0 ? Math.round((m.homeWins / m.games) * 100) : 50;
        return (
          <div key={i} className="px-4 py-2.5 flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-silver truncate capitalize">
                {teams[0]?.split(" ").pop()} @ {teams[1]?.split(" ").pop()}
              </p>
              <p className="text-[9px] text-mercury/60">{m.games} games • Home: {m.homeWins}W-{m.games - m.homeWins}L</p>
            </div>
            <div className="w-20 h-2 bg-gunmetal rounded-full overflow-hidden flex">
              <div className="h-full bg-neon/50" style={{ width: `${homeRate}%` }} />
              <div className="h-full bg-danger/50" style={{ width: `${100 - homeRate}%` }} />
            </div>
            <span className="text-[10px] font-mono text-mercury w-10 text-right">{homeRate}%</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Timeline: Recent learning events ──

function TimelineView({ brain }: { brain: BrainState }) {
  const logs = [...(brain.logs ?? [])].reverse().slice(0, 30);
  const typeIcons: Record<string, any> = { train: Database, learn: Brain, adjust: Zap, swap: Activity, error: AlertTriangle };
  const typeColors: Record<string, string> = { train: "text-purple", learn: "text-electric", adjust: "text-amber", swap: "text-neon", error: "text-danger" };

  return (
    <div className="p-3 space-y-1">
      {logs.map((log, i) => {
        const Icon = typeIcons[log.type] ?? Brain;
        const color = typeColors[log.type] ?? "text-mercury";
        return (
          <div key={i} className="flex items-start gap-2 py-1 animate-slide-up" style={{ animationDelay: `${i * 30}ms` }}>
            <Icon className={`w-3 h-3 mt-0.5 flex-shrink-0 ${color}`} />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-mercury leading-relaxed">{log.message}</p>
              <p className="text-[8px] text-mercury/40">{new Date(log.timestamp).toLocaleString()}</p>
            </div>
          </div>
        );
      })}
      {logs.length === 0 && <p className="text-center text-mercury/40 text-sm py-4">No events yet</p>}
    </div>
  );
}

// ── Helper components ──

function KnowledgeStat({ icon: Icon, label, value, color }: { icon: any; label: string; value: string; color: string }) {
  return (
    <div className="text-center p-2 rounded-lg bg-gunmetal/30">
      <Icon className={`w-3.5 h-3.5 ${color} mx-auto mb-0.5`} />
      <p className="text-xs font-bold font-mono text-silver">{value}</p>
      <p className="text-[8px] text-mercury/50">{label}</p>
    </div>
  );
}

// ── Generate brain thoughts from current state ──

function generateThoughts(brain: BrainState): string[] {
  const thoughts: string[] = [];
  const w = brain.weights;

  // Weight insights
  const topWeight = Object.entries(w).sort(([,a], [,b]) => (b as number) - (a as number))[0];
  thoughts.push(`I currently weight ${topWeight[0]} highest at ${((topWeight[1] as number) * 100).toFixed(1)}%. This means I believe ${topWeight[0] === "pitching" ? "the starting pitcher is the most important factor in predicting game outcomes" : topWeight[0] === "bullpen" ? "bullpen quality is the dominant factor, especially in late-game situations" : topWeight[0] === "hitting" ? "offensive production is the strongest predictor of wins" : `${topWeight[0]} is the most influential factor right now`}.`);

  // Market insights
  const bestMarket = Object.entries(brain.markets).filter(([,m]) => (m as any).totalBets > 10).sort(([,a]: any, [,b]: any) => b.winRate - a.winRate)[0];
  if (bestMarket) {
    const m = bestMarket[1] as any;
    thoughts.push(`My strongest market is ${bestMarket[0]}: ${m.winRate.toFixed(1)}% accuracy over ${m.totalBets} predictions. I've ${m.winRate > 53 ? "earned confidence here and lowered my minimum edge to " + m.dynamicThreshold.toFixed(1) + "%." : "set a higher " + m.dynamicThreshold.toFixed(1) + "% minimum edge because I need more certainty before betting."}`);
  }

  // Pitcher insights
  const topPitchers = Object.values(brain.pitcherMemory ?? {}).filter((p: any) => p.gamesTracked >= 10).sort((a: any, b: any) => b.winRate - a.winRate);
  if (topPitchers.length >= 3) {
    const best = topPitchers[0] as any;
    const worst = topPitchers[topPitchers.length - 1] as any;
    thoughts.push(`I've tracked ${topPitchers.length} pitchers with 10+ games. ${best.name} has the highest win rate I've seen (${best.winRate}% in ${best.gamesTracked} games). ${worst.name} is at ${worst.winRate}% — when I see them start, I lean the other way.`);
  }

  // Park insights
  const parks = Object.entries(brain.parkMemory ?? {}).filter(([,p]: any) => p.games >= 20);
  if (parks.length > 0) {
    const highest = parks.sort(([,a]: any, [,b]: any) => b.avgRuns - a.avgRuns)[0];
    const lowest = parks.sort(([,a]: any, [,b]: any) => a.avgRuns - b.avgRuns)[0];
    thoughts.push(`${highest[0]} averages ${(highest[1] as any).avgRuns.toFixed(1)} runs/game — I boost Overs there. ${lowest[0]} is the opposite at ${(lowest[1] as any).avgRuns.toFixed(1)} — pitcher-friendly, I favor Unders and NRFI.`);
  }

  // NRFI insight
  const nrfiParks = Object.entries(brain.parkMemory ?? {}).filter(([,p]: any) => p.games >= 20 && p.nrfiRate > 75);
  if (nrfiParks.length > 0) {
    thoughts.push(`Best NRFI parks I've found: ${nrfiParks.slice(0, 3).map(([name, p]: any) => `${name} (${Math.round(p.nrfiRate)}%)`).join(", ")}. I weight these heavily in first-inning analysis.`);
  }

  // Learning speed
  thoughts.push(`I've processed ${brain.totalGamesProcessed.toLocaleString()} games across ${brain.trainedSeasons?.length ?? 0} seasons. Every game that finishes today feeds back into my weights. My learning rate is ${brain.learningRate} — slow and stable to avoid overreacting to individual results.`);

  // Recent accuracy
  const recentGames = brain.recentGames?.slice(-10) ?? [];
  if (recentGames.length >= 5) {
    const recentCorrect = recentGames.filter(g => {
      const right = (g.actual === "home" && g.prediction > 0.5) || (g.actual === "away" && g.prediction < 0.5);
      return right;
    }).length;
    thoughts.push(`My last ${recentGames.length} predictions: ${recentCorrect}/${recentGames.length} correct (${Math.round(recentCorrect/recentGames.length*100)}%). ${recentCorrect > recentGames.length * 0.55 ? "I'm in a hot streak — current approach is working." : recentCorrect < recentGames.length * 0.45 ? "Recent results are below target — I'm adjusting weights to compensate." : "Right around expected performance."}`);
  }

  return thoughts;
}
