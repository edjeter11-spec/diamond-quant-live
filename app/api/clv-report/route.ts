import { NextResponse } from "next/server";
import { cloudGet } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

// ──────────────────────────────────────────────────────────
// CLV REPORT — the scanner's honest scoreboard
//
// Win/loss takes ~1,000 bets to say anything; closing line value takes ~50.
// If the prices we alert consistently beat Pinnacle's close, the scanner has
// a real edge whether or not last week's picks happened to cash. If they
// don't, no run of wins redeems it.
//
// Reads the log the cron writes: entry EV at alert time, closing EV once the
// final pre-pitch scan re-prices the same bet at Pinnacle's last number.
// `missed` entries (game started before a closer was captured) are counted
// and shown — dropping them would quietly flatter the average.
// ──────────────────────────────────────────────────────────

export async function GET() {
  const log = (await cloudGet<any[]>("edge_clv_log", [])) ?? [];

  const closed = log.filter((e) => e.close);
  const pending = log.filter((e) => !e.close && !e.missed);
  const missed = log.filter((e) => e.missed);

  const beat = closed.filter((e) => e.close.ev > 0);
  const avg = (xs: number[]) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

  const avgAlertEv = avg(closed.map((e) => e.alertEv));
  const avgCloseEv = avg(closed.map((e) => e.close.ev));

  return NextResponse.json({
    ok: true,
    totalAlerts: log.length,
    closed: closed.length,
    pending: pending.length,
    missed: missed.length,
    beatClosePct: closed.length
      ? Math.round((beat.length / closed.length) * 1000) / 10
      : null,
    avgAlertEv: avgAlertEv == null ? null : Math.round(avgAlertEv * 100) / 100,
    avgCloseEv: avgCloseEv == null ? null : Math.round(avgCloseEv * 100) / 100,
    recent: log
      .slice(-25)
      .reverse()
      .map((e) => ({
        game: e.game,
        side: e.side,
        book: e.book,
        alertEv: e.alertEv,
        closeEv: e.close?.ev ?? null,
        status: e.close ? "closed" : e.missed ? "missed" : "pending",
      })),
    verdict:
      closed.length < 20
        ? `Too early — ${closed.length} closed alerts, need ~20+ before the average means anything.`
        : (avgCloseEv ?? 0) > 0
          ? "Alerts are beating the close on average — the edge is real."
          : "Alerts are NOT holding value to the close — tighten the threshold or scan faster.",
  });
}
