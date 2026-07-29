"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Search,
  TrendingUp,
  TrendingDown,
  Minus,
  Calendar,
  X,
} from "lucide-react";
import PlayerAvatar from "@/components/ui/PlayerAvatar";
import TeamLogo from "@/components/ui/TeamLogo";

interface SearchResult {
  id: number;
  fullName: string;
  team: string;
  position: string;
}

interface StatProjection {
  market: string;
  label: string;
  seasonAvg: number;
  last10Avg: number;
  last5Avg: number;
  trend: "up" | "down" | "flat";
  projection: number;
}

interface PlayerProfile {
  player: {
    name: string;
    team: string;
    teamAbbrev: string;
    position: string;
    gamesPlayed: number;
    photo?: string;
    era?: number;
    whip?: number;
    strikeouts?: number;
    k9?: number;
    wins?: number;
    losses?: number;
    avg?: number;
    ops?: number;
    hits?: number;
    homeRuns?: number;
    rbi?: number;
    stolenBases?: number;
    totalBases?: number;
  };
  isPitcher: boolean;
  dataSource: "current" | "lastYear" | "career";
  last10Games: Array<{
    date: string;
    opponent: string;
    strikeouts?: number;
    inningsPitched?: number;
    hitsB?: number;
    homeRuns?: number;
    rbi?: number;
    totalBases?: number;
  }>;
  projections: StatProjection[];
  nextGame: { opponent: string; date: string; venue?: string } | null;
}

function StatBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-center p-2 rounded-lg bg-gunmetal/40">
      <p className="text-sm font-bold font-mono text-silver">{value}</p>
      <p className="text-[8px] text-mercury uppercase tracking-wider mt-0.5">
        {label}
      </p>
    </div>
  );
}

function TrendIcon({ trend }: { trend: "up" | "down" | "flat" }) {
  if (trend === "up") return <TrendingUp className="w-3.5 h-3.5 text-neon" />;
  if (trend === "down")
    return <TrendingDown className="w-3.5 h-3.5 text-danger" />;
  return <Minus className="w-3.5 h-3.5 text-mercury/50" />;
}

export default function PlayersTab() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced typeahead search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(() => {
      fetch(`/api/mlb-player-search?q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then((d) => setResults(d.results ?? []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const loadProfile = useCallback((player: SearchResult) => {
    setSelected(player);
    setResults([]);
    setQuery("");
    setLoading(true);
    setNotFound(false);
    setProfile(null);
    fetch(
      `/api/mlb-player-profile?id=${player.id}&name=${encodeURIComponent(player.fullName)}`,
    )
      .then((r) => {
        if (r.status === 404) {
          setNotFound(true);
          return null;
        }
        return r.json();
      })
      .then((d) => {
        if (d) setProfile(d);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, []);

  const clearSelection = () => {
    setSelected(null);
    setProfile(null);
    setNotFound(false);
  };

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Search box */}
      <div className="glass rounded-xl p-3 sm:p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mercury/50" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search any MLB player..."
            className="w-full pl-9 pr-9 py-2.5 rounded-lg bg-gunmetal/50 border border-slate/30 text-sm text-silver placeholder:text-mercury/40 focus:outline-none focus:border-electric/40"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-gunmetal/60"
            >
              <X className="w-3.5 h-3.5 text-mercury/50" />
            </button>
          )}
        </div>

        {/* Typeahead dropdown */}
        {query.trim().length >= 2 && (
          <div className="mt-2 rounded-lg border border-slate/20 bg-bunker/95 overflow-hidden max-h-72 overflow-y-auto">
            {searching && (
              <p className="px-3 py-2.5 text-xs text-mercury/60">
                Searching...
              </p>
            )}
            {!searching && results.length === 0 && (
              <p className="px-3 py-2.5 text-xs text-mercury/60">
                No players found
              </p>
            )}
            {!searching &&
              results.map((r) => (
                <button
                  key={r.id}
                  onClick={() => loadProfile(r)}
                  className="w-full px-3 py-2 flex items-center gap-2.5 hover:bg-gunmetal/40 text-left border-b border-slate/10 last:border-0"
                >
                  <PlayerAvatar
                    name={r.fullName}
                    playerId={r.id}
                    sport="mlb"
                    size={26}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-silver truncate">
                      {r.fullName}
                    </p>
                    <p className="text-[10px] text-mercury/60 truncate">
                      {r.team} · {r.position}
                    </p>
                  </div>
                </button>
              ))}
          </div>
        )}
      </div>

      {/* Empty state */}
      {!selected && (
        <div className="glass rounded-xl p-8 text-center">
          <Search className="w-8 h-8 text-mercury/30 mx-auto mb-2" />
          <p className="text-sm text-mercury">
            Search for any active MLB player
          </p>
          <p className="text-[11px] text-mercury/50 mt-1">
            See season stats, recent form, and a next-game projection
          </p>
        </div>
      )}

      {/* Loading */}
      {selected && loading && (
        <div className="glass rounded-xl p-6 text-center">
          <div className="w-5 h-5 border-2 border-electric/30 border-t-electric rounded-full animate-spin mx-auto mb-2" />
          <p className="text-xs text-mercury">Loading {selected.fullName}...</p>
        </div>
      )}

      {/* Not found */}
      {selected && !loading && notFound && (
        <div className="glass rounded-xl p-6 text-center">
          <p className="text-sm text-mercury">
            No stats available for {selected.fullName}
          </p>
          <button
            onClick={clearSelection}
            className="mt-3 text-xs text-electric underline"
          >
            Search again
          </button>
        </div>
      )}

      {/* Profile */}
      {profile && !loading && (
        <div className="space-y-3">
          {/* Header card */}
          <div className="glass rounded-xl p-4">
            <div className="flex items-center gap-3">
              <PlayerAvatar
                name={profile.player.name}
                photo={profile.player.photo}
                playerId={selected?.id}
                sport="mlb"
                size={56}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-silver truncate">
                    {profile.player.name}
                  </h2>
                  <TeamLogo team={profile.player.team} size={18} />
                </div>
                <p className="text-xs text-mercury/70">
                  {profile.player.teamAbbrev} · {profile.player.position} ·{" "}
                  {profile.player.gamesPlayed} G
                  {profile.dataSource !== "current" && (
                    <span className="text-amber ml-1">
                      (
                      {profile.dataSource === "lastYear"
                        ? "last season"
                        : "career"}{" "}
                      stats)
                    </span>
                  )}
                </p>
              </div>
              <button
                onClick={clearSelection}
                className="p-1.5 rounded hover:bg-gunmetal/50"
              >
                <X className="w-4 h-4 text-mercury/50" />
              </button>
            </div>

            {/* Season stat line */}
            <div className="grid grid-cols-4 gap-1.5 mt-3">
              {profile.isPitcher ? (
                <>
                  <StatBox
                    label="ERA"
                    value={profile.player.era?.toFixed(2) ?? "—"}
                  />
                  <StatBox
                    label="WHIP"
                    value={profile.player.whip?.toFixed(2) ?? "—"}
                  />
                  <StatBox
                    label="K/9"
                    value={profile.player.k9?.toFixed(1) ?? "—"}
                  />
                  <StatBox
                    label="W-L"
                    value={`${profile.player.wins ?? 0}-${profile.player.losses ?? 0}`}
                  />
                </>
              ) : (
                <>
                  <StatBox
                    label="AVG"
                    value={profile.player.avg?.toFixed(3) ?? "—"}
                  />
                  <StatBox
                    label="OPS"
                    value={profile.player.ops?.toFixed(3) ?? "—"}
                  />
                  <StatBox label="HR" value={profile.player.homeRuns ?? 0} />
                  <StatBox label="RBI" value={profile.player.rbi ?? 0} />
                </>
              )}
            </div>

            {/* Next game */}
            {profile.nextGame && (
              <div className="flex items-center gap-2 mt-3 px-3 py-2 rounded-lg bg-electric/5 border border-electric/15">
                <Calendar className="w-3.5 h-3.5 text-electric flex-shrink-0" />
                <p className="text-[11px] text-silver">
                  Next: vs {profile.nextGame.opponent}
                  {profile.nextGame.venue && (
                    <span className="text-mercury/60">
                      {" "}
                      · {profile.nextGame.venue}
                    </span>
                  )}
                </p>
              </div>
            )}
          </div>

          {/* Projections */}
          <div className="glass rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate/15">
              <h3 className="text-xs font-bold text-silver uppercase tracking-wider">
                Next Game Projection
              </h3>
              <p className="text-[9px] text-mercury/50 mt-0.5">
                Blend of last-5, last-10, and season rate
              </p>
            </div>
            <div className="divide-y divide-slate/10">
              {profile.projections.map((p) => (
                <div
                  key={p.market}
                  className="px-4 py-3 flex items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-silver">{p.label}</p>
                    <p className="text-[10px] text-mercury/60 mt-0.5">
                      Season {p.seasonAvg} · L10 {p.last10Avg} · L5 {p.last5Avg}
                    </p>
                  </div>
                  <TrendIcon trend={p.trend} />
                  <div className="text-right">
                    <p className="text-lg font-bold font-mono text-electric">
                      {p.projection}
                    </p>
                    <p className="text-[8px] text-mercury/50 uppercase">Proj</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Last 10 games */}
          {profile.last10Games.length > 0 && (
            <div className="glass rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate/15">
                <h3 className="text-xs font-bold text-silver uppercase tracking-wider">
                  Last {profile.last10Games.length} Games
                </h3>
              </div>
              <div className="divide-y divide-slate/10 max-h-80 overflow-y-auto">
                {[...profile.last10Games].reverse().map((g, i) => (
                  <div
                    key={i}
                    className="px-4 py-2 flex items-center justify-between text-[11px]"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-mercury/50 font-mono flex-shrink-0">
                        {g.date}
                      </span>
                      <span className="text-mercury truncate">
                        vs {g.opponent}
                      </span>
                    </div>
                    <span className="text-silver font-mono flex-shrink-0">
                      {profile.isPitcher
                        ? `${g.strikeouts ?? 0} K, ${(g.inningsPitched ?? 0).toFixed(1)} IP`
                        : `${g.hitsB ?? 0} H, ${g.totalBases ?? 0} TB${g.homeRuns ? `, ${g.homeRuns} HR` : ""}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
