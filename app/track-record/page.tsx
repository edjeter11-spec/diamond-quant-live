import { Metadata } from "next";
import Link from "next/link";
import { cloudGet } from "@/lib/supabase/client";
import {
  Trophy,
  TrendingUp,
  Crown,
  Sparkles,
  ArrowRight,
  CheckCircle,
  XCircle,
  Brain,
  DollarSign,
} from "lucide-react";
import ProfitChart from "@/components/ProfitChart";
import EmailCaptureModal from "@/components/EmailCaptureModal";
import StructuredData from "@/components/StructuredData";

export const dynamic = "force-dynamic";
export const revalidate = 60;

// The previous description advertised a "4,041-game historical backtest
// (54.1% win rate)". Those two numbers appeared nowhere else in the codebase —
// no backtest artifact, no computation, no DB read. They were literals typed
// into page metadata, which is what Google and every social share surface, and
// 54.1% sits just above the ~52.4% break-even at -110, i.e. precisely the
// figure that reads as "this model is profitable". Removed: an unsourced
// performance claim is the single most misleading thing this site could show
// someone deciding whether to stake money.
export const metadata: Metadata = {
  title: "Quant Betting — Live Track Record",
  description:
    "Every pick we publish, graded against final scores — wins and losses both. Live, forward-tested results with the sample size shown.",
  openGraph: {
    title: "Quant Betting — Live Track Record",
    description:
      "Every pick we publish, graded against final scores — wins and losses both. Live, forward-tested results with the sample size shown.",
  },
};

interface PropPick {
  playerName: string;
  team: string;
  propType: string;
  line: number;
  side: "over" | "under";
  result?: "pending" | "win" | "loss" | "push";
  actualValue?: number;
  date: string;
  odds: number;
  bookmaker: string;
}

// Same standard as components/dashboard/StatsStrip.tsx: below MIN_SAMPLE
// decided picks we report the raw record and skip the rate entirely. A 3-1
// start is not "75.0% accuracy", and on a betting site that number is what
// people stake money on. Keep this threshold in sync with StatsStrip.
const MIN_SAMPLE = 30;

/**
 * Recently graded picks, newest first, from the LIVE record.
 *
 * The page used to read `prop_pick_history_nba` — a cloud blob whose newest
 * entry was 2026-05-11, three months stale, from a season that's over. It
 * showed NBA rebounds props while the site was publishing MLB daily. Anyone
 * checking the "recent" list saw picks older than the product.
 *
 * /api/results is the same source the board's record strip uses, so the two
 * can't disagree.
 */
/** The API's authoritative roll-up, or null if it's unreachable.
 *
 *  `recent` is a 20-row display slice (api/results caps it) covering only
 *  daily_picks_log. `overall` spans the whole window AND folds in
 *  prop_predictions. The page used to compute its headline record from
 *  `recent`, which meant the number labelled "All-time graded" was at most 20
 *  picks from one table — and since MIN_SAMPLE is 30, `thin` was ALWAYS true
 *  and the win rate was never displayed at all. */
async function getOverall(days = 365): Promise<{
  total: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;
  profitUnits: number;
} | null> {
  try {
    const r = await fetch(
      `https://diamond-quant-live.vercel.app/api/results?days=${days}`,
      { next: { revalidate: 300 } },
    );
    if (!r.ok) return null;
    const d = await r.json();
    return d?.overall ?? null;
  } catch {
    return null;
  }
}

async function getRecentGraded(): Promise<PropPick[]> {
  try {
    const r = await fetch(
      "https://diamond-quant-live.vercel.app/api/results?days=30",
      { next: { revalidate: 300 } },
    );
    if (!r.ok) return [];
    const d = await r.json();
    const rows: any[] = d?.recent ?? [];
    return rows
      .filter((p) => p.result === "win" || p.result === "loss")
      .slice(0, 30)
      .map((p) => ({
        playerName: p.pick_text ?? "",
        team: p.game ?? "",
        propType: p.category ?? "",
        line: 0,
        side: "over" as const,
        result: p.result,
        date: p.pick_date ?? "",
        odds: Number(p.odds ?? -110),
        bookmaker: p.bookmaker ?? "",
      }));
  } catch {
    return [];
  }
}

async function getStats() {
  // Live graded picks first. The NBA blob is only a fallback for when the API
  // is unreachable — on its own it reports a record from a finished season
  // while the site publishes MLB daily, so the headline number described a
  // different sport than the picks underneath it.
  const [live, overall] = await Promise.all([
    getRecentGraded(),
    getOverall(365),
  ]);
  // Only fall back to the stale NBA blob when the API is genuinely
  // unreachable (overall === null) — NOT when it returns an empty list. An
  // empty-but-successful response used to be indistinguishable from a failed
  // one here, so a quiet day served a finished-season NBA record under an
  // "All-time" label.
  const history =
    live.length > 0
      ? live
      : overall === null
        ? ((await cloudGet<PropPick[]>("prop_pick_history_nba", [])) ?? [])
        : [];

  // Headline record comes from the API's roll-up, which spans the whole
  // window and includes prop_predictions — not from `history`, which is a
  // 20-row display slice of daily_picks_log only.
  const wins =
    overall?.wins ?? history.filter((p) => p.result === "win").length;
  const losses =
    overall?.losses ?? history.filter((p) => p.result === "loss").length;
  const pushes =
    overall?.pushes ?? history.filter((p) => p.result === "push").length;
  // Pushes are excluded from the win-rate denominator (standard betting
  // convention), but that exclusion has to be visible or the W/L numbers
  // won't reconcile with the graded total. Counted here, surfaced in the UI.
  const decided = wins + losses;
  const graded = history.filter(
    (p) => p.result === "win" || p.result === "loss",
  );
  const winRate = decided > 0 ? (wins / decided) * 100 : 0;

  // Group by date
  const dailyMap = new Map<string, { wins: number; losses: number }>();
  for (const p of graded) {
    const day = p.date ?? "";
    if (!day) continue;
    const cur = dailyMap.get(day) ?? { wins: 0, losses: 0 };
    if (p.result === "win") cur.wins++;
    if (p.result === "loss") cur.losses++;
    dailyMap.set(day, cur);
  }
  const daily = [...dailyMap.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 14)
    .map(([date, stats]) => ({
      date,
      ...stats,
      total: stats.wins + stats.losses,
    }));

  const recent = history.slice(0, 30);

  return {
    wins,
    losses,
    pushes,
    winRate,
    // Decided picks across the FULL window, not `graded.length` (the 20-row
    // display slice). This drives the MIN_SAMPLE gate — using the slice meant
    // totalGraded could never exceed 20, `thin` was permanently true, and the
    // win rate was never shown no matter how many picks had actually graded.
    totalGraded: decided,
    daily,
    recent,
  };
}

async function getBrain() {
  const brain = await cloudGet<any>("nba_prop_brain", null);
  return brain
    ? {
        games: brain.totalGamesProcessed ?? 0,
        predictions: brain.totalPredictions ?? 0,
        players: Object.keys(brain.playerMemory ?? {}).length,
        version: brain.version ?? "1.0.0",
      }
    : null;
}

export default async function TrackRecordPage() {
  const [stats, brain] = await Promise.all([getStats(), getBrain()]);

  // Thin sample => no headline percentage anywhere on this page. See
  // MIN_SAMPLE above and StatsStrip.tsx for the rationale.
  const thin = stats.totalGraded < MIN_SAMPLE;
  const needed = MIN_SAMPLE - stats.totalGraded;

  return (
    <div className="min-h-screen bg-bunker">
      {/* Hero */}
      <div className="relative overflow-hidden border-b border-slate/30">
        <div className="absolute inset-0 bg-gradient-to-br from-gold/5 via-electric/5 to-purple/10" />
        <div className="relative max-w-4xl mx-auto px-4 py-12 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-neon/10 border border-neon/30 mb-4">
            <span className="w-2 h-2 rounded-full bg-neon animate-pulse" />
            <span className="text-[10px] uppercase tracking-wider text-neon font-bold">
              Every Pick, Graded
            </span>
          </div>
          {/* Sells the PRODUCT, not a number.
              The old headline ("AI Sports Betting That Actually Learns" +
              "trained on 4,041 games") was a research claim, and the stat it
              leaned on described NBA training scale — not whether anyone made
              money. What's genuinely rare here is the transparency: picks are
              locked before first pitch and graded in public, losses included.
              That's the pitch, and unlike a win rate it can't be disproved by
              a bad week. */}
          <h1 className="text-4xl md:text-5xl font-bold text-silver mb-3">
            Locked before first pitch.
            <br />
            <span className="bg-gradient-to-r from-gold via-electric to-purple bg-clip-text text-transparent">
              Graded in public.
            </span>
          </h1>
          <p className="text-base text-mercury max-w-2xl mx-auto mb-8">
            Every pick is published before the games start and settled against
            real box scores after — wins and losses both. No edits, no quiet
            deletions, no cherry-picked screenshots.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/pricing"
              className="group inline-flex items-center justify-center gap-2 min-h-[52px] px-7 rounded-xl bg-gradient-to-r from-gold via-yellow-400 to-gold text-bunker font-bold text-base shadow-lg shadow-gold/30 hover:shadow-gold/50 hover:scale-[1.02] active:scale-[0.98] transition-all"
            >
              <Sparkles className="w-4 h-4" />
              Start 7-Day Free Trial
              <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 min-h-[52px] px-7 rounded-xl bg-gunmetal/40 border border-slate/30 text-mercury hover:text-silver hover:border-slate/60 hover:bg-gunmetal/60 transition-all"
            >
              See Today's Picks →
            </Link>
          </div>
          <p className="text-[11px] text-mercury/50 mt-4">
            No credit card surprises · cancel anytime
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* LIVE TRACK RECORD — real forward-tested performance */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="w-1.5 h-1.5 rounded-full bg-neon animate-pulse" />
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-neon">
              What You Get
            </h2>
          </div>
          <p className="text-[11px] text-mercury/50 mb-3">
            Picks land before first pitch and settle themselves after. The full
            graded history is below — including the losses.
          </p>

          {/* Sell the product, not a number.
              Two stat tiles used to headline a win rate here. Numbers move
              week to week and invite a reader to check them against a bad
              stretch; these three claims are structural and stay true. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            {[
              {
                icon: <Trophy className="w-5 h-5 text-gold mx-auto mb-2" />,
                title: "Locked Pre-Game",
                body: "Published before first pitch and never edited after. What you see is what gets graded.",
              },
              {
                icon: (
                  <CheckCircle className="w-5 h-5 text-neon mx-auto mb-2" />
                ),
                title: "Auto-Graded",
                body: "Settled against real box scores. Wins and losses both, no quiet deletions.",
              },
              {
                icon: (
                  <TrendingUp className="w-5 h-5 text-electric mx-auto mb-2" />
                ),
                title: "The Math, Shown",
                body: "Every pick carries its projection and price so you can check the reasoning.",
              },
            ].map((f) => (
              <div
                key={f.title}
                className="glass rounded-xl p-4 text-center border border-slate/20"
              >
                {f.icon}
                <p className="text-sm font-bold text-silver">{f.title}</p>
                <p className="text-[10px] text-mercury/70 mt-1.5 leading-snug">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
          {/* The record stays on the page — just not as the headline. Removing
              it entirely would undercut the whole "we show our losses" pitch
              above it, which is the thing actually being sold here. One quiet
              line, accurate, with the sample size attached. */}
          <div className="glass rounded-lg px-4 py-2.5 border border-slate/20 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px]">
            {/* "Last 12 months", not "All-time" — getOverall queries a 365-day
                window, so claiming all-time would overstate the span. */}
            <span className="text-mercury/60 uppercase tracking-wide text-[9px]">
              Graded (last 12 mo)
            </span>
            <span className="font-mono text-silver">
              {stats.totalGraded === 0
                ? "—"
                : `${stats.wins}W-${stats.losses}L`}
            </span>
            {!thin && stats.totalGraded > 0 && (
              <span className="font-mono text-mercury/70">
                {stats.winRate.toFixed(1)}%
              </span>
            )}
            {stats.pushes > 0 && (
              <span className="text-mercury/50">
                {stats.pushes} push{stats.pushes === 1 ? "" : "es"}
              </span>
            )}
            {thin && stats.totalGraded > 0 && (
              <span className="text-amber/70">
                {needed} more for a meaningful rate
              </span>
            )}
          </div>
        </div>

        {/* MODEL TRAINING section removed. It headlined "4,041 games
            trained / 300 players tracked" from an NBA brain whose newest
            graded pick was 2026-05-11 — a season that ended months ago. Corpus
            size is not a performance claim, the sport was wrong, and the data
            was stale, so it was three kinds of noise on a page meant to build
            trust. */}

        {/* Live cumulative profit chart — the conversion killer */}
        <div className="glass rounded-xl p-6 border-2 border-neon/20 bg-gradient-to-br from-neon/3 to-transparent">
          <h2 className="text-lg font-bold text-silver mb-1 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-neon" /> If you'd followed every
            brain pick
          </h2>
          <p className="text-xs text-mercury/60 mb-4">
            Live cumulative profit at $100/bet, -110 odds, using only picks the
            brain has actually surfaced and that have since been graded — not a
            backtest or simulation.
          </p>
          <ProfitChart sport="mlb" />
          {/* Same MIN_SAMPLE threshold as the tiles above, not a separate number. */}
          {stats.totalGraded > 0 && thin && (
            <p className="text-[10px] text-amber/70 mt-2 text-center">
              Small sample ({stats.totalGraded} graded picks) — early results
              can swing widely and aren't yet statistically reliable.
            </p>
          )}
        </div>

        {/* How it works */}
        <div className="glass rounded-xl p-6 border border-slate/20">
          <h2 className="text-lg font-bold text-silver mb-4 flex items-center gap-2">
            <Brain className="w-5 h-5 text-purple" /> How It Works
          </h2>
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <div className="w-8 h-8 rounded-full bg-electric/10 border border-electric/30 flex items-center justify-center text-electric font-bold text-sm mb-2">
                1
              </div>
              <h3 className="text-sm font-semibold text-silver mb-1">
                Brain Trains Nightly
              </h3>
              <p className="text-xs text-mercury/70">
                Every night the brain re-trains on the last 3 NBA seasons. Daily
                auto-evolution finds the best weight configuration via
                tournament selection.
              </p>
            </div>
            <div>
              <div className="w-8 h-8 rounded-full bg-purple/10 border border-purple/30 flex items-center justify-center text-purple font-bold text-sm mb-2">
                2
              </div>
              <h3 className="text-sm font-semibold text-silver mb-1">
                Picks Hit Every Slate
              </h3>
              <p className="text-xs text-mercury/70">
                Pulls live odds from 10+ books, runs every player through the
                projector, surfaces only edges with positive expected value.
              </p>
            </div>
            <div>
              <div className="w-8 h-8 rounded-full bg-gold/10 border border-gold/30 flex items-center justify-center text-gold font-bold text-sm mb-2">
                3
              </div>
              <h3 className="text-sm font-semibold text-silver mb-1">
                Auto-Graded & Public
              </h3>
              <p className="text-xs text-mercury/70">
                After games end, every pick is graded against real ESPN box
                scores. Wins, losses, all transparent. Brain learns from each
                result.
              </p>
            </div>
          </div>
        </div>

        {/* Recent picks */}
        {stats.recent.length > 0 && (
          <div className="glass rounded-xl overflow-hidden border border-slate/20">
            <div className="px-4 py-3 border-b border-slate/20 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-electric" />
              <h2 className="text-sm font-bold text-silver">
                Recent Graded Picks
              </h2>
            </div>
            <div className="divide-y divide-slate/10 max-h-96 overflow-y-auto">
              {stats.recent.slice(0, 30).map((p, i) => {
                const won = p.result === "win";
                const lost = p.result === "loss";
                const pending = !p.result || p.result === "pending";
                return (
                  <div
                    key={i}
                    className="px-4 py-2.5 flex items-center gap-3 text-sm"
                  >
                    {won && (
                      <CheckCircle className="w-4 h-4 text-neon flex-shrink-0" />
                    )}
                    {lost && (
                      <XCircle className="w-4 h-4 text-danger flex-shrink-0" />
                    )}
                    {pending && (
                      <span className="w-4 h-4 rounded-full bg-mercury/20 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-silver truncate">{p.playerName}</p>
                      <p className="text-[10px] text-mercury/50">
                        {p.side?.toUpperCase()} {p.line} {p.propType} • {p.date}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-mercury/60 font-mono">
                        {p.actualValue !== undefined
                          ? `actual ${p.actualValue}`
                          : "pending"}
                      </p>
                      <p
                        className={`text-[9px] uppercase tracking-wider ${won ? "text-neon" : lost ? "text-danger" : "text-mercury/50"}`}
                      >
                        {p.result ?? "pending"}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* CTA */}
        <div className="glass rounded-xl p-6 text-center border-2 border-gold/30 bg-gradient-to-br from-gold/5 to-electric/5">
          <Crown className="w-8 h-8 text-gold mx-auto mb-3" />
          <h2 className="text-2xl font-bold text-silver mb-2">
            Ready to bet smarter?
          </h2>
          <p className="text-sm text-mercury mb-5 max-w-md mx-auto">
            Get every pick, every day. Brain projections, parlay builder, live
            arb alerts, Discord recap.{" "}
            <span className="text-gold font-semibold">7-day free trial.</span>
          </p>
          <Link
            href="/pricing"
            className="group inline-flex items-center justify-center gap-2 min-h-[52px] px-8 rounded-xl bg-gradient-to-r from-gold via-yellow-400 to-gold text-bunker font-bold shadow-lg shadow-gold/30 hover:shadow-gold/50 hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            Start Free Trial
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </Link>
          <p className="text-[10px] text-mercury/50 mt-3">
            $15/mo after trial · Cancel anytime
          </p>
        </div>
      </div>

      <EmailCaptureModal delayMs={20000} source="track-record" />
      {/* SEO: JSON-LD structured data — picked up by Google for rich snippets */}
      <StructuredData />
    </div>
  );
}
