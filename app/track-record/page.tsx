import { Metadata } from "next";
import Link from "next/link";
import { cloudGet } from "@/lib/supabase/client";
import { Trophy, TrendingUp, Crown, Sparkles, ArrowRight, CheckCircle, XCircle, Brain, DollarSign } from "lucide-react";
import ProfitChart from "@/components/ProfitChart";
import EmailCaptureModal from "@/components/EmailCaptureModal";

export const dynamic = "force-dynamic";
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Diamond Quant — Live Track Record",
  description: "Watch our AI-powered NBA prop bot bet in real-time. 4,041 games trained, 54.1% backtested win rate. Free 7-day trial.",
  openGraph: {
    title: "Diamond Quant — Live Track Record",
    description: "AI sports betting that learns. Self-evolving NBA prop brain hits 54%+ on backtests.",
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

async function getStats() {
  const history = (await cloudGet<PropPick[]>("prop_pick_history_nba", [])) ?? [];
  const graded = history.filter(p => p.result === "win" || p.result === "loss");
  const wins = graded.filter(p => p.result === "win").length;
  const losses = graded.filter(p => p.result === "loss").length;
  const winRate = graded.length > 0 ? (wins / graded.length) * 100 : 0;

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
    .map(([date, stats]) => ({ date, ...stats, total: stats.wins + stats.losses }));

  // Recent picks (last 30)
  const recent = history.slice(0, 30);

  return { wins, losses, winRate, totalGraded: graded.length, daily, recent };
}

async function getBrain() {
  const brain = await cloudGet<any>("nba_prop_brain", null);
  return brain ? {
    games: brain.totalGamesProcessed ?? 0,
    predictions: brain.totalPredictions ?? 0,
    players: Object.keys(brain.playerMemory ?? {}).length,
    version: brain.version ?? "1.0.0",
  } : null;
}

export default async function TrackRecordPage() {
  const [stats, brain] = await Promise.all([getStats(), getBrain()]);

  return (
    <div className="min-h-screen bg-bunker">
      {/* Hero */}
      <div className="relative overflow-hidden border-b border-slate/30">
        <div className="absolute inset-0 bg-gradient-to-br from-gold/5 via-electric/5 to-purple/10" />
        <div className="relative max-w-4xl mx-auto px-4 py-12 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-neon/10 border border-neon/30 mb-4">
            <span className="w-2 h-2 rounded-full bg-neon animate-pulse" />
            <span className="text-[10px] uppercase tracking-wider text-neon font-bold">Live Track Record</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-silver mb-3">
            AI Sports Betting<br />
            <span className="bg-gradient-to-r from-gold via-electric to-purple bg-clip-text text-transparent">
              That Actually Learns
            </span>
          </h1>
          <p className="text-base text-mercury max-w-2xl mx-auto mb-8">
            Self-evolving NBA prop brain. Trained on {brain?.games?.toLocaleString() ?? "4,000+"} games.
            Auto-grades every pick against real box scores.
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
          <p className="text-[11px] text-mercury/50 mt-4">No credit card surprises · cancel anytime</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="glass rounded-xl p-4 text-center border border-neon/20">
            <Trophy className="w-5 h-5 text-neon mx-auto mb-2" />
            <p className={`text-3xl font-bold font-mono ${stats.winRate >= 55 ? "text-neon" : stats.winRate >= 50 ? "text-electric" : "text-amber"}`}>
              {stats.totalGraded > 0 ? `${stats.winRate.toFixed(1)}%` : "—"}
            </p>
            <p className="text-[10px] text-mercury/60 uppercase mt-1">Win Rate</p>
          </div>
          <div className="glass rounded-xl p-4 text-center border border-electric/20">
            <CheckCircle className="w-5 h-5 text-electric mx-auto mb-2" />
            <p className="text-3xl font-bold font-mono text-silver">
              {stats.wins}<span className="text-mercury/40">-</span>{stats.losses}
            </p>
            <p className="text-[10px] text-mercury/60 uppercase mt-1">Record</p>
          </div>
          <div className="glass rounded-xl p-4 text-center border border-purple/20">
            <Brain className="w-5 h-5 text-purple mx-auto mb-2" />
            <p className="text-3xl font-bold font-mono text-silver">
              {brain?.games?.toLocaleString() ?? "0"}
            </p>
            <p className="text-[10px] text-mercury/60 uppercase mt-1">Games Trained</p>
          </div>
          <div className="glass rounded-xl p-4 text-center border border-gold/20">
            <Sparkles className="w-5 h-5 text-gold mx-auto mb-2" />
            <p className="text-3xl font-bold font-mono text-silver">
              {brain?.players?.toLocaleString() ?? "0"}
            </p>
            <p className="text-[10px] text-mercury/60 uppercase mt-1">Players Tracked</p>
          </div>
        </div>

        {/* Live profit backtest chart — the conversion killer */}
        <div className="glass rounded-xl p-6 border-2 border-neon/20 bg-gradient-to-br from-neon/3 to-transparent">
          <h2 className="text-lg font-bold text-silver mb-1 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-neon" /> If you'd followed every brain pick
          </h2>
          <p className="text-xs text-mercury/60 mb-4">
            Real cumulative profit at $100/bet, -110 odds, every graded NBA prop the brain has surfaced.
          </p>
          <ProfitChart sport="nba" />
        </div>

        {/* How it works */}
        <div className="glass rounded-xl p-6 border border-slate/20">
          <h2 className="text-lg font-bold text-silver mb-4 flex items-center gap-2">
            <Brain className="w-5 h-5 text-purple" /> How It Works
          </h2>
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <div className="w-8 h-8 rounded-full bg-electric/10 border border-electric/30 flex items-center justify-center text-electric font-bold text-sm mb-2">1</div>
              <h3 className="text-sm font-semibold text-silver mb-1">Brain Trains Nightly</h3>
              <p className="text-xs text-mercury/70">Every night the brain re-trains on the last 3 NBA seasons. Daily auto-evolution finds the best weight configuration via tournament selection.</p>
            </div>
            <div>
              <div className="w-8 h-8 rounded-full bg-purple/10 border border-purple/30 flex items-center justify-center text-purple font-bold text-sm mb-2">2</div>
              <h3 className="text-sm font-semibold text-silver mb-1">Picks Hit Every Slate</h3>
              <p className="text-xs text-mercury/70">Pulls live odds from 10+ books, runs every player through the projector, surfaces only edges with positive expected value.</p>
            </div>
            <div>
              <div className="w-8 h-8 rounded-full bg-gold/10 border border-gold/30 flex items-center justify-center text-gold font-bold text-sm mb-2">3</div>
              <h3 className="text-sm font-semibold text-silver mb-1">Auto-Graded & Public</h3>
              <p className="text-xs text-mercury/70">After games end, every pick is graded against real ESPN box scores. Wins, losses, all transparent. Brain learns from each result.</p>
            </div>
          </div>
        </div>

        {/* Recent picks */}
        {stats.recent.length > 0 && (
          <div className="glass rounded-xl overflow-hidden border border-slate/20">
            <div className="px-4 py-3 border-b border-slate/20 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-electric" />
              <h2 className="text-sm font-bold text-silver">Recent Graded Picks</h2>
            </div>
            <div className="divide-y divide-slate/10 max-h-96 overflow-y-auto">
              {stats.recent.slice(0, 30).map((p, i) => {
                const won = p.result === "win";
                const lost = p.result === "loss";
                const pending = !p.result || p.result === "pending";
                return (
                  <div key={i} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                    {won && <CheckCircle className="w-4 h-4 text-neon flex-shrink-0" />}
                    {lost && <XCircle className="w-4 h-4 text-danger flex-shrink-0" />}
                    {pending && <span className="w-4 h-4 rounded-full bg-mercury/20 flex-shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-silver truncate">{p.playerName}</p>
                      <p className="text-[10px] text-mercury/50">
                        {p.side?.toUpperCase()} {p.line} {p.propType} • {p.date}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-mercury/60 font-mono">
                        {p.actualValue !== undefined ? `actual ${p.actualValue}` : "pending"}
                      </p>
                      <p className={`text-[9px] uppercase tracking-wider ${won ? "text-neon" : lost ? "text-danger" : "text-mercury/50"}`}>
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
          <h2 className="text-2xl font-bold text-silver mb-2">Ready to bet smarter?</h2>
          <p className="text-sm text-mercury mb-5 max-w-md mx-auto">
            Get every pick, every day. Brain projections, parlay builder, live arb alerts, Discord recap. <span className="text-gold font-semibold">7-day free trial.</span>
          </p>
          <Link
            href="/pricing"
            className="group inline-flex items-center justify-center gap-2 min-h-[52px] px-8 rounded-xl bg-gradient-to-r from-gold via-yellow-400 to-gold text-bunker font-bold shadow-lg shadow-gold/30 hover:shadow-gold/50 hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            Start Free Trial
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </Link>
          <p className="text-[10px] text-mercury/50 mt-3">$15/mo after trial · Cancel anytime</p>
        </div>
      </div>

      <EmailCaptureModal delayMs={20000} source="track-record" />
    </div>
  );
}
