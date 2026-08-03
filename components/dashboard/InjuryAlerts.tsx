"use client";

// Injury Alerts rail panel from the product render.
//
// Real data only — reads /api/mlb-injuries or /api/nba-injuries, both of which
// normalize ESPN's public injury feed. Sports without a wired-up feed render an
// honest "not available for this sport" state rather than inventing
// plausible-looking injuries, which on a betting dashboard would be actively
// dangerous (people size bets off injury news).

import { useEffect, useState } from "react";
import { Stethoscope } from "lucide-react";

interface InjuredPlayer {
  name?: string;
  player?: string;
  status?: string;
  /** ESPN blurb. NBA emits `shortComment`, MLB normalizes to `detail`. The
   *  old code only read `injury`, which neither feed sets — so the detail
   *  line was always blank. */
  detail?: string;
  shortComment?: string;
  injury?: string;
  position?: string;
  returnDate?: string;
}
interface TeamReport {
  teamAbbrev?: string;
  players?: InjuredPlayer[];
}

const STATUS_TONE: Record<string, string> = {
  out: "text-danger",
  doubtful: "text-danger",
  questionable: "text-amber",
  probable: "text-neon",
  "day-to-day": "text-amber",
};

export default function InjuryAlerts({ sport }: { sport: string }) {
  const [rows, setRows] = useState<
    { name: string; team: string; status: string; detail: string }[]
  >([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const supported = sport === "nba" || sport === "mlb";

  useEffect(() => {
    if (!supported) {
      setState("ready");
      setRows([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          sport === "mlb" ? "/api/mlb-injuries" : "/api/nba-injuries",
          { signal: AbortSignal.timeout(8000) },
        );
        const d = await res.json();
        const flat: typeof rows = [];
        for (const t of (d?.injuries ?? []) as TeamReport[]) {
          for (const p of t.players ?? []) {
            flat.push({
              name: p.name ?? p.player ?? "Unknown",
              team: t.teamAbbrev ?? "",
              status: (p.status ?? "").toLowerCase(),
              // Both feeds are covered: MLB normalizes to `detail`, NBA emits
              // `shortComment`. `injury` is kept last for safety.
              detail: p.detail ?? p.shortComment ?? p.injury ?? "",
            });
          }
        }
        // Most actionable first: Out/Doubtful before day-to-day.
        const rank = (s: string) =>
          s.startsWith("out") ? 0 : s.startsWith("doubt") ? 1 : 2;

        // Interleave teams before slicing. The feed arrives grouped by team and
        // Array.sort is stable, so when every player ranks the same (they're
        // nearly all "Out"), the original grouping survived and slice(0, 6)
        // returned six players from whichever team sorted first — the panel
        // showed six Diamondbacks and nothing from the 29 other teams.
        // Round-robin gives one player per team before any team gets a second.
        const byTeam = new Map<string, typeof flat>();
        for (const r of flat) {
          const list = byTeam.get(r.team) ?? [];
          list.push(r);
          byTeam.set(r.team, list);
        }
        for (const list of byTeam.values())
          list.sort((a, b) => rank(a.status) - rank(b.status));
        const spread: typeof flat = [];
        for (let i = 0; spread.length < flat.length; i++) {
          let added = false;
          for (const list of byTeam.values()) {
            if (list[i]) {
              spread.push(list[i]);
              added = true;
            }
          }
          if (!added) break;
        }
        spread.sort((a, b) => rank(a.status) - rank(b.status));

        if (!cancelled) {
          setRows(spread.slice(0, 6));
          setState("ready");
        }
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sport, supported]);

  return (
    <div className="glass rounded-xl border border-slate/20 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate/15 flex items-center gap-2">
        <Stethoscope className="w-4 h-4 text-danger" />
        <h3 className="text-xs font-bold text-silver uppercase tracking-wider">
          Injury Alerts
        </h3>
      </div>

      <div className="p-3">
        {!supported ? (
          <p className="text-[11px] text-mercury/60 leading-snug">
            Live injury feed covers MLB and NBA. {sport.toUpperCase()} status
            still comes through the game cards and matchup detail.
          </p>
        ) : state === "loading" ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-8 rounded-lg bg-gunmetal/30 animate-pulse"
              />
            ))}
          </div>
        ) : state === "error" ? (
          <p className="text-[11px] text-mercury/60">
            Injury feed unavailable right now.
          </p>
        ) : rows.length === 0 ? (
          <p className="text-[11px] text-mercury/60">
            No injuries reported on today&apos;s slate.
          </p>
        ) : (
          <div className="space-y-1.5">
            {rows.map((r, i) => (
              <div
                key={`${r.name}-${i}`}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-gunmetal/25"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-silver truncate">
                    {r.name}
                    {r.team && (
                      <span className="text-mercury/50 font-normal ml-1">
                        ({r.team})
                      </span>
                    )}
                  </p>
                  {r.detail && (
                    <p className="text-[10px] text-mercury/60 truncate">
                      {r.detail}
                    </p>
                  )}
                </div>
                <span
                  className={`text-[9px] font-bold uppercase flex-shrink-0 ${
                    STATUS_TONE[r.status] ?? "text-mercury"
                  }`}
                >
                  {r.status || "—"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
