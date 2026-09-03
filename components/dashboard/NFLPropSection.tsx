"use client";

import { useEffect, useState } from "react";
import { etDateString } from "@/lib/sports-date";
import { Trophy, RefreshCw, ChevronDown, Brain, Clock } from "lucide-react";
import PlayerAvatar from "@/components/ui/PlayerAvatar";
import TeamLogo from "@/components/ui/TeamLogo";
import { useStore } from "@/lib/store";

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

export default function NFLPropSection({
  sport,
}: {
  sport: "mlb" | "nba" | "nfl" | "nhl";
}) {
  const [picks, setPicks] = useState<NFLPick[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const scores = useStore((s) => s.scores) as any[];

  useEffect(() => {
    if (sport !== "nfl") {
      setPicks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    // etDateString(), NOT toISOString(): prop rows carry the ET sports date,
    // and the UTC date made picks vanish 8pm–4am ET — the prime-time window.
    const today = etDateString();
    fetch(`/api/prop-history?sport=nfl&limit=50`)
      .then((r) => r.json())
      .then((d) => {
        const todays = (d.picks ?? []).filter(
          (p: any) =>
            (p.date ?? p.game_date) === today &&
            (p.result === "pending" || !p.result),
        );
        setPicks(todays);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [sport]);

  if (sport !== "nfl") return null;

  if (loading) {
    return (
      <div className="glass rounded-2xl p-4 flex items-center gap-2">
        <RefreshCw className="w-4 h-4 text-electric animate-spin" />
        <span className="text-xs text-mercury">Loading NFL projections…</span>
      </div>
    );
  }

  if (picks.length === 0) {
    // Next slate from the week's schedule, so the empty state says WHEN
    // instead of a flat "nothing today".
    const next = [...(scores ?? [])]
      .filter((g) => g.status === "pre")
      .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))[0];
    const when = next
      ? new Date(next.startTime).toLocaleString("en-US", {
          timeZone: "America/New_York",
          weekday: "long",
          hour: "numeric",
          minute: "2-digit",
        })
      : null;
    return (
      <div className="glass rounded-2xl overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 border-b border-white/[0.06] flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-electric/10 flex items-center justify-center">
            <Trophy className="w-4 h-4 text-electric" />
          </div>
          <div>
            <p className="eyebrow">NFL</p>
            <h2 className="text-base font-display font-bold text-silver leading-tight">
              Player props
            </h2>
          </div>
        </div>
        <div className="px-5 py-5 flex items-start gap-3">
          <Clock className="w-4 h-4 text-electric mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm text-silver font-semibold">
              {when ? `Props post ${when} ET` : "Props post on game day"}
            </p>
            <p className="text-xs text-mercury mt-1 leading-relaxed">
              Projections publish about three hours before the first kickoff of
              each slate, once inactives are in. Sharp-priced spreads, totals
              and moneylines land on the board the same way.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const visible = showAll ? picks : picks.slice(0, 5);

  return (
    <div className="glass rounded-2xl overflow-hidden">
      <div className="px-4 sm:px-5 py-3.5 border-b border-white/[0.06] flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-electric/10 flex items-center justify-center flex-shrink-0">
          <Trophy className="w-4 h-4 text-electric" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="eyebrow">NFL</p>
          <h2 className="text-base font-display font-bold text-silver leading-tight">
            Player props
            <span className="ml-2 text-xs font-sans font-semibold text-mercury/70">
              {picks.length} edge{picks.length === 1 ? "" : "s"}
            </span>
          </h2>
        </div>
        {picks.length > 5 && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="btn-ghost !min-h-[32px] !text-[11px]"
          >
            {showAll ? "Top 5" : `All ${picks.length}`}
          </button>
        )}
      </div>

      <div className="divide-y divide-white/[0.05]">
        {visible.map((p, i) => {
          const key = `${p.playerName}-${p.market}-${i}`;
          const isExp = expanded === key;
          const over = p.predicted_side === "over";
          const evColor =
            p.ev_edge > 10
              ? "text-neon"
              : p.ev_edge > 5
                ? "text-electric"
                : "text-amber";
          return (
            <div key={key}>
              <button
                onClick={() => setExpanded(isExp ? null : key)}
                className="w-full px-4 sm:px-5 py-3 flex items-center gap-3 hover:bg-white/[0.03] text-left transition-colors"
              >
                <div className="relative flex-shrink-0">
                  <PlayerAvatar name={p.playerName} sport="nfl" size={44} />
                  <div className="absolute -bottom-1 -right-1 rounded-full bg-bunker p-0.5 ring-1 ring-white/[0.08]">
                    <TeamLogo team={p.team} size={16} />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-silver truncate">
                    {p.playerName}
                    <span className="ml-1.5 text-[10px] font-semibold text-mercury/60">
                      {p.team}
                    </span>
                  </p>
                  <p className="text-xs mt-0.5 truncate">
                    <span
                      className={`font-bold ${over ? "text-neon" : "text-amber"}`}
                    >
                      {over ? "OVER" : "UNDER"} {p.line}
                    </span>{" "}
                    <span className="text-silver/90">
                      {MARKET_LABEL[p.market] ?? p.market}
                    </span>
                    <span className="text-mercury/60 ml-1.5">
                      · {(p.predicted_prob * 100).toFixed(0)}% to hit
                    </span>
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={`stat-num text-lg ${evColor}`}>
                    +{p.ev_edge.toFixed(1)}%
                  </p>
                  <p className="eyebrow !text-[9px]">edge</p>
                </div>
                <ChevronDown
                  className={`w-4 h-4 text-mercury/50 transition-transform ${isExp ? "rotate-180" : ""}`}
                />
              </button>

              {isExp && p.factors?.length > 0 && (
                <div className="px-4 sm:px-5 pb-3 animate-slide-up">
                  <div className="rounded-xl bg-white/[0.03] border border-white/[0.05] p-3 space-y-1.5">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Brain className="w-3.5 h-3.5 text-electric" />
                      <p className="eyebrow">Why</p>
                    </div>
                    {p.factors.slice(0, 6).map((f, j) => (
                      <p
                        key={j}
                        className="text-xs text-mercury flex items-start gap-2"
                      >
                        <span className="text-electric flex-shrink-0">›</span>
                        <span className="flex-1">
                          <span className="text-silver font-semibold">
                            {f.name}:
                          </span>{" "}
                          {f.explanation ?? ""}
                          <span
                            className={`ml-1 font-mono ${f.value > 0 ? "text-neon" : f.value < 0 ? "text-danger" : "text-mercury/60"}`}
                          >
                            ({f.value > 0 ? "+" : ""}
                            {f.value})
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

      <div className="px-4 sm:px-5 py-2 border-t border-white/[0.05] flex items-center justify-between">
        <span className="text-[10px] text-mercury/60">
          Weather · rest · matchup defense · injuries
        </span>
        <span className="text-[10px] text-mercury/60">
          Auto-graded vs ESPN box scores
        </span>
      </div>
    </div>
  );
}
