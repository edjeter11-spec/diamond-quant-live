"use client";

import { useState, useEffect } from "react";
import { useStore } from "@/lib/store";
import { Shield, Flame, Brain, ChevronDown, RefreshCw } from "lucide-react";
import { analyzeNRFI, type NRFIGame } from "@/lib/bot/nrfi-engine";

const GRADE_COLOR: Record<string, string> = {
  A: "bg-neon/15 text-neon border-neon/30",
  B: "bg-electric/15 text-electric border-electric/30",
  C: "bg-amber/15 text-amber border-amber/30",
  D: "bg-danger/10 text-danger border-danger/30",
  F: "bg-danger/15 text-danger border-danger/30",
};

const REC_BADGE: Record<string, { label: string; color: string }> = {
  NRFI: { label: "NRFI", color: "text-neon" },
  LEAN_NRFI: { label: "LEAN NRFI", color: "text-electric" },
  YRFI: { label: "YRFI", color: "text-danger" },
  LEAN_YRFI: { label: "LEAN YRFI", color: "text-amber" },
  SKIP: { label: "PASS", color: "text-mercury" },
};

// MLB-only slim NRFI section that sits under Player Props on the Board.
export default function NRFISection({ sport }: { sport: "mlb" | "nba" }) {
  const { scores } = useStore();
  const [games, setGames] = useState<NRFIGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (sport === "nba") { setGames([]); setLoading(false); return; }
    if (scores.length === 0) { setLoading(false); return; }
    setLoading(true);
    analyzeNRFI(scores).then((r) => {
      setGames(r);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [scores, sport]);

  // Hide entirely for NBA
  if (sport === "nba") return null;

  const upcoming = games.filter(g => g.status === "pre");
  const recommendations = upcoming.filter(g => g.recommendation !== "SKIP");
  const visible = showAll ? upcoming : recommendations.slice(0, 4);

  if (loading) {
    return (
      <div className="glass rounded-xl p-4 flex items-center gap-2 border border-electric/15">
        <RefreshCw className="w-4 h-4 text-electric animate-spin" />
        <span className="text-xs text-mercury">Analyzing first innings...</span>
      </div>
    );
  }

  if (upcoming.length === 0) return null;

  const totalNRFI = recommendations.filter(g => g.recommendation.includes("NRFI")).length;
  const totalYRFI = recommendations.filter(g => g.recommendation.includes("YRFI")).length;

  return (
    <div className="glass rounded-xl overflow-hidden border border-electric/20">
      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-electric/10 to-transparent border-b border-electric/15 flex items-center gap-2">
        <Shield className="w-4 h-4 text-electric" />
        <div className="flex-1">
          <h2 className="text-xs font-bold text-silver uppercase tracking-wider">First Inning (NRFI / YRFI)</h2>
          <p className="text-[10px] text-mercury/60">{totalNRFI} NRFI · {totalYRFI} YRFI · {upcoming.length - totalNRFI - totalYRFI} pass</p>
        </div>
        {recommendations.length > 4 && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-[10px] text-electric font-semibold px-2 py-1 rounded hover:bg-electric/10 transition-colors"
          >
            {showAll ? "Show top 4" : `Show all ${upcoming.length}`}
          </button>
        )}
      </div>

      {/* Picks list */}
      <div className="divide-y divide-slate/10">
        {visible.map((g) => {
          const isExpanded = expanded === g.gameId;
          const rec = REC_BADGE[g.recommendation] ?? REC_BADGE.SKIP;
          const grade = GRADE_COLOR[g.nrfiGrade] ?? GRADE_COLOR.C;
          const probColor = g.nrfiProb >= 65 ? "text-neon" : g.nrfiProb >= 55 ? "text-electric" : g.nrfiProb >= 45 ? "text-amber" : "text-danger";
          return (
            <div key={g.gameId}>
              <button
                onClick={() => setExpanded(isExpanded ? null : g.gameId)}
                className="w-full px-4 py-2.5 flex items-center gap-2.5 hover:bg-gunmetal/20 text-left transition-colors"
              >
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold border ${grade} flex-shrink-0`}>
                  {g.nrfiGrade}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-silver font-semibold truncate">
                    {g.awayAbbrev} @ {g.homeAbbrev}
                    <span className={`ml-2 text-[10px] font-bold ${rec.color}`}>{rec.label}</span>
                  </p>
                  <p className="text-[10px] text-mercury/60 truncate">
                    {g.awayPitcher.name} vs {g.homePitcher.name}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={`text-sm font-mono font-bold ${probColor}`}>{g.nrfiProb}%</p>
                  <p className="text-[9px] text-mercury/50">NRFI</p>
                </div>
                <ChevronDown className={`w-3.5 h-3.5 text-mercury/40 flex-shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
              </button>

              {isExpanded && (
                <div className="px-4 pb-3 space-y-3 animate-slide-up">
                  {/* Probability bar */}
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-neon font-bold w-16">NRFI {g.nrfiProb}%</span>
                    <div className="flex-1 h-2 bg-gunmetal rounded-full overflow-hidden flex">
                      <div className="h-full bg-neon" style={{ width: `${g.nrfiProb}%` }} />
                      <div className="h-full bg-danger" style={{ width: `${g.yrfiProb}%` }} />
                    </div>
                    <span className="text-[9px] text-danger font-bold w-16 text-right">{g.yrfiProb}% YRFI</span>
                  </div>

                  {/* Pitcher stats grid */}
                  <div className="grid grid-cols-2 gap-2">
                    <PitcherStats pitcher={g.awayPitcher} side="Away" abbrev={g.awayAbbrev} />
                    <PitcherStats pitcher={g.homePitcher} side="Home" abbrev={g.homeAbbrev} />
                  </div>

                  {/* Rationale */}
                  <div className="flex gap-2 p-2.5 rounded-lg bg-electric/5 border border-electric/15">
                    <Brain className="w-3.5 h-3.5 text-electric flex-shrink-0 mt-0.5" />
                    <p className="text-[11px] text-silver leading-relaxed">{g.rationale}</p>
                  </div>

                  {/* Factors */}
                  {g.factors.length > 0 && (
                    <div className="rounded-lg bg-gunmetal/20 p-2.5 space-y-0.5">
                      {g.factors.map((f, i) => (
                        <p key={i} className="text-[10px] text-mercury">
                          <span className="text-electric mr-1">›</span>{f}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 bg-gunmetal/10 border-t border-slate/15 flex items-center justify-between">
        <span className="text-[9px] text-mercury/50">Auto-graded after 1st inning · history tracked</span>
        <span className="text-[9px] text-mercury/50">Engine: ERA + WHIP + K/9 + park</span>
      </div>
    </div>
  );
}

function PitcherStats({ pitcher, side, abbrev }: { pitcher: any; side: string; abbrev: string }) {
  return (
    <div className="rounded-lg bg-gunmetal/30 p-2.5">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-electric/15 text-electric font-bold">{abbrev}</span>
        <p className="text-[11px] font-semibold text-silver truncate">{pitcher.name}</p>
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px]">
        <span className="text-mercury">ERA <span className="text-silver font-mono">{pitcher.era.toFixed(2)}</span></span>
        <span className="text-mercury">K/9 <span className="text-silver font-mono">{pitcher.k9}</span></span>
        <span className="text-mercury">WHIP <span className="text-silver font-mono">{pitcher.whip.toFixed(2)}</span></span>
        <span className="text-mercury">NRFI% <span className={`font-mono font-bold ${pitcher.nrfiRate > 70 ? "text-neon" : pitcher.nrfiRate > 55 ? "text-electric" : "text-danger"}`}>{pitcher.nrfiRate}</span></span>
      </div>
    </div>
  );
}
