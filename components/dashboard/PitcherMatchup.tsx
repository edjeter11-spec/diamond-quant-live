"use client";

import { useEffect, useState } from "react";
import { Target } from "lucide-react";

interface Props {
  homeAbbrev: string;
  awayAbbrev: string;
  homeTeam: string;
  awayTeam: string;
}

interface PitcherStats {
  name: string;
  throws: string;
  era: number;
  whip: number;
  kPerBF: number; // as a percentage
  battersFaced: number;
  vsLHB: { avg: number; ops: number; pa: number } | null;
  vsRHB: { avg: number; ops: number; pa: number } | null;
}

interface MatchupData {
  homePitcher: PitcherStats | null;
  awayPitcher: PitcherStats | null;
}

function PitcherCard({
  pitcher,
  teamAbbrev,
}: {
  pitcher: PitcherStats;
  teamAbbrev: string;
}) {
  return (
    <div className="bg-gunmetal/40 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-silver truncate">
          {pitcher.name}
        </p>
        <span className="text-[10px] text-mercury/50 font-mono flex-shrink-0">
          {teamAbbrev} · {pitcher.throws}HP
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-sm font-mono font-bold text-silver">
            {pitcher.era.toFixed(2)}
          </p>
          <p className="text-[9px] text-mercury/50 uppercase">ERA</p>
        </div>
        <div>
          <p className="text-sm font-mono font-bold text-silver">
            {pitcher.whip.toFixed(2)}
          </p>
          <p className="text-[9px] text-mercury/50 uppercase">WHIP</p>
        </div>
        <div>
          <p className="text-sm font-mono font-bold text-silver">
            {pitcher.kPerBF.toFixed(1)}%
          </p>
          <p className="text-[9px] text-mercury/50 uppercase">K Rate</p>
        </div>
      </div>
      {(pitcher.vsLHB || pitcher.vsRHB) && (
        <div className="pt-2 border-t border-slate/15 grid grid-cols-2 gap-2 text-[10px]">
          {pitcher.vsLHB && (
            <div className="text-mercury/70">
              <span className="text-mercury/50">vs LHB </span>
              <span className="font-mono text-mercury">
                {pitcher.vsLHB.avg.toFixed(3)} / {pitcher.vsLHB.ops.toFixed(3)}{" "}
                OPS
              </span>
            </div>
          )}
          {pitcher.vsRHB && (
            <div className="text-mercury/70">
              <span className="text-mercury/50">vs RHB </span>
              <span className="font-mono text-mercury">
                {pitcher.vsRHB.avg.toFixed(3)} / {pitcher.vsRHB.ops.toFixed(3)}{" "}
                OPS
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function PitcherMatchup({
  homeAbbrev,
  awayAbbrev,
  homeTeam,
  awayTeam,
}: Props) {
  const [data, setData] = useState<MatchupData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!homeAbbrev || !awayAbbrev) return;
    setLoading(true);
    fetch(`/api/pitcher-matchup?home=${homeAbbrev}&away=${awayAbbrev}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setData(d);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [homeAbbrev, awayAbbrev]);

  if (loading) return null;
  if (!data?.homePitcher && !data?.awayPitcher) return null;

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <Target className="w-3.5 h-3.5 text-amber" />
        <h3 className="text-xs font-semibold text-mercury uppercase tracking-wider">
          Starting Pitchers
        </h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {data.awayPitcher && (
          <PitcherCard pitcher={data.awayPitcher} teamAbbrev={awayAbbrev} />
        )}
        {data.homePitcher && (
          <PitcherCard pitcher={data.homePitcher} teamAbbrev={homeAbbrev} />
        )}
      </div>
    </section>
  );
}
