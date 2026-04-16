"use client";

import { useState } from "react";
import { useSport } from "@/lib/sport-context";
import { Search, ArrowRight, TrendingUp, TrendingDown, Minus, X } from "lucide-react";
import PlayerAvatar from "@/components/ui/PlayerAvatar";

interface PlayerData {
  name: string;
  photo?: string;
  team?: string;
  position?: string;
  stats: { ppg: number; rpg: number; apg: number; fgPct?: number };
  propLine?: number;
  hitRate?: number;
  recommendation?: string;
}

export default function PlayerCompare() {
  const { currentSport } = useSport();
  const isNBA = currentSport === "nba";
  const [playerA, setPlayerA] = useState<PlayerData | null>(null);
  const [playerB, setPlayerB] = useState<PlayerData | null>(null);
  const [searchA, setSearchA] = useState("");
  const [searchB, setSearchB] = useState("");
  const [loadingA, setLoadingA] = useState(false);
  const [loadingB, setLoadingB] = useState(false);

  async function fetchPlayer(name: string, side: "A" | "B") {
    const setLoading = side === "A" ? setLoadingA : setLoadingB;
    const setPlayer = side === "A" ? setPlayerA : setPlayerB;
    setLoading(true);
    try {
      const endpoint = isNBA ? "/api/nba-player" : "/api/player-analysis";
      const res = await fetch(`${endpoint}?name=${encodeURIComponent(name)}&market=player_points&line=0`);
      if (res.ok) {
        const data = await res.json();
        const p = data.player ?? data;
        setPlayer({
          name: p.name ?? p.fullName ?? name,
          photo: p.photo,
          team: p.team ?? p.teamAbbrev,
          position: p.position,
          stats: {
            ppg: p.ppg ?? p.seasonStats?.avg ?? 0,
            rpg: p.rpg ?? 0,
            apg: p.apg ?? 0,
            fgPct: p.fgPct,
          },
          hitRate: data.hitRates?.player_points?.rate,
          recommendation: data.recommendation?.side,
        });
      }
    } catch {}
    setLoading(false);
  }

  if (!isNBA) return null; // NBA only for now

  return (
    <div className="glass rounded-xl overflow-hidden border border-electric/15">
      <div className="px-4 py-3 bg-gradient-to-r from-electric/10 to-purple/5 border-b border-electric/15">
        <h3 className="text-xs font-bold text-silver uppercase tracking-wider">Player Comparison</h3>
        <p className="text-[9px] text-mercury/50">Compare two players side by side</p>
      </div>

      <div className="p-4 space-y-3">
        {/* Search Row */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <div className="flex gap-1">
              <input
                type="text"
                placeholder="Player A..."
                value={searchA}
                onChange={e => setSearchA(e.target.value)}
                onKeyDown={e => e.key === "Enter" && fetchPlayer(searchA, "A")}
                className="flex-1 px-2 py-1.5 rounded-lg bg-gunmetal/50 border border-slate/20 text-xs text-silver placeholder:text-mercury/30 focus:border-electric/50 focus:outline-none"
              />
              <button onClick={() => fetchPlayer(searchA, "A")} disabled={loadingA || !searchA.trim()} className="p-1.5 rounded-lg bg-electric/10 text-electric hover:bg-electric/20 disabled:opacity-50">
                <Search className="w-3 h-3" />
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex gap-1">
              <input
                type="text"
                placeholder="Player B..."
                value={searchB}
                onChange={e => setSearchB(e.target.value)}
                onKeyDown={e => e.key === "Enter" && fetchPlayer(searchB, "B")}
                className="flex-1 px-2 py-1.5 rounded-lg bg-gunmetal/50 border border-slate/20 text-xs text-silver placeholder:text-mercury/30 focus:border-electric/50 focus:outline-none"
              />
              <button onClick={() => fetchPlayer(searchB, "B")} disabled={loadingB || !searchB.trim()} className="p-1.5 rounded-lg bg-purple/10 text-purple hover:bg-purple/20 disabled:opacity-50">
                <Search className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>

        {/* Comparison Table */}
        {(playerA || playerB) && (
          <div className="rounded-lg bg-gunmetal/20 overflow-hidden">
            {/* Player Headers */}
            <div className="grid grid-cols-[1fr_60px_1fr] border-b border-slate/15">
              <div className="p-2.5 flex items-center gap-2">
                {playerA ? (
                  <>
                    <PlayerAvatar name={playerA.name} photo={playerA.photo} size={28} />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-silver truncate">{playerA.name}</p>
                      <p className="text-[9px] text-mercury/50">{playerA.team} • {playerA.position}</p>
                    </div>
                  </>
                ) : <p className="text-xs text-mercury/30">Search player...</p>}
              </div>
              <div className="p-2.5 flex items-center justify-center border-x border-slate/10">
                <span className="text-[9px] text-mercury/40 font-bold">VS</span>
              </div>
              <div className="p-2.5 flex items-center gap-2 justify-end">
                {playerB ? (
                  <>
                    <div className="min-w-0 text-right">
                      <p className="text-xs font-semibold text-silver truncate">{playerB.name}</p>
                      <p className="text-[9px] text-mercury/50">{playerB.team} • {playerB.position}</p>
                    </div>
                    <PlayerAvatar name={playerB.name} photo={playerB.photo} size={28} />
                  </>
                ) : <p className="text-xs text-mercury/30">Search player...</p>}
              </div>
            </div>

            {/* Stat Rows */}
            {playerA && playerB && (
              <>
                <CompareRow label="PPG" a={playerA.stats.ppg} b={playerB.stats.ppg} />
                <CompareRow label="RPG" a={playerA.stats.rpg} b={playerB.stats.rpg} />
                <CompareRow label="APG" a={playerA.stats.apg} b={playerB.stats.apg} />
                {playerA.stats.fgPct !== undefined && playerB.stats.fgPct !== undefined && (
                  <CompareRow label="FG%" a={playerA.stats.fgPct * 100} b={playerB.stats.fgPct * 100} suffix="%" />
                )}
              </>
            )}
          </div>
        )}

        {!playerA && !playerB && (
          <p className="text-[10px] text-mercury/40 text-center py-2">Search two NBA players to compare their stats side by side</p>
        )}
      </div>
    </div>
  );
}

function CompareRow({ label, a, b, suffix = "" }: { label: string; a: number; b: number; suffix?: string }) {
  const aWins = a > b;
  const bWins = b > a;
  const diff = Math.abs(a - b);

  return (
    <div className="grid grid-cols-[1fr_60px_1fr] border-b border-slate/10 last:border-b-0">
      <div className="p-2 text-right">
        <span className={`text-sm font-mono font-bold ${aWins ? "text-neon" : "text-silver"}`}>
          {a.toFixed(1)}{suffix}
        </span>
      </div>
      <div className="p-2 flex items-center justify-center">
        <span className="text-[9px] text-mercury/50 font-semibold">{label}</span>
      </div>
      <div className="p-2">
        <span className={`text-sm font-mono font-bold ${bWins ? "text-neon" : "text-silver"}`}>
          {b.toFixed(1)}{suffix}
        </span>
      </div>
    </div>
  );
}
