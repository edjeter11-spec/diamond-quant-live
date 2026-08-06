import { NextResponse } from "next/server";
import { cloudGet } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

// ──────────────────────────────────────────────────────────
// CRON HEALTH
//
// Reports how long it's been since /api/cron last completed a full run.
//
// Exists because of a silent 24-hour outage on 2026-08-04: Vercel suspends
// scheduled functions when an account has an overdue invoice. The site kept
// serving, every endpoint still worked when called by hand, and the only
// symptom was that the daily Discord post never arrived. Nothing anywhere
// reported a problem — the failure had no voice.
//
// The cron writes `cron_heartbeat` as the last step of a successful run, so a
// stale timestamp means it either isn't firing or isn't finishing. Both are
// worth knowing about, and both look identical from the outside otherwise.
// ──────────────────────────────────────────────────────────

// Cron runs every 30 min. Three misses is a real problem rather than one slow
// invocation or a deploy landing mid-cycle.
const STALE_MINUTES = 95;

export async function GET() {
  const hb = await cloudGet<{ at?: string; publishedToday?: boolean } | null>(
    "cron_heartbeat",
    null,
  );

  if (!hb?.at) {
    return NextResponse.json({
      ok: false,
      status: "never-run",
      message:
        "No heartbeat recorded yet. Expected within 30 minutes of deploy.",
    });
  }

  const ageMin = Math.round((Date.now() - new Date(hb.at).getTime()) / 60000);
  const stale = ageMin > STALE_MINUTES;

  return NextResponse.json({
    ok: !stale,
    status: stale ? "stalled" : "healthy",
    lastRunAt: hb.at,
    minutesAgo: ageMin,
    publishedToday: hb.publishedToday ?? false,
    // Surface WHY a publish didn't happen. Without this the health endpoint
    // said "healthy" with publishedToday:false and gave no hint that the
    // publish call had actually errored — which is how a broken board went
    // unnoticed for a full day.
    publishError:
      (hb as any).publishDetail?.ok === false
        ? ((hb as any).publishDetail.error ?? "publish failed")
        : undefined,
    // Named explicitly so whoever reads this at 9am knows where to look first
    // rather than re-deriving it from scratch, as I had to.
    message: stale
      ? `Cron hasn't completed in ${ageMin} minutes. Check Vercel billing (scheduled functions are suspended on overdue accounts) and Project Settings > Cron Jobs.`
      : `Cron healthy — last completed ${ageMin} min ago.`,
  });
}
