import { NextResponse } from "next/server";
import { cloudGet } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

// ──────────────────────────────────────────────────────────
// PROPS CLV REPORT — same idea as /api/clv-report, applied to the props board.
//
// Win/loss on the props board takes hundreds of graded picks to say anything
// meaningful (the last read was 54.6% winners at -6.03u — accuracy and
// profitability disagreeing is exactly why this metric exists). Closing line
// value resolves faster: if the fair prob we publish at POST time consistently
// beats the fair prob at CLOSE time (first pitch), the board is finding real
// value ahead of the market, independent of how any single night's results
// land.
// ──────────────────────────────────────────────────────────

export async function GET() {
  const log = (await cloudGet<any[]>("props_clv_log", [])) ?? [];

  const closed = log.filter((e) => e.close);
  const pending = log.filter((e) => !e.close && !e.missed);
  const missed = log.filter((e) => e.missed);

  // Sign convention, stated once so the verdict below can't drift from it:
  //
  //   delta = closeFairProb - entryFairProb
  //
  // POSITIVE = the market's fair prob ROSE after we posted, i.e. it moved
  // TOWARD our side — we got the number before the market did. That is good
  // CLV. NEGATIVE = the market moved away from us; we posted a number that
  // got worse by first pitch, which is what "posted too early / stale board"
  // looks like.
  //
  // This was previously computed as entryFairProb - closeFairProb while the
  // comment described the opposite meaning, and the verdict then tested
  // `avgDelta < 0` for the GOOD case — so a board losing to the close would
  // have been reported as beating it. beatClosePct was always right
  // (entry < close), which is how the disagreement showed up: 0% beat the
  // close alongside an "average" the verdict would have called good.
  const deltas = closed.map((e) => e.closeFairProb - e.entryFairProb);
  const avg = (xs: number[]) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const avgDelta = avg(deltas);
  const beatClose = closed.filter(
    (e) => e.entryFairProb < e.closeFairProb,
  ).length;

  return NextResponse.json({
    ok: true,
    totalLogged: log.length,
    closed: closed.length,
    pending: pending.length,
    missed: missed.length,
    beatClosePct: closed.length
      ? Math.round((beatClose / closed.length) * 1000) / 10
      : null,
    avgFairProbDelta:
      avgDelta == null ? null : Math.round(avgDelta * 100) / 100,
    recent: log
      .slice(-25)
      .reverse()
      .map((e) => ({
        player: e.playerName,
        market: e.market,
        side: e.side,
        line: e.line,
        entryFairProb: e.entryFairProb,
        closeFairProb: e.closeFairProb ?? null,
        status: e.close ? "closed" : e.missed ? "missed" : "pending",
      })),
    verdict:
      closed.length < 20
        ? `Too early — ${closed.length} closed picks, need ~20+ for the average to mean anything.` +
          (closed.length >= 5 && (avgDelta ?? 0) < 0
            ? ` Early read is unfavourable though: ${beatClose}/${closed.length} beat the close, average ${avgDelta!.toFixed(2)} pts against us.`
            : "")
        : (avgDelta ?? 0) > 0
          ? "Board beats the close on average — the picks find real value before the market catches up."
          : "Board is NOT beating the close — the market moves away from these picks after posting. Post later, when consensus has sharpened.",
  });
}
