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
import ModelTracker from "@/components/dashboard/ModelTracker";
import BotChallenge from "@/components/dashboard/BotChallenge";
import ThreeModelBot from "@/components/dashboard/ThreeModelBot";
import ModelLogs from "@/components/dashboard/ModelLogs";
import GhostBots from "@/components/dashboard/GhostBots";
import TrainingPanel from "@/components/dashboard/TrainingPanel";
import TopPropsOfDay from "@/components/dashboard/TopPropsOfDay";
import SnapSync from "@/components/dashboard/SnapSync";
import NRFITab from "@/components/dashboard/NRFITab";
import { matchGames } from "@/lib/mlb/match-games";
import { backupOddsToStorage, getOddsBackup } from "@/lib/odds/cache";
import { sendDiscordAlert } from "@/lib/odds/sportsbooks";
import { getDiscordWebhook, setDiscordWebhook } from "@/lib/store";
import {
  Diamond, BarChart3, Layers, User, Wallet, Users, RefreshCw, Shield,
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

// Browser push notification — safely wrapped for mobile
function sendNotification(title: string, body: string) {
  try {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
      new Notification(title, { body });
    }
  } catch {}
}

function requestNotificationPermission() {
  try {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission();
    }
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
    requestNotificationPermission();
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

      // Auto-select first live or upcoming game — never a final
      if (!selectedGameId && scoreGames.length > 0) {
        const liveGame = scoreGames.find((g: any) => g.status === "live");
        const upcoming = scoreGames.find((g: any) => g.status === "pre");
        const pick = liveGame ?? upcoming;
        if (pick) selectGame(pick.id);
      }
    } catch (e) {
      console.error("Fetch error:", e);
    }
    setLoading(false);
    setRefreshing(false);
  }, [setScores, setOddsData, setGames, setLoading, snapshotOdds, selectedGameId, selectGame]);

  useEffect(() => {
    // Smart polling: dead overnight, fast during games, slow otherwise
    function shouldPoll(): boolean {
      const now = new Date();
      const etHour = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getHours();
      return etHour >= 9 || etHour < 2; // Active 9 AM - 2 AM ET
    }

    fetchData();
    const hasLive = scores.some((s: any) => s.status === "live");
    const interval = setInterval(() => {
      if (shouldPoll()) fetchData();
    }, hasLive ? 90000 : 180000); // 90s during live games, 3 min otherwise
    return () => clearInterval(interval);
  }, [fetchData, scores]);

  // Arb alert: flash + sound when new arbs appear
  const currentArbCount = oddsData.reduce((sum: number, g: any) => sum + (g.arbitrage?.length ?? 0), 0);
  useEffect(() => {
    if (currentArbCount > prevArbCount && prevArbCount > 0) {
      setArbFlash(true);
      if (soundEnabled) playAlertSound();
      sendNotification("Arbitrage Alert", `${currentArbCount - prevArbCount} new arbitrage opportunity found!`);

      // Discord alert
      const webhook = getDiscordWebhook();
      if (webhook) {
        const arbs = oddsData.flatMap((g: any) => g.arbitrage ?? []);
        const newest = arbs[0];
        if (newest) {
          sendDiscordAlert(webhook, {
            title: "GOLDEN ARBITRAGE",
            description: `${newest.game}\n${newest.side1.pick} @ ${newest.side1.bookmaker} vs ${newest.side2.pick} @ ${newest.side2.bookmaker}`,
            color: 0xffd700,
            fields: [
              { name: "Profit", value: `+${newest.profit.toFixed(2)}%`, inline: true },
              { name: "Stakes", value: `$${newest.stake1.toFixed(0)} / $${newest.stake2.toFixed(0)}`, inline: true },
            ],
          });
        }
      }
      setTimeout(() => setArbFlash(false), 3000);
    }

    // High EV Discord alert
    const bigEV = oddsData.flatMap((g: any) => g.evBets ?? []).filter((b: any) => b.evPercentage > 6 && !b.isSuspicious);
    if (bigEV.length > 0 && prevArbCount === 0 && !isLoading) {
      sendNotification("High EV Alert", `${bigEV[0].pick} at ${bigEV[0].bookmaker} — +${bigEV[0].evPercentage.toFixed(1)}% edge`);
      const webhook = getDiscordWebhook();
      if (webhook) {
        sendDiscordAlert(webhook, {
          title: "TOP LOCK ALERT",
          description: `${bigEV[0].pick}\n${bigEV[0].game} @ ${bigEV[0].bookmaker}`,
          color: 0x00ff88,
          fields: [
            { name: "Odds", value: `${bigEV[0].odds > 0 ? "+" : ""}${bigEV[0].odds}`, inline: true },
            { name: "EV Edge", value: `+${bigEV[0].evPercentage.toFixed(1)}%`, inline: true },
          ],
        });
      }
    }
    setPrevArbCount(currentArbCount);
  }, [currentArbCount, prevArbCount, soundEnabled, oddsData, isLoading]);

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
    { key: "nrfi" as const, icon: Shield, label: "NRFI" },
    { key: "bot" as const, icon: Diamond, label: "Bot" },
    { key: "parlays" as const, icon: Layers, label: "Parlays" },
    { key: "props" as const, icon: User, label: "Props" },
    { key: "bankroll" as const, icon: Wallet, label: "Bank" },
    { key: "room" as const, icon: Users, label: "Room" },
  ];

  // Only show live + upcoming games — never finals
  const activeGames = scores.filter((g: any) => g.status !== "final");

  const renderGameCards = () => (
    <div className="space-y-2">
      {activeGames.length === 0 ? (
        <div className="glass rounded-xl p-6 text-center">
          <p className="text-sm text-mercury">No live or upcoming games right now</p>
        </div>
      ) : (
        activeGames.map((game: any) => {
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
            {isDemo && oddsData.length === 0 && (
              <span className="hidden sm:flex items-center gap-1 px-2 py-1 rounded bg-amber/10 border border-amber/20 text-[10px] text-amber font-semibold">
                <AlertTriangle className="w-3 h-3" /> NO ODDS
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
                Games ({activeGames.length})
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
                  Games ({activeGames.length})
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
                    {/* Model accuracy at the top */}
                    <ModelTracker />

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
              <div className="max-w-6xl mx-auto space-y-4">
                {/* Top 5 AI Picks — always visible at top */}
                <TopPropsOfDay />

                {/* Search + browse props below */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
                  <div className="lg:col-span-2">
                    <PlayerProps />
                  </div>
                  <div>
                    <ParlayBuilder />
                  </div>
                </div>
              </div>
            )}

            {activeTab === "nrfi" && <NRFITab />}

            {activeTab === "bot" && (
              <div className="max-w-3xl mx-auto space-y-4">
                <ThreeModelBot />
                <ModelLogs />
                <BotChallenge />
                <GhostBots />
              </div>
            )}

            {activeTab === "bankroll" && (
              <div className="max-w-2xl mx-auto space-y-4">
                <SnapSync />
                <ModelTracker />
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
              <div className="max-w-4xl mx-auto space-y-4">
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

                {/* Discord Integration */}
                <DiscordSettings />
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

// Discord webhook settings component
function DiscordSettings() {
  const [webhook, setWebhook] = useState(getDiscordWebhook());
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);

  const handleSave = () => {
    setDiscordWebhook(webhook);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleTest = async () => {
    if (!webhook) return;
    setTesting(true);
    await sendDiscordAlert(webhook, {
      title: "Test Alert from Diamond-Quant Live",
      description: "If you see this, Discord alerts are working!",
      color: 0x00ff88,
      fields: [{ name: "Status", value: "Connected", inline: true }],
    });
    setTesting(false);
  };

  return (
    <div className="glass rounded-xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <svg className="w-5 h-5 text-[#5865F2]" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>
        <h3 className="text-sm font-semibold text-silver">Discord Alerts</h3>
      </div>
      <p className="text-xs text-mercury mb-3">
        Get arb and +EV alerts sent directly to your Discord server. Create a webhook in your channel settings and paste the URL below.
      </p>
      <div className="flex gap-2">
        <input
          type="url"
          value={webhook}
          onChange={(e) => setWebhook(e.target.value)}
          placeholder="https://discord.com/api/webhooks/..."
          className="flex-1 px-3 py-2 bg-gunmetal/50 border border-slate/30 rounded-lg text-sm text-silver placeholder:text-mercury/30 focus:outline-none focus:border-electric/30 font-mono text-xs"
        />
        <button onClick={handleSave} className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${saved ? "bg-neon/20 text-neon" : "bg-electric/15 text-electric hover:bg-electric/25"}`}>
          {saved ? "Saved!" : "Save"}
        </button>
        {webhook && (
          <button onClick={handleTest} disabled={testing} className="px-3 py-2 bg-gunmetal/50 text-mercury text-xs rounded-lg hover:bg-gunmetal/70 transition-colors">
            {testing ? "..." : "Test"}
          </button>
        )}
      </div>
    </div>
  );
}
