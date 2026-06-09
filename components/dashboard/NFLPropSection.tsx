"use client";

import { useEffect, useState } from "react";
import { Trophy, RefreshCw, ChevronDown, Wind, ThermometerSun, Brain } from "lucide-react";

interface NFLPick {
  playerName: string;
  team: string;
  propType: string;
  market: string;
  line: number;
  predicted_side: "over" | "under";
  predicted_prob: number;
  ev_edge: number;
  factors: Array<{ name: string; value: number; explanation?: string }>;
  game_date: string;
}

const MARKET_LABEL: Record<string, string> = {
  player_pass_yds: "Pass Yds",
  player_pass_tds: "Pass TDs",
  player_pass_attempts: "Pass Att",
  player_rush_yds: "Rush Yds",
  player_rush_attempts: "Carries",
  player_receptions: "Receptions",
  player_reception_yds: "Rec Yds",
  player_anytime_td: "Anytime TD",
};

export default function NFLPropSection({ sport }: { sport: "mlb" | "nba" | "nfl" }) {
  const [picks, setPicks] = useState<NFLPick[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (sport !== "nfl") { setPicks([]); setLoading(false); return; }
    setLoading(true);
    // Fetch today's pending NFL prop predictions
    const today = new Date().toISOString().split("T")[0];
    fetch(`/api/prop-history?sport=nfl&limit=50`)
      .then(r => r.json())
      .then(d => {
        const todays = (d.picks ?? []).filter((p: any) =>
          (p.date ?? p.game_date) === today && (p.result === "pending" || !p.result)
        );
        setPicks(todays);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [sport]);

  if (sport !== "nfl") return null;

  if (loading) {
    return (
      <div className="glass rounded-xl p-4 flex items-center gap-2 border border-electric/15">
        <RefreshCw className="w-4 h-4 text-electric animate-spin" />
        <span className="text-xs text-mercury">Loading NFL projections...</span>
      </div>
    );
  }

  if (picks.length === 0) {
    return (
      <div className="glass rounded-xl border border-electric/15">
        <div className="px-4 py-3 bg-gradient-to-r from-electric/10 to-transparent border-b border-electric/15 flex items-center gap-2">
          <Trophy className="w-4 h-4 text-electric" />
          <h2 className="text-xs font-bold text-silver uppercase tracking-wider">NFL Player Props</h2>
        </div>
        <div className="px-4 py-6 text-center">
          <p className="text-xs text-mercury/60">No NFL games scheduled today</p>
          <p className="text-[10px] text-mercury/40 mt-1">Picks generate Thursday, Sunday, Monday</p>
        </div>
      </div>
    );
  }

  const visible = showAll ? picks : picks.slice(0, 5);

  return (
    <div className="glass rounded-xl overflow-hidden border border-electric/20">
      <div className="px-4 py-3 bg-gradient-to-r from-electric/10 to-transparent border-b border-electric/15 flex items-center gap-2">
        <Trophy className="w-4 h-4 text-electric" />
        <div className="flex-1">
          <h2 className="text-xs font-bold text-silver uppercase tracking-wider">NFL Player Props</h2>
          <p className="text-[10px] text-mercury/60">{picks.length} edge picks · projector accounts for weather, rest, injuries, matchup defense</p>
        </div>
        {picks.length > 5 && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-[10px] text-electric font-semibold px-2 py-1 rounded hover:bg-electric/10 transition-colors"
          >
            {showAll ? "Top 5" : `All ${picks.length}`}
          </button>
        )}
      </div>

      <div className="divide-y divide-slate/10">
        {visible.map((p, i) => {
          const isExp = expanded === `${p.playerName}-${p.market}-${i}`;
          const sideColor = p.predicted_side === "over" ? "text-neon" : "text-danger";
          const evColor = p.ev_edge > 10 ? "text-neon" : p.ev_edge > 5 ? "text-electric" : "text-amber";
          return (
            <div key={i}>
              <button
                onClick={() => setExpanded(isExp ? null : `${p.playerName}-${p.market}-${i}`)}
                className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-gunmetal/20 text-left transition-colors"
              >
                <span className={`w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center flex-shrink-0 ${
                  i === 0 ? "bg-gold/20 text-gold" : "bg-electric/15 text-electric"
                }`}>{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-silver truncate">
                    {p.playerName} <span className="text-[10px] text-mercury/50 ml-1">{p.team}</span>
                  </p>
                  <p className="text-[10px] text-mercury/70 truncate">
                    <span className={`font-bold ${sideColor}`}>{p.predicted_side.toUpperCase()}</span> {p.line} {MARKET_LABEL[p.market] ?? p.market}
                    <span className="text-mercury/40 ml-1">· {(p.predicted_prob * 100).toFixed(0)}% prob</span>
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={`text-sm font-mono font-bold ${evColor}`}>+{p.ev_edge.toFixed(1)}%</p>
                  <p className="text-[9px] text-mercury/50">EV</p>
                </div>
                <ChevronDown className={`w-3.5 h-3.5 text-mercury/40 transition-transform ${isExp ? "rotate-180" : ""}`} />
              </button>

              {isExp && p.factors?.length > 0 && (
                <div className="px-4 pb-3 animate-slide-up">
                  <div className="rounded-lg bg-gunmetal/20 p-3 space-y-1.5">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Brain className="w-3.5 h-3.5 text-electric" />
                      <p className="text-[10px] font-semibold text-silver uppercase tracking-wider">Projector Factors</p>
                    </div>
                    {p.factors.slice(0, 6).map((f, j) => (
                      <p key={j} className="text-[11px] text-mercury flex items-start gap-2">
                        <span className="text-electric flex-shrink-0">›</span>
                        <span className="flex-1">
                          <span className="text-silver font-semibold">{f.name}:</span>{" "}
                          {f.explanation ?? ""}
                          <span className={`ml-1 font-mono ${f.value > 0 ? "text-neon" : f.value < 0 ? "text-danger" : "text-mercury/60"}`}>
                            ({f.value > 0 ? "+" : ""}{f.value})
                          </span>
                        </span>
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="px-4 py-2 bg-gunmetal/10 border-t border-slate/15 flex items-center justify-between">
        <span className="text-[9px] text-mercury/50 flex items-center gap-1">
          <Wind className="w-2.5 h-2.5" />Weather · <ThermometerSun className="w-2.5 h-2.5" />Rest · Matchup · Injuries
        </span>
        <span className="text-[9px] text-mercury/50">Auto-graded vs ESPN box scores</span>
      </div>
    </div>
  );
}
