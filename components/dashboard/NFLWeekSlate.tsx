"use client";

// NFL week slate — the visual centrepiece of the NFL tab.
//
// The NFL tab used to open on a text list of abbreviations and an empty
// "no props today" card, because football has one slate a week and the
// baseball-shaped layout has nothing to show on the six days in between.
// This turns the week itself into the content: every game as a matchup
// card with crests, kickoff, venue, and the consensus spread / total /
// moneylines from the odds feed already loaded into the store. Consensus is
// the MEDIAN across books — one stale line can't skew it, and it's a
// reference point rather than a pick (the sharp-anchor board handles picks).
//
// Clicking a card selects the game so the existing matchup detail opens.

import { useMemo, useState } from "react";
import { Clock, MapPin, ChevronDown } from "lucide-react";
import { useStore } from "@/lib/store";
import TeamLogo from "@/components/ui/TeamLogo";
import { getTeamNickname, teamNameToAbbrev } from "@/lib/logos";

type ScoreGame = {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeAbbrev: string;
  awayAbbrev: string;
  homeScore: number;
  awayScore: number;
  status: "pre" | "live" | "final" | string;
  startTime: string;
  venue?: string;
  period?: number;
  clock?: string;
};

type OddsGame = {
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  oddsLines: Array<{
    homeML?: number;
    awayML?: number;
    homeSpread?: number;
    total?: number;
  }>;
};

const median = (xs: number[]) => {
  const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const fmtOdds = (o: number | null) =>
  o == null ? "—" : o > 0 ? `+${o}` : `${o}`;
const fmtSpread = (s: number | null) =>
  s == null ? "—" : s > 0 ? `+${s}` : s === 0 ? "PK" : `${s}`;

function kickoffLabel(iso: string) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function countdown(iso: string) {
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function NFLWeekSlate() {
  const scores = useStore((s) => s.scores) as ScoreGame[];
  const oddsData = useStore((s) => s.oddsData) as OddsGame[];
  const selectGame = useStore((s) => s.selectGame);
  const selectedGameId = useStore((s) => s.selectedGameId);
  const [showAll, setShowAll] = useState(false);

  const games = useMemo(() => {
    const byKey = new Map<string, OddsGame>();
    for (const o of oddsData ?? []) {
      const h = teamNameToAbbrev(o.homeTeam, "nfl");
      const a = teamNameToAbbrev(o.awayTeam, "nfl");
      if (h && a) byKey.set(`${a}@${h}`, o);
    }
    return [...(scores ?? [])]
      .sort((p, q) => Date.parse(p.startTime) - Date.parse(q.startTime))
      .map((g) => {
        const o = byKey.get(`${g.awayAbbrev}@${g.homeAbbrev}`);
        const lines = o?.oddsLines ?? [];
        return {
          ...g,
          spread: median(lines.map((l) => Number(l.homeSpread))),
          total: median(lines.map((l) => Number(l.total))),
          homeML: median(lines.map((l) => Number(l.homeML))),
          awayML: median(lines.map((l) => Number(l.awayML))),
          books: lines.length,
        };
      });
  }, [scores, oddsData]);

  if (games.length === 0) return null;

  const next = games.find((g) => g.status === "pre");
  const live = games.filter((g) => g.status === "live").length;
  const cd = next ? countdown(next.startTime) : null;
  const visible = showAll ? games : games.slice(0, 6);

  return (
    <section className="glass rounded-2xl overflow-hidden">
      <div className="px-4 sm:px-5 py-3.5 flex items-center gap-3 border-b border-white/[0.06]">
        <div className="flex-1 min-w-0">
          <p className="eyebrow">NFL · This week</p>
          <h2 className="text-lg font-display font-bold text-silver leading-tight mt-0.5">
            {games.length} games
            {live > 0 && (
              <span className="ml-2 text-danger text-sm align-middle">
                ● {live} live
              </span>
            )}
          </h2>
        </div>
        {next && (
          <div className="text-right">
            <p className="eyebrow">Next kickoff</p>
            <p className="text-sm font-semibold text-electric mt-0.5 flex items-center justify-end gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              {cd ? `in ${cd}` : kickoffLabel(next.startTime)}
            </p>
          </div>
        )}
      </div>

      <div className="p-3 sm:p-4 grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
        {visible.map((g) => {
          const isLive = g.status === "live";
          const isFinal = g.status === "final";
          const selected = selectedGameId === g.id;
          return (
            <button
              key={g.id}
              onClick={() => selectGame(g.id)}
              className={`text-left rounded-xl border transition-all glass-hover ${
                selected
                  ? "border-neon/40 bg-neon/[0.04]"
                  : "border-white/[0.06] bg-white/[0.02]"
              }`}
            >
              <div className="px-3.5 pt-3 pb-2 space-y-2">
                {[
                  {
                    abbr: g.awayAbbrev,
                    name: g.awayTeam,
                    score: g.awayScore,
                    ml: g.awayML,
                    spread: g.spread == null ? null : -g.spread,
                  },
                  {
                    abbr: g.homeAbbrev,
                    name: g.homeTeam,
                    score: g.homeScore,
                    ml: g.homeML,
                    spread: g.spread,
                  },
                ].map((t, i) => (
                  <div key={t.abbr} className="flex items-center gap-3">
                    <TeamLogo team={t.abbr} size={36} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-silver leading-tight truncate">
                        {getTeamNickname(t.abbr, "nfl")}
                        <span className="ml-1.5 text-[10px] font-semibold text-mercury/60">
                          {t.abbr}
                          {i === 1 ? " · HOME" : ""}
                        </span>
                      </p>
                      <p className="text-[11px] text-mercury/80 font-mono">
                        {fmtSpread(t.spread)}{" "}
                        <span className="text-mercury/40">·</span> ML{" "}
                        {fmtOdds(t.ml)}
                      </p>
                    </div>
                    {(isLive || isFinal) && (
                      <span
                        className={`stat-num text-xl ${
                          isLive ? "text-danger" : "text-silver"
                        }`}
                      >
                        {t.score}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <div className="px-3.5 py-2 border-t border-white/[0.05] flex items-center gap-2 text-[11px] text-mercury/80">
                {isLive ? (
                  <span className="text-danger font-bold">
                    LIVE{g.period ? ` · Q${g.period} ${g.clock ?? ""}` : ""}
                  </span>
                ) : isFinal ? (
                  <span className="font-bold text-silver">FINAL</span>
                ) : (
                  <span className="flex items-center gap-1 font-semibold text-silver">
                    <Clock className="w-3 h-3 text-electric" />
                    {kickoffLabel(g.startTime)} ET
                  </span>
                )}
                <span className="text-mercury/40">·</span>
                <span>O/U {g.total ?? "—"}</span>
                {g.venue && (
                  <span className="ml-auto flex items-center gap-1 truncate max-w-[45%]">
                    <MapPin className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{g.venue}</span>
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {games.length > 6 && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="w-full py-2.5 border-t border-white/[0.06] text-xs font-semibold text-mercury hover:text-silver hover:bg-white/[0.03] transition-colors flex items-center justify-center gap-1.5"
        >
          {showAll ? "Show fewer" : `Show all ${games.length} games`}
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform ${showAll ? "rotate-180" : ""}`}
          />
        </button>
      )}
    </section>
  );
}
