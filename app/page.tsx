"use client";

import { useEffect, useState, useCallback } from "react";
import { useStore } from "@/lib/store";
import LiveTicker from "@/components/dashboard/LiveTicker";
import GameCard from "@/components/dashboard/GameCard";
import OddsGrid from "@/components/dashboard/OddsGrid";
import QuantVerdict from "@/components/dashboard/QuantVerdict";
import ArbitrageAlert from "@/components/dashboard/ArbitrageAlert";
import ParlayBuilder from "@/components/dashboard/ParlayBuilder";
import PlayerProps from "@/components/dashboard/PlayerProps";
import BankrollTracker from "@/components/dashboard/BankrollTracker";
import EVBoard from "@/components/dashboard/EVBoard";
import LineMovement from "@/components/dashboard/LineMovement";
import {
  Diamond, BarChart3, Layers, User, Wallet, Users, RefreshCw,
  Radio, ChevronLeft, ChevronRight, X,
} from "lucide-react";

export default function WarRoom() {
  const {
    selectedGameId, activeTab, setActiveTab, sidebarOpen, toggleSidebar,
    games, oddsData, scores, isLoading,
    setGames, setOddsData, setScores, setLoading, lastUpdate,
  } = useStore();

  const [refreshing, setRefreshing] = useState(false);
  const [mobileGamesOpen, setMobileGamesOpen] = useState(false);

  const fetchData = useCallback(async () => {
    setRefreshing(true);
    try {
      const [scoresRes, oddsRes] = await Promise.all([
        fetch("/api/scores").then((r) => r.json()).catch(() => ({ games: [] })),
        fetch("/api/odds").then((r) => r.json()).catch(() => ({ games: [] })),
      ]);

      setScores(scoresRes.games ?? []);
      setOddsData(oddsRes.games ?? []);

      const merged = (scoresRes.games ?? []).map((score: any) => {
        const odds = (oddsRes.games ?? []).find(
          (o: any) => o.homeTeam === score.homeTeam || o.homeTeam?.includes(score.homeAbbrev)
        );
        return { ...score, odds };
      });
      setGames(merged);
    } catch (e) {
      console.error("Fetch error:", e);
    }
    setLoading(false);
    setRefreshing(false);
  }, [setScores, setOddsData, setGames, setLoading]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const selectedOdds = oddsData.find((g: any) => g.id === selectedGameId);

  const buildVerdict = () => {
    if (!selectedOdds?.evBets?.length) return null;
    const best = selectedOdds.evBets[0];
    return {
      winProb: best.fairProb / 100,
      evPercentage: best.evPercentage,
      kellyStake: best.kellyStake,
      confidence: best.confidence,
      pick: best.pick,
      fairOdds: best.fairOdds,
      marketOdds: best.odds,
      reasoning: best.reasoning?.length > 0
        ? best.reasoning
        : [
          "Market odds are mispriced relative to model fair value",
          `Best available line at ${best.bookmaker}`,
          `${best.evPercentage.toFixed(1)}% edge — quarter-Kelly sizing applied`,
        ],
      bookmaker: best.bookmaker,
    };
  };

  const allArbs = oddsData.flatMap((g: any) => g.arbitrage ?? []);

  const tabs = [
    { key: "dashboard" as const, icon: BarChart3, label: "Board" },
    { key: "parlays" as const, icon: Layers, label: "Parlays" },
    { key: "props" as const, icon: User, label: "Props" },
    { key: "bankroll" as const, icon: Wallet, label: "Bank" },
    { key: "room" as const, icon: Users, label: "Room" },
  ];

  const renderGameCards = () => (
    <div className="space-y-2">
      {scores.length === 0 ? (
        <div className="glass rounded-xl p-6 text-center">
          <p className="text-sm text-mercury">No games scheduled today</p>
        </div>
      ) : (
        scores.map((game: any) => {
          const odds = oddsData.find(
            (o: any) => o.homeTeam?.includes(game.homeAbbrev) || o.homeTeam === game.homeTeam
          );
          return (
            <GameCard
              key={game.id}
              game={game}
              oddsInfo={{
                bestHomeML: odds?.bestLines?.bestHomeML,
                bestAwayML: odds?.bestLines?.bestAwayML,
                arbCount: odds?.arbitrage?.length ?? 0,
                topEV: odds?.evBets?.[0]?.evPercentage ?? 0,
              }}
            />
          );
        })
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-void bg-grid">
      {/* Live Ticker */}
      <LiveTicker />

      {/* Header */}
      <header className="border-b border-slate/30 bg-bunker/80 backdrop-blur-lg sticky top-0 z-40">
        <div className="max-w-[1800px] mx-auto px-3 sm:px-4 py-2.5 sm:py-3 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-gradient-to-br from-neon/20 to-electric/20 flex items-center justify-center border border-neon/20 flex-shrink-0">
              <Diamond className="w-4 h-4 sm:w-5 sm:h-5 text-neon" />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-silver tracking-tight leading-tight">
                DQ <span className="text-neon hidden sm:inline">Live</span><span className="text-neon sm:hidden">L</span>
              </h1>
              <p className="text-[9px] sm:text-[10px] text-mercury/60 -mt-0.5 font-mono hidden sm:block">MLB BETTING INTELLIGENCE</p>
            </div>
          </div>

          {/* Desktop Nav Tabs */}
          <nav className="hidden md:flex items-center gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === tab.key
                    ? "bg-neon/10 text-neon border border-neon/20"
                    : "text-mercury hover:text-silver hover:bg-gunmetal/50"
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </nav>

          {/* Status */}
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={fetchData}
              disabled={refreshing}
              className="p-1.5 sm:p-2 rounded-lg hover:bg-gunmetal/50 transition-colors"
              title="Refresh data"
            >
              <RefreshCw className={`w-4 h-4 text-mercury ${refreshing ? "animate-spin" : ""}`} />
            </button>
            <div className="hidden sm:flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <Radio className="w-3 h-3 text-neon" />
                <span className="text-[10px] text-mercury font-mono">
                  {lastUpdate ? `Updated ${new Date(lastUpdate).toLocaleTimeString()}` : "Connecting..."}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile Bottom Nav — tabs */}
        <div className="md:hidden flex items-center gap-0.5 px-2 pb-2 overflow-x-auto scrollbar-hide">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium whitespace-nowrap transition-all flex-shrink-0 ${
                activeTab === tab.key
                  ? "bg-neon/10 text-neon border border-neon/20"
                  : "text-mercury hover:bg-gunmetal/50"
              }`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {/* Mobile Games Sheet (slide-over) */}
      {mobileGamesOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileGamesOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[85vw] max-w-sm bg-bunker border-r border-slate/30 overflow-y-auto animate-slide-up">
            <div className="sticky top-0 bg-bunker/95 backdrop-blur-lg px-4 py-3 border-b border-slate/30 flex items-center justify-between z-10">
              <h2 className="text-sm font-semibold text-silver uppercase tracking-wider">
                Today's Games ({scores.length})
              </h2>
              <button onClick={() => setMobileGamesOpen(false)} className="p-1.5 hover:bg-gunmetal/50 rounded-lg">
                <X className="w-5 h-5 text-mercury" />
              </button>
            </div>
            <div className="p-3">
              {renderGameCards()}
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-[1800px] mx-auto px-2 sm:px-4 py-3 sm:py-4">
        {isLoading ? (
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="text-center">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full border-2 border-neon/20 border-t-neon animate-spin mx-auto mb-4" />
              <p className="text-sm text-mercury">Loading live data...</p>
              <p className="text-xs text-mercury/50 mt-1 font-mono">Connecting to MLB + sportsbook feeds</p>
            </div>
          </div>
        ) : (
          <>
            {/* Dashboard Tab */}
            {activeTab === "dashboard" && (
              <>
                {/* Mobile: "View Games" button */}
                <button
                  onClick={() => setMobileGamesOpen(true)}
                  className="lg:hidden w-full mb-3 flex items-center justify-center gap-2 py-2.5 rounded-xl glass glass-hover text-sm font-medium text-mercury"
                >
                  <BarChart3 className="w-4 h-4" />
                  View Today's Games ({scores.length})
                  <ChevronRight className="w-4 h-4" />
                </button>

                <div className="flex gap-4">
                  {/* Left Sidebar — Desktop only */}
                  <div className={`hidden lg:block transition-all duration-300 ${sidebarOpen ? "w-80" : "w-12"} flex-shrink-0`}>
                    <div className="sticky top-24">
                      <div className="flex items-center justify-between mb-3">
                        {sidebarOpen && (
                          <h2 className="text-xs font-semibold text-mercury uppercase tracking-wider">
                            Today's Games ({scores.length})
                          </h2>
                        )}
                        <button onClick={toggleSidebar} className="p-1 hover:bg-gunmetal/50 rounded">
                          {sidebarOpen ? <ChevronLeft className="w-4 h-4 text-mercury" /> : <ChevronRight className="w-4 h-4 text-mercury" />}
                        </button>
                      </div>
                      {sidebarOpen && (
                        <div className="max-h-[calc(100vh-180px)] overflow-y-auto pr-1">
                          {renderGameCards()}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Center — Main Panel */}
                  <div className="flex-1 min-w-0 space-y-3 sm:space-y-4">
                    {allArbs.length > 0 && <ArbitrageAlert arbitrage={allArbs} />}

                    <QuantVerdict
                      game={{
                        homeTeam: selectedOdds?.homeTeam ?? "Select a game",
                        awayTeam: selectedOdds?.awayTeam ?? "",
                      }}
                      analysis={buildVerdict()}
                    />

                    {selectedGameId && <OddsGrid gameId={selectedGameId} />}

                    <EVBoard />

                    {/* Mobile: show parlay builder inline below EV board */}
                    <div className="xl:hidden">
                      <ParlayBuilder />
                    </div>
                  </div>

                  {/* Right Sidebar — Desktop XL only */}
                  <div className="hidden xl:block w-80 flex-shrink-0 space-y-4">
                    <div className="sticky top-24 space-y-4">
                      <ParlayBuilder />
                      <LineMovement movements={[]} />
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Parlays Tab */}
            {activeTab === "parlays" && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 max-w-5xl mx-auto">
                <ParlayBuilder />
                <div className="space-y-3 sm:space-y-4">
                  <EVBoard />
                  <LineMovement movements={[]} />
                </div>
              </div>
            )}

            {/* Props Tab */}
            {activeTab === "props" && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4 max-w-6xl mx-auto">
                <div className="lg:col-span-2">
                  <PlayerProps />
                </div>
                <div>
                  <ParlayBuilder />
                </div>
              </div>
            )}

            {/* Bankroll Tab */}
            {activeTab === "bankroll" && (
              <div className="max-w-2xl mx-auto">
                <BankrollTracker />
              </div>
            )}

            {/* War Room Tab */}
            {activeTab === "room" && (
              <div className="max-w-4xl mx-auto">
                <div className="glass rounded-xl p-5 sm:p-8 text-center">
                  <Users className="w-10 h-10 sm:w-12 sm:h-12 text-electric/30 mx-auto mb-3 sm:mb-4" />
                  <h2 className="text-lg sm:text-xl font-bold text-silver mb-2">War Room</h2>
                  <p className="text-sm text-mercury mb-5 sm:mb-6 max-w-md mx-auto">
                    Share a room with your crew. Everyone sees the same live data,
                    odds, and alerts instantly.
                  </p>
                  <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                    <button className="w-full sm:w-auto px-6 py-2.5 bg-neon/15 text-neon border border-neon/30 rounded-lg font-semibold text-sm hover:bg-neon/25 transition-colors">
                      Create Room
                    </button>
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <input
                        type="text"
                        placeholder="Room code..."
                        className="flex-1 sm:flex-none px-4 py-2.5 bg-gunmetal/50 border border-slate/30 rounded-lg text-sm text-silver focus:outline-none focus:border-electric/30 sm:w-40 font-mono"
                      />
                      <button className="px-4 py-2.5 bg-electric/15 text-electric border border-electric/30 rounded-lg font-semibold text-sm hover:bg-electric/25 transition-colors flex-shrink-0">
                        Join
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-mercury/50 mt-4">
                    Powered by Supabase Realtime
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate/20 mt-6 sm:mt-8 py-3 sm:py-4 text-center px-4">
        <p className="text-[10px] sm:text-xs text-mercury/40 font-mono">
          Diamond-Quant Live v1.0 — Odds via The Odds API. Stats via MLB Stats API.
        </p>
        <p className="text-[9px] sm:text-[10px] text-mercury/30 mt-1">
          For entertainment & educational purposes. Gamble responsibly.
        </p>
      </footer>
    </div>
  );
}
