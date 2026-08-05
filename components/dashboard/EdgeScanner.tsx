"use client";

import { useCallback, useEffect, useState } from "react";
import { Crosshair, RefreshCw } from "lucide-react";
import { BOOK_DISPLAY } from "@/lib/odds/the-odds-api";

// ──────────────────────────────────────────────────────────
// EDGE SCANNER — admin surface for /api/edge-scan
//
// Shows US book prices currently beating Pinnacle's de-vigged fair price.
// These are the only mathematically-grounded +EV plays in the whole app —
// no in-house model involved — which is why the panel leads with the book
// and the exact price: the edge IS that number at that book, and it dies
// when the book moves.
// ──────────────────────────────────────────────────────────

type Edge = {
  gameId: string;
  commence: string;
  game: string;
  side: string;
  book: string;
  price: number;
  fairProb: number;
  pinnaclePrice: number;
  evPct: number;
};

const am = (n: number) => (n > 0 ? `+${n}` : `${n}`);

export default function EdgeScanner() {
  const [edges, setEdges] = useState<Edge[]>([]);
  const [anchored, setAnchored] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [scannedAt, setScannedAt] = useState<string | null>(null);
  const [clv, setClv] = useState<any>(null);

  const scan = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      // minEv=1 here (looser than the cron's 2% alert bar) — on this screen a
      // human is looking, and a 1.2% edge is still worth a glance.
      const r = await fetch("/api/edge-scan?minEv=1");
      const d = await r.json();
      if (!d.ok) throw new Error(d.error ?? "scan failed");
      setEdges(d.edges ?? []);
      setAnchored(d.gamesAnchored ?? 0);
      setScannedAt(
        new Date().toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        }),
      );
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Costs 2 Odds API credits per scan, so scan on mount and on demand — no
  // auto-refresh loop. The CLV report is free (reads a Supabase log).
  useEffect(() => {
    scan();
    fetch("/api/clv-report")
      .then((r) => r.json())
      .then((d) => d?.ok && setClv(d))
      .catch(() => {});
  }, [scan]);

  return (
    <div className="rounded-xl bg-[#0a0e17] border border-[#232a3d]/50 p-4">
      <div className="flex items-center gap-2 mb-1">
        <Crosshair className="w-4 h-4 text-[#4ade80]" />
        <h3 className="text-sm font-bold text-white">Edge Scanner</h3>
        <span className="text-[10px] text-[#8e9ab5] font-mono">
          vs PINNACLE FAIR
        </span>
        <button
          onClick={scan}
          disabled={loading}
          className="ml-auto p-1.5 rounded-lg hover:bg-[#121727] transition-colors"
          title="Rescan (2 API credits)"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 text-[#8e9ab5] ${loading ? "animate-spin" : ""}`}
          />
        </button>
      </div>
      <p className="text-[11px] text-[#8e9ab5] mb-3 leading-snug">
        US prices beating Pinnacle&apos;s de-vigged line = +EV by definition.
        Edges close in minutes — the price shown is only good until the book
        moves.
        {scannedAt && (
          <span className="font-mono">
            {" "}
            · {anchored} games · scanned {scannedAt}
          </span>
        )}
      </p>

      {err && <p className="text-xs text-[#ff5c7a]">{err}</p>}

      {!err && edges.length === 0 && !loading && (
        <p className="text-xs text-[#8e9ab5] italic">
          Nothing beats Pinnacle right now. Normal — rescan near
          lineup-confirmation time (2-4h before first pitch), when soft books
          lag the news.
        </p>
      )}

      <div className="space-y-2">
        {edges.map((e) => {
          const book = BOOK_DISPLAY[e.book];
          return (
            <div
              key={`${e.gameId}|${e.side}|${e.book}`}
              className="flex items-center gap-3 rounded-lg bg-[#0d1220] border border-[#232a3d]/40 px-3 py-2"
            >
              <span className="text-sm font-bold text-[#4ade80] font-mono w-16">
                +{e.evPct.toFixed(1)}%
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-white font-semibold truncate">
                  {e.side} ML {am(e.price)}
                </p>
                <p className="text-[10px] text-[#8e9ab5] truncate">
                  {e.game} · fair {e.fairProb}% · Pin {am(e.pinnaclePrice)}
                </p>
              </div>
              <span
                className="text-[10px] font-bold font-mono px-2 py-1 rounded"
                style={{
                  color: book?.color ?? "#8e9ab5",
                  backgroundColor: `${book?.color ?? "#8e9ab5"}18`,
                }}
              >
                {book?.short ?? e.book.toUpperCase()}
              </span>
            </div>
          );
        })}
      </div>

      {/* CLV scoreboard — whether alerted prices held value to Pinnacle's
          close. This is the panel's report card: ~50 closed alerts tells us
          if the scanner is real, long before win/loss could. */}
      {clv && clv.totalAlerts > 0 && (
        <div className="mt-3 pt-3 border-t border-[#232a3d]/40">
          <p className="text-[10px] text-[#8e9ab5] font-mono mb-1">
            CLV — {clv.closed} closed · {clv.pending} pending
            {clv.missed > 0 && ` · ${clv.missed} missed`}
          </p>
          {clv.closed > 0 ? (
            <p className="text-[11px] text-[#e6eaf4]">
              <span
                className={
                  (clv.avgCloseEv ?? 0) > 0
                    ? "text-[#4ade80] font-bold"
                    : "text-[#ff5c7a] font-bold"
                }
              >
                {clv.beatClosePct}% beat the close
              </span>{" "}
              · avg EV at alert +{clv.avgAlertEv}% → at close{" "}
              {(clv.avgCloseEv ?? 0) >= 0 ? "+" : ""}
              {clv.avgCloseEv}%
            </p>
          ) : (
            <p className="text-[11px] text-[#8e9ab5] italic">
              No alerts have closed yet — closers snapshot on the last scan
              before first pitch.
            </p>
          )}
          <p className="text-[10px] text-[#8e9ab5] mt-0.5">{clv.verdict}</p>
        </div>
      )}
    </div>
  );
}
