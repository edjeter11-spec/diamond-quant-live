"use client";

import { useEffect, useState } from "react";
import { Radio, RefreshCw, Clock, TrendingUp } from "lucide-react";
import { useSport } from "@/lib/sport-context";
import TeamLogo from "@/components/ui/TeamLogo";

interface LiveGame {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  status: "live" | "pre" | "final";
  inning?: number;
  inningHalf?: "top" | "bottom" | string;
  period?: number;
  periodLabel?: string;
  timeRemaining?: string;
  outs?: number;
  bestHomeML?: number;
  bestAwayML?: number;
  bestHomeBook?: string;
  bestAwayBook?: string;
}

export default function LiveBoard() {
  const { currentSport } = useSport();
  const isNBA = currentSport === "nba";
  const [games, setGames] = useState<LiveGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string>("");

  const load = async () => {
    setLoading(true);
    try {
      const scoreUrl = isNBA ? "/api/nba-scores" : "/api/scores";
      const oddsUrl = `/api/odds?sport=${isNBA ? "basketball_nba" : "baseball_mlb"}`;
      const [scoresRes, oddsRes] = await Promise.all([
        fetch(`${scoreUrl}?_=${Date.now()}`),
        fetch(`${oddsUrl}&_=${Date.now()}`),
      ]);
      const scoreData = scoresRes.ok ? await scoresRes.json() : { games: [] };
      const oddsData = oddsRes.ok ? await oddsRes.json() : { games: [] };

      // Merge by team-pair (closest available match)
      const oddsMap = new Map<string, any>();
      for (const g of (oddsData.games ?? [])) {
        const key = `${g.awayTeam}::${g.homeTeam}`;
        oddsMap.set(key, g);
      }

      const live: LiveGame[] = (scoreData.games ?? [])
        .filter((g: any) => g.status === "live")
        .map((g: any) => {
          const odds = oddsMap.get(`${g.awayTeam}::${g.homeTeam}`);
          return {
            id: g.id,
            homeTeam: g.homeTeam,
            awayTeam: g.awayTeam,
            homeScore: g.homeScore ?? 0,
            awayScore: g.awayScore ?? 0,
            status: "live",
            inning: g.inning,
            inningHalf: g.inningHalf,
            period: g.period,
            periodLabel: g.periodLabel,
            timeRemaining: g.timeRemaining,
            outs: g.outs,
            bestHomeML: odds?.bestLines?.bestHomeML?.odds,
            bestAwayML: odds?.bestLines?.bestAwayML?.odds,
            bestHomeBook: odds?.bestLines?.bestHomeML?.bookmaker,
            bestAwayBook: odds?.bestLines?.bestAwayML?.bookmaker,
          };
        });
      setGames(live);
      setUpdatedAt(new Date().toISOString());
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 30 * 1000); // refresh every 30s for live
    return () => clearInterval(id);
  }, [isNBA]);

  const timeAgo = (iso: string) => {
    const ms = Date.now() - new Date(iso).getTime();
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s ago`;
    return `${Math.floor(s / 60)}m ago`;
  };

  return (
    <div className="space-y-3">
      <div className="glass rounded-xl overflow-hidden border border-danger/20">
        <div className="px-4 py-3 bg-gradient-to-r from-danger/15 to-amber/5 border-b border-danger/15 flex items-center gap-3">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute h-full w-full rounded-full bg-danger opacity-75" />
            <span className="relative rounded-full h-2.5 w-2.5 bg-danger" />
          </span>
          <div className="flex-1">
            <h2 className="text-sm font-bold text-silver">Live Games — {isNBA ? "NBA" : "MLB"}</h2>
            <p className="text-[10px] text-mercury/60">Odds + scores update every 30s</p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center justify-center min-w-[36px] min-h-[36px] rounded-lg hover:bg-gunmetal/40 text-mercury hover:text-silver transition-colors"
            aria-label="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {loading && games.length === 0 ? (
        <div className="glass rounded-xl p-6 flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 text-danger animate-spin" />
          <span className="text-sm text-mercury">Loading live games...</span>
        </div>
      ) : games.length === 0 ? (
        <div className="glass rounded-xl p-8 text-center">
          <Radio className="w-10 h-10 text-mercury/30 mx-auto mb-3" />
          <p className="text-sm text-silver font-semibold">No live games right now</p>
          <p className="text-[11px] text-mercury/60 mt-1.5 max-w-sm mx-auto">
            Live odds + scores appear here the second a game tips off. Tonight's slate refreshes automatically.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {games.map((g) => {
            const isMLB = !isNBA;
            const periodTxt = isMLB
              ? `${g.inningHalf === "top" ? "▲" : "▼"}${g.inning ?? 1}${g.outs !== undefined ? ` · ${g.outs} out${g.outs !== 1 ? "s" : ""}` : ""}`
              : `${g.periodLabel || `Q${g.period ?? 1}`}${g.timeRemaining ? ` · ${g.timeRemaining}` : ""}`;
            const homeLead = g.homeScore > g.awayScore;
            return (
              <div key={g.id} className="glass rounded-xl border border-slate/20 overflow-hidden hover:border-danger/30 transition-all">
                <div className="px-3 py-2 bg-gradient-to-r from-danger/5 to-transparent flex items-center gap-2 border-b border-slate/15">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-danger flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
                    LIVE
                  </span>
                  <span className="text-[10px] text-mercury/70 font-mono">{periodTxt}</span>
                </div>
                <div className="p-3 space-y-2">
                  {/* Away team */}
                  <div className="flex items-center gap-2">
                    <TeamLogo team={g.awayTeam} size={20} />
                    <span className={`flex-1 text-sm font-semibold ${!homeLead ? "text-silver" : "text-mercury/70"}`}>{g.awayTeam}</span>
                    <span className={`text-lg font-mono font-bold tabular-nums ${!homeLead ? "text-silver" : "text-mercury"}`}>{g.awayScore}</span>
                    {g.bestAwayML !== undefined && g.bestAwayML !== 0 && (
                      <span className="text-[10px] font-mono text-electric border border-electric/25 bg-electric/10 px-1.5 py-0.5 rounded">
                        {g.bestAwayML > 0 ? "+" : ""}{g.bestAwayML}
                      </span>
                    )}
                  </div>
                  {/* Home team */}
                  <div className="flex items-center gap-2">
                    <TeamLogo team={g.homeTeam} size={20} />
                    <span className={`flex-1 text-sm font-semibold ${homeLead ? "text-silver" : "text-mercury/70"}`}>{g.homeTeam}</span>
                    <span className={`text-lg font-mono font-bold tabular-nums ${homeLead ? "text-silver" : "text-mercury"}`}>{g.homeScore}</span>
                    {g.bestHomeML !== undefined && g.bestHomeML !== 0 && (
                      <span className="text-[10px] font-mono text-electric border border-electric/25 bg-electric/10 px-1.5 py-0.5 rounded">
                        {g.bestHomeML > 0 ? "+" : ""}{g.bestHomeML}
                      </span>
                    )}
                  </div>
                  {(g.bestHomeBook || g.bestAwayBook) && (
                    <p className="text-[9px] text-mercury/40 pt-1 border-t border-slate/15">
                      Best live ML: {g.bestHomeBook ?? "—"} (home) · {g.bestAwayBook ?? "—"} (away)
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {updatedAt && (
        <p className="text-center text-[9px] text-mercury/40 flex items-center justify-center gap-1">
          <Clock className="w-2.5 h-2.5" />
          Updated {timeAgo(updatedAt)}
        </p>
      )}
    </div>
  );
}
