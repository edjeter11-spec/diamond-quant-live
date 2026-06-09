"use client";

import { useEffect, useState } from "react";
import { Snowflake, RefreshCw, ChevronDown, Zap, Brain } from "lucide-react";

interface NHLPick {
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
  player_points: "Points",
  player_goals: "Goals",
  player_assists: "Assists",
  player_shots_on_goal: "Shots",
  player_total_saves: "Saves",
};

export default function NHLPropSection({ sport }: { sport: "mlb" | "nba" | "nfl" | "nhl" }) {
  const [picks, setPicks] = useState<NHLPick[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (sport !== "nhl") { setPicks([]); setLoading(false); return; }
    setLoading(true);
    const today = new Date().toISOString().split("T")[0];
    fetch(`/api/prop-history?sport=nhl&limit=50`)
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

  if (sport !== "nhl") return null;

  if (loading) {
    return (
      <div className="glass rounded-xl p-4 flex items-center gap-2 border border-sky-300/20">
        <RefreshCw className="w-4 h-4 text-sky-300 animate-spin" />
        <span className="text-xs text-mercury">Loading NHL projections...</span>
      </div>
    );
  }

  if (picks.length === 0) {
    return (
      <div className="glass rounded-xl border border-sky-300/15">
        <div className="px-4 py-3 bg-gradient-to-r from-sky-300/10 to-transparent border-b border-sky-300/15 flex items-center gap-2">
          <Snowflake className="w-4 h-4 text-sky-300" />
          <h2 className="text-xs font-bold text-silver uppercase tracking-wider">NHL Player Props</h2>
        </div>
        <div className="px-4 py-6 text-center">
          <p className="text-xs text-mercury/60">No NHL games scheduled today</p>
          <p className="text-[10px] text-mercury/40 mt-1">Check back closer to puck drop</p>
        </div>
      </div>
    );
  }

  const visible = showAll ? picks : picks.slice(0, 5);

  return (
    <div className="glass rounded-xl overflow-hidden border border-sky-300/25">
      <div className="px-4 py-3 bg-gradient-to-r from-sky-300/10 to-transparent border-b border-sky-300/15 flex items-center gap-2">
        <Snowflake className="w-4 h-4 text-sky-300" />
        <div className="flex-1">
          <h2 className="text-xs font-bold text-silver uppercase tracking-wider">NHL Player Props</h2>
          <p className="text-[10px] text-mercury/60">{picks.length} edge picks · matchup, goalie SV%, fatigue, PP context</p>
        </div>
        {picks.length > 5 && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-[10px] text-sky-300 font-semibold px-2 py-1 rounded hover:bg-sky-300/10 transition-colors"
          >
            {showAll ? "Top 5" : `All ${picks.length}`}
          </button>
        )}
      </div>

      <div className="divide-y divide-slate/10">
        {visible.map((p, i) => {
          const isExp = expanded === `${p.playerName}-${p.market}-${i}`;
          const sideColor = p.predicted_side === "over" ? "text-neon" : "text-danger";
          const evColor = p.ev_edge > 10 ? "text-neon" : p.ev_edge > 5 ? "text-sky-300" : "text-amber";
          return (
            <div key={i}>
              <button
                onClick={() => setExpanded(isExp ? null : `${p.playerName}-${p.market}-${i}`)}
                className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-gunmetal/20 text-left transition-colors"
              >
                <span className={`w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center flex-shrink-0 ${
                  i === 0 ? "bg-gold/20 text-gold" : "bg-sky-300/15 text-sky-300"
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
                      <Brain className="w-3.5 h-3.5 text-sky-300" />
                      <p className="text-[10px] font-semibold text-silver uppercase tracking-wider">Projector Factors</p>
                    </div>
                    {p.factors.slice(0, 6).map((f, j) => (
                      <p key={j} className="text-[11px] text-mercury flex items-start gap-2">
                        <span className="text-sky-300 flex-shrink-0">›</span>
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
          <Zap className="w-2.5 h-2.5" />Goalie · B2B · Travel · PP context
        </span>
        <span className="text-[9px] text-mercury/50">Auto-graded via NHL API box scores</span>
      </div>
    </div>
  );
}
