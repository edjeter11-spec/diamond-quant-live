"use client";

import { useEffect, useState } from "react";
import { Activity, Moon, Zap, AlertCircle } from "lucide-react";

interface Props {
  homeAbbrev: string;
  awayAbbrev: string;
}

interface MatchupData {
  rest: {
    home: { summary: string; isB2B: boolean; is3In4: boolean; daysRest: number };
    away: { summary: string; isB2B: boolean; is3In4: boolean; daysRest: number };
    edge: number;
  };
  injuries: {
    home: Array<{ name: string; status: string }>;
    away: Array<{ name: string; status: string }>;
  };
  ratings: {
    home: { pace: number; offRating: number; defRating: number; netRating: number };
    away: { pace: number; offRating: number; defRating: number; netRating: number };
    netGap: number;
  };
  total: { projectedTotal: number; expectedPace: number; factors: string[] };
  takeaways: string[];
}

export default function GameMatchupBrief({ homeAbbrev, awayAbbrev }: Props) {
  const [data, setData] = useState<MatchupData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!homeAbbrev || !awayAbbrev) return;
    setLoading(true);
    fetch(`/api/game-matchup?home=${homeAbbrev}&away=${awayAbbrev}`)
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [homeAbbrev, awayAbbrev]);

  if (loading || !data) return null;

  const impactful = (list: Array<{ name: string; status: string }>) =>
    list.filter((p) => p.status === "Out" || p.status === "Doubtful" || p.status === "Questionable");

  const homeOuts = impactful(data.injuries.home);
  const awayOuts = impactful(data.injuries.away);

  return (
    <div className="bg-gradient-to-br from-purple-950/40 to-slate-900/60 border border-purple-500/30 rounded-xl p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Activity className="w-4 h-4 text-purple-400" />
        <h3 className="text-sm font-semibold text-purple-300 uppercase tracking-wider">Matchup Brief</h3>
      </div>

      {data.takeaways.length > 0 && (
        <div className="space-y-1.5">
          {data.takeaways.map((t, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-slate-200">
              <Zap className="w-3 h-3 text-amber-400 mt-0.5 flex-shrink-0" />
              <span>{t}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-slate-900/60 rounded-lg p-3 space-y-2">
          <div className="text-xs font-semibold text-slate-400">{awayAbbrev} (Away)</div>
          <div className="flex items-center gap-1.5 text-xs text-slate-300">
            <Moon className="w-3 h-3" />
            <span className={data.rest.away.isB2B || data.rest.away.is3In4 ? "text-red-400" : ""}>
              {data.rest.away.summary.replace(`${awayAbbrev} `, "")}
            </span>
          </div>
          <div className="text-[11px] text-slate-400">
            Net {data.ratings.away.netRating >= 0 ? "+" : ""}{data.ratings.away.netRating.toFixed(1)} · Pace {data.ratings.away.pace.toFixed(1)}
          </div>
          {awayOuts.length > 0 && (
            <div className="flex items-start gap-1 text-[11px] text-red-300">
              <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span>{awayOuts.slice(0, 3).map((p) => `${p.name.split(" ").pop()} (${p.status[0]})`).join(", ")}</span>
            </div>
          )}
        </div>

        <div className="bg-slate-900/60 rounded-lg p-3 space-y-2">
          <div className="text-xs font-semibold text-slate-400">{homeAbbrev} (Home)</div>
          <div className="flex items-center gap-1.5 text-xs text-slate-300">
            <Moon className="w-3 h-3" />
            <span className={data.rest.home.isB2B || data.rest.home.is3In4 ? "text-red-400" : ""}>
              {data.rest.home.summary.replace(`${homeAbbrev} `, "")}
            </span>
          </div>
          <div className="text-[11px] text-slate-400">
            Net {data.ratings.home.netRating >= 0 ? "+" : ""}{data.ratings.home.netRating.toFixed(1)} · Pace {data.ratings.home.pace.toFixed(1)}
          </div>
          {homeOuts.length > 0 && (
            <div className="flex items-start gap-1 text-[11px] text-red-300">
              <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span>{homeOuts.slice(0, 3).map((p) => `${p.name.split(" ").pop()} (${p.status[0]})`).join(", ")}</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs">
        <span className="text-slate-400">Projected Total</span>
        <span className="font-mono font-semibold text-purple-300">{data.total.projectedTotal.toFixed(1)}</span>
      </div>
    </div>
  );
}
