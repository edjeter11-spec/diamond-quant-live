"use client";

import { useState, useEffect } from "react";
import {
  Zap,
  ChevronDown,
  Brain,
  AlertTriangle,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import PlayerAvatar from "@/components/ui/PlayerAvatar";
import TeamLogo from "@/components/ui/TeamLogo";
import InfoTip from "@/components/ui/InfoTip";

interface DingerCandidate {
  playerId: number;
  playerName: string;
  team: string;
  teamAbbrev: string;
  opponent: string;
  opponentAbbrev: string;
  gameTime: string;
  venue: string;
  venueAbbrev: string;
  isHome: boolean;
  pitcherName: string;
  pitcherHand: "L" | "R" | "?";
  hrVsHand: number;
  abVsHand: number;
  hrRateVsHand: number;
  seasonHrRate: number;
  smallSampleVsHand: boolean;
  parkHrFactor: number;
  weatherHittingImpact: number;
  parkWeatherSummary: string;
  last10HrRate: number;
  seasonHrRatePerGame: number;
  fatigueScore: number;
  fatigueNote: string;
  compositeScore: number;
  reasoning: string[];
  odds: {
    bookmaker: string;
    americanOdds: number;
    impliedProb: number;
    fairProb: number;
    evPct: number;
  } | null;
}

interface DingersResponse {
  candidates: DingerCandidate[];
  gamesAnalyzed: number;
  generatedAt: string;
  message?: string;
}

function TabSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="rounded-xl border border-slate/20 bg-gunmetal/20 p-3 flex items-center gap-3"
        >
          <div className="w-8 h-8 rounded-full bg-slate/20 flex-shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-1/2 bg-slate/20 rounded" />
            <div className="h-2.5 w-1/3 bg-slate/15 rounded" />
          </div>
          <div className="h-6 w-12 bg-slate/20 rounded" />
        </div>
      ))}
    </div>
  );
}

export default function DingersTab() {
  const [data, setData] = useState<DingersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/mlb-dingers")
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        setData(json);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="glass rounded-xl p-4 border border-amber/15">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber" />
            <h2 className="text-sm font-bold text-silver uppercase tracking-wider">
              Dingers
            </h2>
          </div>
          <p className="text-xs text-mercury mt-1">
            Ranking today's batters by home run probability...
          </p>
        </div>
        <TabSkeleton />
      </div>
    );
  }

  const candidates = data?.candidates ?? [];

  if (error || candidates.length === 0) {
    return (
      <div className="space-y-3">
        <div className="glass rounded-xl p-4 border border-amber/15">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber" />
            <h2 className="text-sm font-bold text-silver uppercase tracking-wider">
              Dingers
            </h2>
          </div>
          <p className="text-xs text-mercury mt-1">
            Ranks today's batters by home run probability — factoring in
            vs-handedness splits, park + weather, recent form, and fatigue.
          </p>
        </div>
        <div className="glass rounded-xl p-8 text-center">
          <Zap className="w-6 h-6 text-mercury/30 mx-auto mb-2" />
          <p className="text-sm text-mercury">
            {error
              ? "Dingers temporarily unavailable"
              : (data?.message ?? "No MLB games available right now")}
          </p>
          <p className="text-[10px] text-mercury/50 mt-1">
            Check back once today's probable pitchers are posted
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Header */}
      <div className="glass rounded-xl p-4 border border-amber/15">
        <div className="flex items-center gap-2 mb-1">
          <Zap className="w-5 h-5 text-amber" />
          <h2 className="text-sm font-bold text-silver uppercase tracking-wider">
            Dingers
          </h2>
          <InfoTip term="EV" className="ml-auto" />
        </div>
        <p className="text-xs text-mercury">
          Ranked by HR probability today — vs-hand splits, park + weather,
          recent form, and fatigue.{" "}
          <span className="text-mercury/50">
            {data?.gamesAnalyzed ?? 0} games analyzed
          </span>
        </p>
      </div>

      {/* Ranked list */}
      <div className="glass rounded-xl overflow-hidden">
        <div className="divide-y divide-slate/10">
          {candidates.map((c, i) => (
            <DingerRow
              key={`${c.playerId}-${c.gameTime}`}
              rank={i + 1}
              c={c}
              expanded={expanded === c.playerId}
              onToggle={() =>
                setExpanded(expanded === c.playerId ? null : c.playerId)
              }
            />
          ))}
        </div>
      </div>

      <p className="text-[9px] text-mercury/40 text-center">
        Composite score blends season + vs-hand HR rate, park/weather, recent
        form, and fatigue. Not a guarantee — informational only.
      </p>
    </div>
  );
}

function scoreColor(score: number): string {
  if (score >= 12) return "text-neon";
  if (score >= 7) return "text-electric";
  if (score >= 4) return "text-amber";
  return "text-mercury";
}

function DingerRow({
  rank,
  c,
  expanded,
  onToggle,
}: {
  rank: number;
  c: DingerCandidate;
  expanded: boolean;
  onToggle: () => void;
}) {
  const handLabel =
    c.pitcherHand === "L" ? "vs LHP" : c.pitcherHand === "R" ? "vs RHP" : "";

  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full px-3 sm:px-4 py-3 flex items-center gap-2.5 hover:bg-gunmetal/20 text-left transition-colors"
      >
        <span className="w-5 text-[10px] font-mono text-mercury/40 flex-shrink-0 text-center">
          {rank}
        </span>
        <PlayerAvatar
          name={c.playerName}
          playerId={c.playerId}
          sport="mlb"
          size={32}
        />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-silver font-semibold truncate flex items-center gap-1.5">
            <TeamLogo team={c.teamAbbrev} size={16} />
            <span className="truncate">{c.playerName}</span>
            {c.smallSampleVsHand && (
              <AlertTriangle
                className="w-3 h-3 text-amber flex-shrink-0"
                aria-label="Small sample"
              />
            )}
          </p>
          <p className="text-[10px] text-mercury/60 truncate">
            {handLabel && `${handLabel} `}
            {c.pitcherName} · {c.venueAbbrev || c.venue}
          </p>
        </div>
        {c.odds && (
          <div className="text-right flex-shrink-0 hidden sm:block">
            <p
              className={`text-[11px] font-mono font-bold ${c.odds.evPct > 0 ? "text-neon" : "text-mercury"}`}
            >
              {c.odds.americanOdds > 0 ? "+" : ""}
              {c.odds.americanOdds}
            </p>
            <p className="text-[8px] text-mercury/50">
              {c.odds.evPct >= 0 ? "+" : ""}
              {c.odds.evPct.toFixed(1)}% EV
            </p>
          </div>
        )}
        <div className="text-right flex-shrink-0">
          <p
            className={`text-sm font-mono font-bold ${scoreColor(c.compositeScore)}`}
          >
            {c.compositeScore.toFixed(1)}
          </p>
          <p className="text-[8px] text-mercury/50">HR score</p>
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-mercury/40 flex-shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {expanded && (
        <div className="px-3 sm:px-4 pb-4 space-y-3 animate-slide-up">
          {c.smallSampleVsHand && (
            <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-amber/10 border border-amber/25">
              <AlertTriangle className="w-3.5 h-3.5 text-amber flex-shrink-0" />
              <p className="text-[10px] text-amber font-semibold">
                Small sample — only {c.abVsHand} AB vs this pitcher's hand this
                season. Weighted lightly, not treated as reliable on its own.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <MiniStat
              label={`vs ${c.pitcherHand === "L" ? "LHP" : c.pitcherHand === "R" ? "RHP" : "hand"}`}
              value={`${c.hrRateVsHand.toFixed(1)}%`}
              sub={`${c.hrVsHand}/${c.abVsHand} AB`}
            />
            <MiniStat
              label="Season HR%"
              value={`${c.seasonHrRate.toFixed(1)}%`}
              sub={`${c.seasonHrRatePerGame.toFixed(2)}/gm`}
            />
            <MiniStat
              label="Last 10"
              value={`${c.last10HrRate.toFixed(1)}%`}
              sub="HR rate"
            />
            <MiniStat
              label="Park HR"
              value={`${c.parkHrFactor >= 1 ? "+" : ""}${Math.round((c.parkHrFactor - 1) * 100)}%`}
              sub={c.venueAbbrev}
            />
          </div>

          {c.odds && (
            <div className="rounded-lg bg-gunmetal/20 p-2.5 flex items-center justify-between">
              <span className="text-[10px] text-mercury">
                {c.odds.bookmaker} · {c.odds.americanOdds > 0 ? "+" : ""}
                {c.odds.americanOdds}
              </span>
              <span className="text-[10px] text-mercury">
                Model {c.odds.fairProb.toFixed(1)}% vs{" "}
                {c.odds.impliedProb.toFixed(1)}% implied
              </span>
              <span
                className={`text-[10px] font-bold ${c.odds.evPct > 0 ? "text-neon" : "text-danger"}`}
              >
                {c.odds.evPct >= 0 ? "+" : ""}
                {c.odds.evPct.toFixed(1)}% EV
              </span>
            </div>
          )}

          <div className="flex gap-2 p-2.5 rounded-lg bg-electric/5 border border-electric/15">
            <Brain className="w-3.5 h-3.5 text-electric flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              {c.reasoning.map((r, i) => (
                <p key={i} className="text-[11px] text-silver leading-relaxed">
                  {r}
                </p>
              ))}
            </div>
          </div>

          {c.fatigueScore > 40 && (
            <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-gunmetal/20">
              <TrendingUp className="w-3.5 h-3.5 text-mercury/50 flex-shrink-0" />
              <p className="text-[10px] text-mercury">{c.fatigueNote}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MiniStat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-lg bg-gunmetal/30 p-2 text-center">
      <p className="text-[9px] text-mercury uppercase tracking-wider">
        {label}
      </p>
      <p className="text-xs font-bold font-mono text-silver mt-0.5">{value}</p>
      <p className="text-[8px] text-mercury/50">{sub}</p>
    </div>
  );
}
