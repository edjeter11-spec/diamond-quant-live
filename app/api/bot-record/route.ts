import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server-auth";

export const dynamic = "force-dynamic";

// ──────────────────────────────────────────────────────────
// BOT CHALLENGE — PUBLIC RECORD
//
// Reads bot_picks, which is written service-role-only and graded against
// final scores. Kept deliberately separate from /api/results (the player-prop
// record): these are moneylines, a different bet with a different model, and
// averaging the two would produce a number describing neither.
//
// Reports units, not a bankroll. The old UI showed a $5,000 balance that lived
// in each visitor's localStorage — so two people saw different numbers and
// clearing site data "reset" the record. Units are stake-relative and mean the
// same thing to everyone.
// ──────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!supabaseAdmin)
    return NextResponse.json({ ok: false, error: "Not configured" });

  const { searchParams } = new URL(req.url);
  const sport = (searchParams.get("sport") ?? "mlb").toLowerCase();
  const days = Math.min(
    365,
    Math.max(1, Number(searchParams.get("days") ?? 30)),
  );

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);

  const { data, error } = await supabaseAdmin
    .from("bot_picks")
    .select("*")
    .eq("sport", sport)
    .gte("slate_date", since.toISOString().slice(0, 10))
    .order("slate_date", { ascending: false });

  if (error)
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );

  const rows = data ?? [];
  const graded = rows.filter((r) => r.result && r.result !== "pending");
  const wins = graded.filter((r) => r.result === "win").length;
  const losses = graded.filter((r) => r.result === "loss").length;
  const pushes = graded.filter((r) => r.result === "push").length;
  const unitsNet = graded.reduce(
    (s, r) =>
      s + Number(r.profit_units ?? 0) / Math.max(1, Number(r.stake ?? 1)),
    0,
  );

  // Same standard as StatsStrip and /track-record: below 30 graded picks we
  // report the raw record and withhold the rate. A 3-1 start is not "75%".
  const MIN_SAMPLE = 30;
  const decided = wins + losses;
  const thin = decided < MIN_SAMPLE;

  // Accuracy by confidence band — the backtest showed the model gets sharply
  // better when it's more certain (81% on its top band), so this is the number
  // worth watching as live results accumulate.
  const bands = [
    { label: "high", min: 0.6 },
    { label: "medium", min: 0.55 },
    { label: "all", min: 0 },
  ].map(({ label, min }) => {
    const sel = graded.filter(
      (r) => Math.abs(Number(r.model_prob ?? 0.5) - 0.5) + 0.5 >= min,
    );
    const w = sel.filter((r) => r.result === "win").length;
    const d = sel.filter((r) => r.result !== "push").length;
    return {
      band: label,
      picks: sel.length,
      winRate: d > 0 ? Math.round((w / d) * 1000) / 10 : null,
    };
  });

  return NextResponse.json({
    ok: true,
    sport,
    days,
    record: {
      wins,
      losses,
      pushes,
      graded: graded.length,
      pending: rows.length - graded.length,
    },
    // Null rather than a misleading number below the sample floor.
    winRate: thin ? null : Math.round((wins / decided) * 1000) / 10,
    needsMore: thin ? MIN_SAMPLE - decided : 0,
    unitsNet: Math.round(unitsNet * 100) / 100,
    bands,
    recent: rows.slice(0, 25).map((r) => ({
      date: r.slate_date,
      game: r.game,
      pick: r.pick,
      odds: r.odds,
      modelProb: Number(r.model_prob),
      confidence: r.confidence,
      result: r.result,
      profitUnits: r.profit_units,
    })),
  });
}
