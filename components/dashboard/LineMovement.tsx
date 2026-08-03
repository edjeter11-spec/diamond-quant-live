"use client";

// ──────────────────────────────────────────────────────────
// LINE MOVEMENT
//
// Reads server-side history (/api/sharp-money, backed by odds_history) rather
// than per-browser localStorage snapshots.
//
// The old version had three compounding problems that meant it never showed
// anything: it only rendered when a game was SELECTED (the board passes an
// empty array otherwise), snapshots lived in localStorage so every visitor
// started with zero history, and it needed two snapshots ~5 min apart while
// odds are cached for 15 — so consecutive polls returned identical data and
// produced no movement. It sat on "Collecting odds data…" permanently.
//
// Server-side history fixes all three: the cron snapshots on a schedule, every
// visitor sees the same moves immediately, and no game selection is required.
// ──────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { Activity, ArrowUp, ArrowDown, Clock, Flame } from "lucide-react";
import { useSport } from "@/lib/sport-context";

interface ServerMove {
  game: string;
  bookmaker: string;
  market: string;
  from: number;
  to: number;
  delta: number;
  direction: "up" | "down";
  minutes_ago: number;
  is_sharp?: boolean;
}

/** DK/FD sitting off the market median — actionable without any model. */
interface Outlier {
  game: string;
  bookmaker: string;
  market: string;
  ourLine: number;
  marketMedian: number;
  diff: number;
  books: number;
  note: string;
}

const SPORT_KEY: Record<string, string> = {
  mlb: "baseball_mlb",
  nba: "basketball_nba",
  nfl: "americanfootball_nfl",
  nhl: "icehockey_nhl",
};

function fmt(v: number, market: string): string {
  // Moneyline is American odds; spread/total are points.
  if (market.toLowerCase().includes("moneyline"))
    return v > 0 ? `+${v}` : String(v);
  return String(v);
}

export default function LineMovement() {
  const { currentSport } = useSport();
  const [moves, setMoves] = useState<ServerMove[]>([]);
  const [outliers, setOutliers] = useState<Outlier[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    const sportKey = SPORT_KEY[currentSport] ?? "baseball_mlb";

    const load = async () => {
      try {
        const r = await fetch(`/api/sharp-money?sport=${sportKey}`, {
          signal: AbortSignal.timeout(10000),
        });
        const d = await r.json();
        if (cancelled) return;
        setMoves(Array.isArray(d?.movements) ? d.movements : []);
        setOutliers(Array.isArray(d?.outliers) ? d.outliers : []);
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    };

    load();
    // Server caches for 60s; polling faster just burns requests.
    const id = setInterval(load, 90_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [currentSport]);

  // Biggest moves first — a 2-point total swing matters more than a half-point.
  const sorted = [...moves].sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0));
  const shown = sorted.slice(0, 8);

  return (
    <div className="glass rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate/50 flex items-center gap-2">
        <Activity className="w-5 h-5 text-amber" />
        <h3 className="text-sm font-semibold text-silver uppercase tracking-wide">
          Line Movement
        </h3>
        {shown.length > 0 && (
          <span className="px-1.5 py-0.5 bg-amber/15 text-amber text-[10px] font-bold rounded">
            {moves.length} move{moves.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {state === "loading" ? (
        <div className="p-4 space-y-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-10 rounded-lg bg-gunmetal/30 animate-pulse"
            />
          ))}
        </div>
      ) : outliers.length === 0 && shown.length === 0 ? (
        <div className="p-5 text-center">
          <div className="w-10 h-10 rounded-full bg-gunmetal/50 flex items-center justify-center mx-auto mb-2">
            <Clock className="w-5 h-5 text-mercury/40" />
          </div>
          <p className="text-sm text-mercury">Lines steady right now</p>
          <p className="text-xs text-mercury/50 mt-1 max-w-[210px] mx-auto">
            No meaningful moves in the last hour. We check every few minutes and
            surface anything that shifts.
          </p>
          <div className="flex items-center justify-center gap-1.5 mt-3">
            <div className="w-1.5 h-1.5 rounded-full bg-amber/50 animate-pulse" />
            <span className="text-[10px] text-amber/60 font-mono">
              Monitoring all books
            </span>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-slate/10">
          {/* Off-market lines first. A move tells you the market changed its
              mind; an outlier tells you OUR book hasn't caught up yet, which
              is the one you can actually still bet. */}
          {outliers.slice(0, 4).map((o, i) => (
            <div
              key={`out-${o.game}-${o.bookmaker}-${o.market}-${i}`}
              className="px-4 py-2.5 bg-amber/5"
            >
              <div className="flex items-center gap-2">
                <span className="px-1.5 py-0.5 rounded bg-amber/20 text-amber text-[9px] font-bold flex-shrink-0">
                  OFF MARKET
                </span>
                <p className="text-xs font-semibold text-silver truncate">
                  {o.game}
                </p>
              </div>
              <p className="text-[10px] text-mercury/70 mt-1">
                {o.bookmaker} {o.market}{" "}
                <span className="font-mono text-silver">{o.ourLine}</span> vs
                market{" "}
                <span className="font-mono text-silver">{o.marketMedian}</span>{" "}
                <span className="text-mercury/50">({o.books} books)</span>
              </p>
              <p className="text-[10px] text-amber/80 mt-0.5">{o.note}</p>
            </div>
          ))}
          {shown.map((m, i) => (
            <div
              key={`${m.game}-${m.bookmaker}-${m.market}-${i}`}
              className="px-4 py-2.5 flex items-center gap-3 hover:bg-gunmetal/30 transition-colors"
            >
              <div
                className={`p-1.5 rounded flex-shrink-0 ${
                  m.direction === "up" ? "bg-neon/10" : "bg-danger/10"
                }`}
              >
                {m.direction === "up" ? (
                  <ArrowUp className="w-3.5 h-3.5 text-neon" />
                ) : (
                  <ArrowDown className="w-3.5 h-3.5 text-danger" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-silver truncate">
                  {m.game}
                </p>
                <p className="text-[10px] text-mercury/60 truncate">
                  {m.market} · {m.bookmaker} · {m.minutes_ago}m
                </p>
              </div>

              <div className="text-right flex-shrink-0">
                <p className="text-xs font-mono text-silver">
                  <span className="text-mercury/50">
                    {fmt(m.from, m.market)}
                  </span>
                  {" → "}
                  <span className="font-semibold">{fmt(m.to, m.market)}</span>
                </p>
                {m.is_sharp && (
                  <span className="inline-flex items-center gap-0.5 text-[9px] text-amber font-bold">
                    <Flame className="w-2.5 h-2.5" /> SHARP
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
