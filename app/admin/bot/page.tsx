"use client";

import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/supabase/auth";
import { useStore } from "@/lib/store";
import { useSport } from "@/lib/sport-context";
import { Shield, ArrowLeft, RefreshCw, Bot } from "lucide-react";
import Link from "next/link";

// Same lazy-load treatment these had on the dashboard — the bot bundle is
// heavy and there's no reason to pull it in before the auth check passes.
const BotChallenge = lazy(() => import("@/components/dashboard/BotChallenge"));
const ThreeModelBot = lazy(
  () => import("@/components/dashboard/ThreeModelBot"),
);
const BrainViz = lazy(() => import("@/components/dashboard/BrainViz"));
const ModelLogs = lazy(() => import("@/components/dashboard/ModelLogs"));
const GhostBots = lazy(() => import("@/components/dashboard/GhostBots"));
const EdgeScanner = lazy(() => import("@/components/dashboard/EdgeScanner"));

function PanelSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-24 rounded-xl bg-[#0a0e17] border border-[#232a3d]/50" />
      <div className="h-40 rounded-xl bg-[#0a0e17] border border-[#232a3d]/50" />
    </div>
  );
}

export default function AdminBotPage() {
  const { isAdmin, loading: authLoading } = useAuth();
  const { currentSport, config } = useSport();
  const { setScores, setOddsData } = useStore();
  const [loading, setLoading] = useState(false);

  // BotChallenge/GhostBots read `scores` + `oddsData` off the global store and
  // the dashboard was the thing filling them. Standalone they'd sit empty and
  // the auto-settle/learn pass would silently no-op, so this page does the
  // same fetch the dashboard does.
  const loadFeeds = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    const isNBA = currentSport === "nba";
    try {
      const [scoresRes, oddsRes] = await Promise.all([
        fetch(isNBA ? "/api/nba-scores" : "/api/scores")
          .then((r) => r.json())
          .catch(() => ({ games: [] })),
        fetch(`/api/odds?sport=${config.oddsApiKey}`)
          .then((r) => r.json())
          .catch(() => ({ games: [] })),
      ]);
      setOddsData(oddsRes.games ?? []);
      // Scores last: BotChallenge's settle-and-learn effect keys off `scores`,
      // so odds should already be in place when it fires.
      setScores(scoresRes.games ?? []);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, currentSport, config.oddsApiKey, setScores, setOddsData]);

  useEffect(() => {
    loadFeeds();
  }, [loadFeeds]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#05070d] flex items-center justify-center">
        <RefreshCw className="w-6 h-6 text-[#8e9ab5] animate-spin" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[#05070d] flex items-center justify-center text-center px-4">
        <div>
          <Shield className="w-10 h-10 text-[#ff5c7a]/30 mx-auto mb-3" />
          <p className="text-sm text-[#ff5c7a] font-semibold">Access Denied</p>
          <p className="text-xs text-[#8e9ab5] mt-1">
            Admin privileges required
          </p>
          <Link href="/" className="text-xs text-[#4cc9ff] mt-3 inline-block">
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#05070d] text-[#e6eaf4]">
      <div className="max-w-3xl mx-auto px-4 pt-6 pb-16">
        <div className="flex items-center gap-3 mb-6">
          <Link
            href="/admin"
            className="p-2 rounded-lg hover:bg-[#121727] transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-[#8e9ab5]" />
          </Link>
          <Bot className="w-7 h-7 text-[#a855f7]" />
          <div>
            <h1 className="text-xl font-bold text-white">Bot Challenge</h1>
            <p className="text-xs text-[#8e9ab5] font-mono">
              INTERNAL — PAPER TRADING SIMULATION
            </p>
          </div>
          <button
            onClick={loadFeeds}
            className="ml-auto p-2 rounded-lg hover:bg-[#121727] transition-colors"
          >
            <RefreshCw
              className={`w-4 h-4 text-[#8e9ab5] ${loading ? "animate-spin" : ""}`}
            />
          </button>
        </div>

        <p className="text-[11px] text-[#8e9ab5] mb-5 leading-snug">
          Not public. This is a simulated $5,000 bankroll, not a real track
          record — the sample is thin and mixes backtest with live results.
        </p>

        <div className="space-y-4">
          <Suspense fallback={<PanelSkeleton />}>
            {/* First panel on purpose: the only +EV source here that doesn't
                depend on the in-house model being right. */}
            {currentSport === "mlb" && <EdgeScanner />}
            <BotChallenge />
            {currentSport === "mlb" && (
              <>
                <ThreeModelBot />
                <BrainViz />
                <GhostBots />
                <ModelLogs />
              </>
            )}
          </Suspense>
        </div>
      </div>
    </div>
  );
}
