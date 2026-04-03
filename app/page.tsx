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
import SelectedGameBanner from "@/components/dashboard/SelectedGameBanner";
import BetSlip from "@/components/dashboard/BetSlip";
import PicksBoard from "@/components/dashboard/PicksBoard";
import { matchGames } from "@/lib/mlb/match-games";
import { backupOddsToStorage, getOddsBackup } from "@/lib/odds/cache";
import {
  Diamond, BarChart3, Layers, User, Wallet, Users, RefreshCw,
  Radio, ChevronLeft, ChevronRight, X, HelpCircle, Volume2, VolumeX, AlertTriangle,
} from "lucide-react";

// Arb alert sound (short beep)
function playAlertSound() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = "sine";
    gain.gain.value = 0.15;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.stop(ctx.currentTime + 0.3);
  } catch {}
}

export default function WarRoom() {
  const {
    selectedGameId, activeTab, setActiveTab, sidebarOpen, toggleSidebar,
    games, oddsData, scores, isLoading,
    setGames, setOddsData, setScores, setLoading, lastUpdate,
    selectGame, snapshotOdds, getLineMovements, hydrate,
  } = useStore();

  const [refreshing, setRefreshing] = useState(false);
  const [mobileGamesOpen, setMobileGamesOpen] = useState(false);
  const [betSlipOpen, setBetSlipOpen] = useState(false);
  const [betSlipPrefill, setBetSlipPrefill] = useState<any>(null);
  const [analyses, setAnalyses] = useState<any[]>([]);
  const [showHelp, setShowHelp] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [arbFlash, setArbFlash] = useState(false);
  const [prevArbCount, setPrevArbCount] = useState(0);
  const [isDemo, setIsDemo] = useState(false);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const fetchData = useCallback(async () => {
    setRefreshing(true);
    try {
      const [scoresRes, oddsRes, analysisRes] = await Promise.all([
        fetch("/api/scores").then((r) => r.json()).catch(() => ({ games: [] })),
        fetch("/api/odds").then((r) => r.json()).catch(() => ({ games: [], demo: true })),
        fetch("/api/analysis").then((r) => r.json()).catch(() => ({ analyses: [] })),
      ]);

      const scoreGames = scoresRes.games ?? [];
      let oddsGames = oddsRes.games ?? [];
      setIsDemo(oddsRes.demo === true);

      // If odds API failed, try backup
      if (oddsGames.length === 0) {
        const backup = getOddsBackup();
        if (backup && backup.age < 30) {
          oddsGames = backup.data;
          setIsDemo(true);
        }
      } else {
        backupOddsToStorage(oddsGames);
      }

      setScores(scoreGames);
      setOddsData(oddsGames);
      setAnalyses(analysisRes.analyses ?? []);
      snapshotOdds(oddsGames);

      // Robust game matching
      const matchMap = matchGames(scoreGames, oddsGames);
      const merged = scoreGames.map((score: any) => {
        const odds = matchMap.get(score.homeTeam);
        return { ...score, odds };
      });
      setGames(merged);

      // Auto-select first live game (or first upcoming) if nothing selected
      if (!selectedGameId && scoreGames.length > 0) {
        const liveGame = scoreGames.find((g: any) => g.status === "live");
        const upcoming = scoreGames.find((g: any) => g.status === "pre");
        const pick = liveGame ?? upcoming ?? scoreGames[0];
        if (pick) selectGame(pick.id);
      }
    } catch (e) {
      console.error("Fetch error:", e);
    }
    setLoading(false);
    setRefreshing(false);
  }, [setScores, setOddsData, setGames, setLoading, snapshotOdds, selectedGameId, selectGame]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Arb alert: flash + sound when new arbs appear
  const currentArbCount = oddsData.reduce((sum: number, g: any) => sum + (g.arbitrage?.length ?? 0), 0);
  useEffect(() => {
    if (currentArbCount > prevArbCount && prevArbCount > 0) {
      setArbFlash(true);
      if (soundEnabled) playAlertSound();
      setTimeout(() => setArbFlash(false), 3000);
    }
    setPrevArbCount(currentArbCount);
  }, [currentArbCount, prevArbCount, soundEnabled]);

  const selectedOdds = oddsData.find((g: any) => g.id === selectedGameId);
  const selectedScore = scores.find((s: any) => s.id === selectedGameId);
  const selectedAnalysis = analyses.find((a: any) =>
    selectedScore && (a.homeTeam === selectedScore.homeTeam || a.homeAbbrev === selectedScore.homeAbbrev)
  );

  // Build quant verdict using real analysis data when available
  const buildVerdict = () => {
    if (!selectedOdds?.evBets?.length) return null;
    const best = selectedOdds.evBets[0];

    // Use engine analysis if available
    const engineProb = selectedAnalysis?.homeWinProb
      ? (best.pick.includes(selectedOdds.homeTeam) ? selectedAnalysis.homeWinProb / 100 : selectedAnalysis.awayWinProb / 100)
      : best.fairProb / 100;

    const engineReasoning = selectedAnalysis?.reasoning?.length > 0
      ? selectedAnalysis.reasoning
      : [];

    const defaultReasoning = [
      "Market odds are mispriced relative to model fair value",
      `Best available line at ${best.bookmaker}`,
      `${best.evPercentage.toFixed(1)}% edge — quarter-Kelly sizing applied`,
    ];

    return {
      winProb: engineProb,
      evPercentage: best.evPercentage,
      kellyStake: best.kellyStake,
      confidence: best.confidence,
      pick: best.pick,
      fairOdds: best.fairOdds,
      marketOdds: best.odds,
      reasoning: [...engineReasoning, ...defaultReasoning].slice(0, 5),
      bookmaker: best.bookmaker,
    };
  };

  const allArbs = oddsData.flatMap((g: any) => g.arbitrage ?? []);

  // Get line movements for selected game
  const lineMovements = selectedGameId ? getLineMovements(selectedGameId) : [];

  const openBetSlip = (prefill?: any) => {
    setBetSlipPrefill(prefill ?? null);
    setBetSlipOpen(true);
  };

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
      <LiveTicker />

      {/* Header */}
      <header className="border-b border-slate/30 bg-bunker/80 backdrop-blur-lg sticky top-0 z-40">
        <div className="max-w-[1800px] mx-auto px-3 sm:px-4 py-2.5 sm:py-3 flex items-center justify-between">
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

          <div className="flex items-center gap-1.5 sm:gap-2">
            {isDemo && (
              <span className="hidden sm:flex items-center gap-1 px-2 py-1 rounded bg-amber/10 border border-amber/20 text-[10px] text-amber font-semibold">
                <AlertTriangle className="w-3 h-3" /> DEMO
              </span>
            )}
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="p-1.5 sm:p-2 rounded-lg hover:bg-gunmetal/50 transition-colors"
              title={soundEnabled ? "Mute alerts" : "Enable alert sounds"}
            >
              {soundEnabled ? (
                <Volume2 className="w-4 h-4 text-neon" />
              ) : (
                <VolumeX className="w-4 h-4 text-mercury/50" />
              )}
            </button>
            <button
              onClick={() => setShowHelp(!showHelp)}
              className="p-1.5 sm:p-2 rounded-lg hover:bg-gunmetal/50 transition-colors"
              title="What do these terms mean?"
            >
              <HelpCircle className="w-4 h-4 text-mercury" />
            </button>
            <button
              onClick={fetchData}
              disabled={refreshing}
              className="p-1.5 sm:p-2 rounded-lg hover:bg-gunmetal/50 transition-colors"
              title="Refresh data"
            >
              <RefreshCw className={`w-4 h-4 text-mercury ${refreshing ? "animate-spin" : ""}`} />
            </button>
            <div className="hidden sm:flex items-center gap-1.5">
              <Radio className="w-3 h-3 text-neon" />
              <span className="text-[10px] text-mercury font-mono">
                {lastUpdate ? `Updated ${new Date(lastUpdate).toLocaleTimeString()}` : "Connecting..."}
              </span>
            </div>
          </div>
        </div>

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

      {/* Help Panel */}
      {showHelp && (
        <div className="max-w-[1800px] mx-auto px-2 sm:px-4 pt-3">
          <div className="glass rounded-xl p-4 sm:p-5 animate-slide-up">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-silver">Quick Guide</h3>
              <button onClick={() => setShowHelp(false)} className="p-1 hover:bg-gunmetal/50 rounded">
                <X className="w-4 h-4 text-mercury" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-gunmetal/30">
                <p className="font-semibold text-neon mb-1">+EV (Positive Expected Value)</p>
                <p className="text-mercury">A bet where the true probability of winning is higher than what the odds imply. Over time, +EV bets make money.</p>
              </div>
              <div className="p-3 rounded-lg bg-gunmetal/30">
                <p className="font-semibold text-gold mb-1">Kelly Stake</p>
                <p className="text-mercury">The mathematically optimal bet size based on your edge and bankroll. We use quarter-Kelly (safer) by default.</p>
              </div>
              <div className="p-3 rounded-lg bg-gunmetal/30">
                <p className="font-semibold text-electric mb-1">Arbitrage (Arb)</p>
                <p className="text-mercury">When odds across different books guarantee profit regardless of outcome. Rare but free money when found.</p>
              </div>
              <div className="p-3 rounded-lg bg-gunmetal/30">
                <p className="font-semibold text-purple mb-1">Fair Odds / Vig</p>
                <p className="text-mercury">Fair odds = what the line should be without the book's cut. The vig (juice) is the book's profit margin built into the odds.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Games Sheet */}
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
            <div className="p-3">{renderGameCards()}</div>
          </div>
        </div>
      )}

      {/* Bet Slip Modal */}
      <BetSlip
        isOpen={betSlipOpen}
        onClose={() => setBetSlipOpen(false)}
        prefill={betSlipPrefill}
      />

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
            {activeTab === "dashboard" && (
              <>
                {/* Mobile: View Games button */}
                <button
                  onClick={() => setMobileGamesOpen(true)}
                  className="lg:hidden w-full mb-3 flex items-center justify-center gap-2 py-2.5 rounded-xl glass glass-hover text-sm font-medium text-mercury"
                >
                  <BarChart3 className="w-4 h-4" />
                  Today's Games ({scores.length})
                  <ChevronRight className="w-4 h-4" />
                </button>

                {/* Arb Alert */}
                {allArbs.length > 0 && (
                  <div className={`mb-3 ${arbFlash ? "animate-flash-gold rounded-xl" : ""}`}>
                    <ArbitrageAlert arbitrage={allArbs} />
                  </div>
                )}

                <div className="flex gap-4">
                  {/* Left Sidebar — Desktop */}
                  <div className={`hidden lg:block transition-all duration-300 ${sidebarOpen ? "w-72" : "w-12"} flex-shrink-0`}>
                    <div className="sticky top-24">
                      <div className="flex items-center justify-between mb-3">
                        {sidebarOpen && (
                          <h2 className="text-xs font-semibold text-mercury uppercase tracking-wider">
                            Games ({scores.length})
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

                  {/* Center — Main Picks Board */}
                  <div className="flex-1 min-w-0 space-y-3 sm:space-y-4">
                    <PicksBoard />

                    {/* Game deep-dive (when a game is selected) */}
                    {selectedGameId && selectedScore && (
                      <>
                        <SelectedGameBanner game={selectedScore} onDeselect={() => selectGame(null)} />
                        <QuantVerdict
                          game={{
                            homeTeam: selectedOdds?.homeTeam ?? "Select a game",
                            awayTeam: selectedOdds?.awayTeam ?? "",
                          }}
                          analysis={buildVerdict()}
                          onPlaceBet={selectedOdds ? () => {
                            const verdict = buildVerdict();
                            if (verdict) {
                              openBetSlip({
                                game: `${selectedOdds.awayTeam} @ ${selectedOdds.homeTeam}`,
                                pick: verdict.pick,
                                odds: verdict.marketOdds,
                                bookmaker: verdict.bookmaker,
                                market: "moneyline",
                                evAtPlacement: verdict.evPercentage,
                              });
                            }
                          } : undefined}
                        />
                        <OddsGrid gameId={selectedGameId} />
                      </>
                    )}

                    {/* Parlay builder on mobile */}
                    <div className="xl:hidden">
                      <ParlayBuilder />
                    </div>
                  </div>

                  {/* Right Sidebar — XL */}
                  <div className="hidden xl:block w-80 flex-shrink-0 space-y-4">
                    <div className="sticky top-24 space-y-4">
                      <ParlayBuilder />
                      <LineMovement movements={lineMovements} />
                    </div>
                  </div>
                </div>
              </>
            )}

            {activeTab === "parlays" && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 max-w-5xl mx-auto">
                <ParlayBuilder />
                <div className="space-y-3 sm:space-y-4">
                  <EVBoard />
                  <LineMovement movements={lineMovements} />
                </div>
              </div>
            )}

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

            {activeTab === "bankroll" && (
              <div className="max-w-2xl mx-auto space-y-4">
                <BankrollTracker />
                <button
                  onClick={() => openBetSlip()}
                  className="w-full py-3 rounded-xl bg-neon/15 text-neon border border-neon/30 font-semibold text-sm hover:bg-neon/25 transition-colors"
                >
                  + Log a Bet
                </button>
              </div>
            )}

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
                  <p className="text-xs text-mercury/50 mt-4">Powered by Supabase Realtime</p>
                </div>
              </div>
            )}
          </>
        )}
      </main>

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
