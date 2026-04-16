"use client";

import { useState, useEffect } from "react";
import { useStore } from "@/lib/store";
import { useSport } from "@/lib/sport-context";
import {
  Shield, ChevronDown, Target, Flame, CheckCircle, XCircle,
  TrendingUp, Clock, Brain, RefreshCw, Zap, ExternalLink,
} from "lucide-react";
import { analyzeNRFI, type NRFIGame } from "@/lib/bot/nrfi-engine";
import { getDeepLink } from "@/lib/odds/sportsbooks";

const GRADE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  A: { bg: "bg-neon/10", text: "text-neon", border: "border-neon/20" },
  B: { bg: "bg-electric/10", text: "text-electric", border: "border-electric/20" },
  C: { bg: "bg-amber/10", text: "text-amber", border: "border-amber/20" },
  D: { bg: "bg-danger/10", text: "text-danger", border: "border-danger/20" },
  F: { bg: "bg-danger/15", text: "text-danger", border: "border-danger/25" },
};

const REC_LABELS: Record<string, { label: string; color: string }> = {
  NRFI: { label: "BET NRFI", color: "text-neon" },
  LEAN_NRFI: { label: "LEAN NRFI", color: "text-electric" },
  YRFI: { label: "BET YRFI", color: "text-danger" },
  LEAN_YRFI: { label: "LEAN YRFI", color: "text-amber" },
  SKIP: { label: "SKIP", color: "text-mercury" },
};

export default function NRFITab() {
  const { scores, addParlayLeg } = useStore();
  const { currentSport } = useSport();
  const isNBA = currentSport === "nba";
  const [games, setGames] = useState<NRFIGame[]>([]);
  const [loading, setLoading] = useState(true);

  // NBA Q1 analysis — show placeholder until Q1 engine is built
  if (isNBA) {
    return (
      <div className="space-y-3">
        <div className="glass rounded-xl p-5 border border-orange-500/15">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-5 h-5 text-orange-500" />
            <h2 className="text-sm font-bold text-silver uppercase tracking-wider">Q1 Analysis</h2>
          </div>
          <p className="text-xs text-mercury mb-2">
            First quarter scoring analysis for NBA games. Analyzes team pace, starters' scoring tendencies,
            and historical Q1 performance to project first quarter totals.
          </p>
          <div className="rounded-lg bg-gunmetal/30 p-4 text-center">
            <Brain className="w-8 h-8 text-orange-500/30 mx-auto mb-2" />
            <p className="text-sm text-mercury">Q1 engine processing today's games...</p>
            <p className="text-[10px] text-mercury/50 mt-1">NBA Q1 projections based on pace, starters, and defensive matchups</p>
          </div>
        </div>
      </div>
    );
  }
  const [expandedGame, setExpandedGame] = useState<string | null>(null);

  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => {
    if (scores.length === 0 || hasLoaded) return;
    setLoading(true);
    analyzeNRFI(scores).then(results => {
      setGames(results);
      setLoading(false);
      setHasLoaded(true);
    }).catch(() => { setLoading(false); setHasLoaded(true); });
  }, [scores, hasLoaded]);

  // Separate upcoming from live/settled
  const upcoming = games.filter(g => g.status === "pre");
  const live = games.filter(g => g.status === "live");

  // Top 3 NRFI picks
  const topNRFI = upcoming.filter(g => g.recommendation.includes("NRFI")).slice(0, 3);
  const topYRFI = upcoming.filter(g => g.recommendation.includes("YRFI")).slice(0, 3);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="glass rounded-xl p-8 text-center">
          <RefreshCw className="w-6 h-6 text-electric animate-spin mx-auto mb-2" />
          <p className="text-sm text-mercury">Analyzing first inning matchups...</p>
          <p className="text-[10px] text-mercury/50 mt-1">Checking pitcher NRFI rates, park factors, and K rates</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="glass rounded-xl p-4 border border-electric/15">
        <div className="flex items-center gap-2 mb-2">
          <Shield className="w-5 h-5 text-electric" />
          <h2 className="text-sm font-bold text-silver uppercase tracking-wider">First Inning Analysis</h2>
        </div>
        <p className="text-xs text-mercury">
          NRFI (No Run First Inning) and YRFI (Yes Run) predictions based on pitcher ERA, WHIP, K/9,
          park factors, and historical first inning performance.
        </p>
      </div>

      {/* Top NRFI Picks */}
      {topNRFI.length > 0 && (
        <div className="glass rounded-xl overflow-hidden border border-neon/15">
          <div className="px-4 py-3 bg-neon/5 border-b border-neon/15 flex items-center gap-2">
            <Shield className="w-4 h-4 text-neon" />
            <h3 className="text-xs font-bold text-neon uppercase tracking-wider">Top NRFI Plays</h3>
            <span className="text-[9px] text-mercury/50 ml-auto">Highest probability clean 1st innings</span>
          </div>
          <div className="divide-y divide-slate/10">
            {topNRFI.map(game => (
              <GameRow key={game.gameId} game={game} expanded={expandedGame === game.gameId}
                onToggle={() => setExpandedGame(expandedGame === game.gameId ? null : game.gameId)}
                addParlayLeg={addParlayLeg} />
            ))}
          </div>
        </div>
      )}

      {/* Top YRFI Picks */}
      {topYRFI.length > 0 && (
        <div className="glass rounded-xl overflow-hidden border border-danger/15">
          <div className="px-4 py-3 bg-danger/5 border-b border-danger/15 flex items-center gap-2">
            <Flame className="w-4 h-4 text-danger" />
            <h3 className="text-xs font-bold text-danger uppercase tracking-wider">Top YRFI Plays</h3>
            <span className="text-[9px] text-mercury/50 ml-auto">Expect first inning fireworks</span>
          </div>
          <div className="divide-y divide-slate/10">
            {topYRFI.map(game => (
              <GameRow key={game.gameId} game={game} expanded={expandedGame === game.gameId}
                onToggle={() => setExpandedGame(expandedGame === game.gameId ? null : game.gameId)}
                addParlayLeg={addParlayLeg} />
            ))}
          </div>
        </div>
      )}

      {/* All Games */}
      <div className="glass rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate/30 flex items-center gap-2">
          <Target className="w-4 h-4 text-mercury" />
          <h3 className="text-xs font-bold text-silver uppercase tracking-wider">All Games — NRFI Heatmap</h3>
          <span className="text-[9px] text-mercury/50 ml-auto">{upcoming.length} upcoming</span>
        </div>
        <div className="divide-y divide-slate/10">
          {upcoming.length === 0 ? (
            <div className="p-6 text-center">
              <p className="text-sm text-mercury">No upcoming games with pitcher data</p>
            </div>
          ) : (
            upcoming.map(game => (
              <GameRow key={game.gameId} game={game} expanded={expandedGame === game.gameId}
                onToggle={() => setExpandedGame(expandedGame === game.gameId ? null : game.gameId)}
                addParlayLeg={addParlayLeg} />
            ))
          )}
        </div>
      </div>

      {/* Live/In Progress */}
      {live.length > 0 && (
        <div className="glass rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate/30 flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber" />
            <h3 className="text-xs font-bold text-amber uppercase tracking-wider">In Progress</h3>
          </div>
          <div className="divide-y divide-slate/10">
            {live.map(game => (
              <GameRow key={game.gameId} game={game} expanded={false} onToggle={() => {}} addParlayLeg={addParlayLeg} compact />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Game Row ──

function GameRow({ game, expanded, onToggle, addParlayLeg, compact }: {
  game: NRFIGame; expanded: boolean; onToggle: () => void; addParlayLeg: any; compact?: boolean;
}) {
  const grade = GRADE_COLORS[game.nrfiGrade] ?? GRADE_COLORS.C;
  const rec = REC_LABELS[game.recommendation] ?? REC_LABELS.SKIP;

  // Heatmap color: green (NRFI safe) → red (YRFI danger)
  const heatColor = game.dangerLevel < 35 ? "bg-neon" : game.dangerLevel < 50 ? "bg-electric" : game.dangerLevel < 65 ? "bg-amber" : "bg-danger";

  return (
    <div>
      <button onClick={onToggle} className="w-full px-3 sm:px-4 py-3 flex items-center gap-2 hover:bg-gunmetal/20 text-left">
        {/* Heatmap indicator */}
        <div className={`w-2 h-8 rounded-full ${heatColor} flex-shrink-0`} title={`Danger: ${game.dangerLevel}%`} />

        {/* Grade */}
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 ${grade.bg} ${grade.text} ${grade.border} border`}>
          {game.nrfiGrade}
        </div>

        {/* Matchup */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gunmetal text-mercury font-bold">{game.awayAbbrev}</span>
            <span className="text-[9px] text-mercury/40">@</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gunmetal text-mercury font-bold">{game.homeAbbrev}</span>
            <span className={`text-[9px] font-bold ${rec.color} ml-1`}>{rec.label}</span>
          </div>
          <p className="text-[9px] text-mercury/50 truncate mt-0.5">
            {game.commenceTime && new Date(game.commenceTime).toLocaleString("en-US", { hour: "numeric", minute: "2-digit" })}
            {" — "}{game.awayPitcher.name} vs {game.homePitcher.name}
          </p>
        </div>

        {/* NRFI Probability */}
        <div className="text-right flex-shrink-0">
          <p className={`text-sm font-bold font-mono ${game.nrfiProb >= 60 ? "text-neon" : game.nrfiProb >= 50 ? "text-electric" : "text-danger"}`}>
            {game.nrfiProb}%
          </p>
          <p className="text-[8px] text-mercury/50">NRFI</p>
        </div>

        {!compact && <ChevronDown className={`w-3.5 h-3.5 text-mercury/40 flex-shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />}
      </button>

      {expanded && (
        <div className="px-3 sm:px-4 pb-4 animate-slide-up space-y-3">
          {/* Rationale */}
          <div className="flex gap-2 p-3 rounded-lg bg-electric/5 border border-electric/15">
            <Brain className="w-4 h-4 text-electric flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-silver leading-relaxed">{game.rationale}</p>
          </div>

          {/* Pitcher Comparison */}
          <div className="grid grid-cols-2 gap-3">
            <PitcherCard pitcher={game.awayPitcher} side="Away" abbrev={game.awayAbbrev} />
            <PitcherCard pitcher={game.homePitcher} side="Home" abbrev={game.homeAbbrev} />
          </div>

          {/* NRFI vs YRFI bar */}
          <div className="flex items-center gap-2 px-1">
            <span className="text-[10px] text-neon font-bold">NRFI {game.nrfiProb}%</span>
            <div className="flex-1 h-3 bg-gunmetal rounded-full overflow-hidden flex">
              <div className="h-full bg-neon/50 rounded-l-full" style={{ width: `${game.nrfiProb}%` }} />
              <div className="h-full bg-danger/50 rounded-r-full" style={{ width: `${game.yrfiProb}%` }} />
            </div>
            <span className="text-[10px] text-danger font-bold">{game.yrfiProb}% YRFI</span>
          </div>

          {/* Factors */}
          <div className="rounded-lg bg-gunmetal/20 p-3">
            <p className="text-[9px] text-mercury uppercase tracking-wider mb-1.5 font-semibold">Analysis Factors</p>
            {game.factors.map((f, i) => (
              <p key={i} className="text-[11px] text-mercury flex gap-1 mb-0.5">
                <span className="text-electric">{'>'}</span> {f}
              </p>
            ))}
          </div>

          {/* Actions */}
          <div className="flex gap-1.5">
            <button onClick={() => addParlayLeg({
              game: `${game.awayTeam} @ ${game.homeTeam}`,
              market: "total",
              pick: `${game.awayAbbrev}/${game.homeAbbrev} NRFI`,
              odds: -115,
              fairProb: game.nrfiProb / 100,
              bookmaker: "Model",
            })} className="flex-1 py-2 rounded-lg bg-neon/10 border border-neon/20 text-neon text-[11px] font-semibold hover:bg-neon/20 transition-all flex items-center justify-center gap-1">
              <Shield className="w-3 h-3" /> NRFI
            </button>
            <button onClick={() => addParlayLeg({
              game: `${game.awayTeam} @ ${game.homeTeam}`,
              market: "total",
              pick: `${game.awayAbbrev}/${game.homeAbbrev} YRFI`,
              odds: -105,
              fairProb: game.yrfiProb / 100,
              bookmaker: "Model",
            })} className="flex-1 py-2 rounded-lg bg-danger/10 border border-danger/20 text-danger text-[11px] font-semibold hover:bg-danger/20 transition-all flex items-center justify-center gap-1">
              <Flame className="w-3 h-3" /> YRFI
            </button>
            <button onClick={() => {
              const { addBet } = useStore.getState();
              addBet({
                game: `${game.awayTeam} @ ${game.homeTeam}`,
                market: "total", pick: `NRFI`, bookmaker: "Model",
                odds: -115, stake: 50, result: "pending", payout: 0,
                isParlay: false, evAtPlacement: 0,
              });
            }} className="py-2 px-3 rounded-lg bg-gold/10 border border-gold/20 text-gold text-[11px] font-semibold hover:bg-gold/20 transition-all flex-shrink-0">
              Log $50
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PitcherCard({ pitcher, side, abbrev }: { pitcher: any; side: string; abbrev: string }) {
  return (
    <div className="rounded-lg bg-gunmetal/30 p-2.5">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-[9px] px-1 py-0.5 rounded bg-electric/15 text-electric font-bold">{abbrev}</span>
        <p className="text-xs font-semibold text-silver truncate">{pitcher.name}</p>
      </div>
      <div className="grid grid-cols-2 gap-1 text-[9px]">
        <span className="text-mercury">ERA: <span className="text-silver font-mono">{pitcher.era.toFixed(2)}</span></span>
        <span className="text-mercury">K/9: <span className="text-silver font-mono">{pitcher.k9}</span></span>
        <span className="text-mercury">WHIP: <span className="text-silver font-mono">{pitcher.whip.toFixed(2)}</span></span>
        <span className="text-mercury">NRFI: <span className={`font-mono font-bold ${pitcher.nrfiRate > 70 ? "text-neon" : pitcher.nrfiRate > 55 ? "text-electric" : "text-danger"}`}>{pitcher.nrfiRate}%</span></span>
      </div>
      <p className="text-[8px] text-mercury/50 mt-1">{pitcher.last5FirstInning}</p>
    </div>
  );
}
