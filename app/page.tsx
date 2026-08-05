"use client";

import {
  useEffect,
  useState,
  useCallback,
  useRef,
  lazy,
  Suspense,
} from "react";
import { useStore } from "@/lib/store";
import { useSport } from "@/lib/sport-context";
import LiveTicker from "@/components/dashboard/LiveTicker";
import GameCard from "@/components/dashboard/GameCard";
import GameDetailModal from "@/components/dashboard/GameDetailModal";
import ArbitrageAlert from "@/components/dashboard/ArbitrageAlert";
import LineMovement from "@/components/dashboard/LineMovement";
import BetSlip from "@/components/dashboard/BetSlip";
import PicksBoard from "@/components/dashboard/PicksBoard";
import SafeBoundary from "@/components/SafeBoundary";
import { teamNameToAbbrev } from "@/lib/logos";
import AuthButton from "@/components/auth/AuthButton";
import PushOptIn from "@/components/dashboard/PushOptIn";
import { useAuth } from "@/lib/supabase/auth";
import MigrationBanner from "@/components/auth/MigrationBanner";
import ConversionBanner from "@/components/ConversionBanner";
import { matchGames } from "@/lib/mlb/match-games";
import StreakBanner from "@/components/dashboard/StreakBanner";
import {
  useWarmNbaPlayerIndex,
  useWarmMlbPlayerIndex,
} from "@/lib/hooks/useNbaPlayerIndex";
import FloatingParlayChip from "@/components/dashboard/FloatingParlayChip";
import HeroBanner from "@/components/dashboard/HeroBanner";
import EdgeFinder from "@/components/dashboard/EdgeFinder";
import InjuryAlerts from "@/components/dashboard/InjuryAlerts";
import Toaster from "@/components/ui/Toaster";
import OnboardingTour from "@/components/onboarding/OnboardingTour";
import { backupOddsToStorage, getOddsBackup } from "@/lib/odds/cache";
import { sendDiscordAlert } from "@/lib/odds/sportsbooks";
import { getDiscordWebhook, setDiscordWebhook } from "@/lib/store";

// Lazy-load heavy tabs — not needed on first paint
const PlayersTab = lazy(() => import("@/components/dashboard/PlayersTab"));
const NRFITab = lazy(() => import("@/components/dashboard/NRFITab"));
const DingersTab = lazy(() => import("@/components/dashboard/DingersTab"));
const ArbBoard = lazy(() => import("@/components/dashboard/ArbBoard"));
const NewsBoard = lazy(() => import("@/components/dashboard/NewsBoard"));
const LiveBoard = lazy(() => import("@/components/dashboard/LiveBoard"));
const UserProfile = lazy(() => import("@/components/auth/UserProfile"));

function TabSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-24 rounded-xl bg-gunmetal/20 border border-slate/10" />
      <div className="h-40 rounded-xl bg-gunmetal/20 border border-slate/10" />
      <div className="h-32 rounded-xl bg-gunmetal/20 border border-slate/10" />
    </div>
  );
}
import {
  BarChart3,
  User,
  UserCircle,
  RefreshCw,
  Shield,
  Radio,
  ChevronLeft,
  ChevronRight,
  X,
  HelpCircle,
  Volume2,
  VolumeX,
  AlertTriangle,
  Zap,
  Newspaper,
  Search,
  Target,
  Flame,
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

function registerServiceWorker() {
  // Register the SW so it can receive push messages once the user opts in
  // through PushOptIn (which gates Notification.requestPermission behind a
  // real user gesture). Auto-prompting on page-load is bad UX and is
  // ignored by Safari/iOS anyway.
  try {
    if (typeof window === "undefined") return;
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  } catch {}
}

export default function WarRoom() {
  const {
    selectedGameId,
    activeTab,
    setActiveTab,
    sidebarOpen,
    toggleSidebar,
    games,
    oddsData,
    scores,
    isLoading,
    setGames,
    setOddsData,
    setScores,
    setLoading,
    lastUpdate,
    selectGame,
    snapshotOdds,
    getLineMovements,
    hydrate,
  } = useStore();
  const { currentSport, config, setSport } = useSport();
  const { isAdmin, user: authUser } = useAuth();
  // Pre-load NBA + MLB player indexes on app start so headshots resolve
  // synchronously (no blank → photo flicker) when tabs remount.
  useWarmNbaPlayerIndex();
  useWarmMlbPlayerIndex();

  // Pre-warm the OTHER sport's scores/analysis in the background so the first
  // sport-tab switch feels instant. Odds are deliberately NOT pre-warmed here —
  // that call costs Odds API quota on every session even when the user never
  // switches sports, and free-tier quota is the binding constraint.
  useEffect(() => {
    const otherSport = currentSport === "nba" ? "mlb" : "nba";
    const isOtherNBA = otherSport === "nba";
    const t = setTimeout(() => {
      Promise.all([
        fetch(isOtherNBA ? "/api/nba-scores" : "/api/scores")
          .then((r) => r.json())
          .catch(() => ({ games: [] })),
        fetch(isOtherNBA ? "/api/nba-analysis" : "/api/analysis")
          .then((r) => r.json())
          .catch(() => ({ analyses: [] })),
      ])
        .then(([scoresRes, analysisRes]) => {
          try {
            localStorage.setItem(
              `dq_sport_cache_${otherSport}`,
              JSON.stringify({
                ts: Date.now(),
                scores: scoresRes.games ?? [],
                odds: [],
                analyses: analysisRes.analyses ?? [],
                merged: scoresRes.games ?? [],
              }),
            );
          } catch {}
        })
        .catch(() => {});
    }, 4000); // wait for primary sport to settle first
    return () => clearTimeout(t);
  }, [currentSport]);

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
  const [modalGameId, setModalGameId] = useState<string | null>(null);
  // Track which EV bets we've already alerted on to prevent spam every 3 min
  const alertedEvIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    hydrate();
    registerServiceWorker();
  }, [hydrate]);

  const fetchData = useCallback(async () => {
    setRefreshing(true);
    const isNBA = currentSport === "nba";
    const sportKey = config.oddsApiKey;
    const cacheKey = `dq_sport_cache_${currentSport}`;
    try {
      // Scores load first — unblocks the UI immediately
      const scoresP = isNBA
        ? fetch("/api/nba-scores")
            .then((r) => r.json())
            .catch(() => ({ games: [] }))
        : fetch("/api/scores")
            .then((r) => r.json())
            .catch(() => ({ games: [] }));
      const oddsP = fetch(`/api/odds?sport=${sportKey}`)
        .then((r) => r.json())
        .catch(() => ({ games: [] }));
      const analysisP = isNBA
        ? fetch("/api/nba-analysis")
            .then((r) => r.json())
            .catch(() => ({ analyses: [] }))
        : fetch("/api/analysis")
            .then((r) => r.json())
            .catch(() => ({ analyses: [] }));

      const scoresRes = await scoresP;
      const scoreGames = scoresRes.games ?? [];
      setScores(scoreGames);
      setLoading(false); // unblock UI as soon as scores arrive

      // Auto-select first live or upcoming game — never a final
      if (!selectedGameId && scoreGames.length > 0) {
        const liveGame = scoreGames.find((g: any) => g.status === "live");
        const upcoming = scoreGames.find((g: any) => g.status === "pre");
        const pick = liveGame ?? upcoming;
        if (pick) selectGame(pick.id);
      }

      // Odds + analysis load in parallel after scores
      const [oddsRes, analysisRes] = await Promise.all([oddsP, analysisP]);
      let oddsGames = oddsRes.games ?? [];
      setIsDemo(false);

      // Backup only for MLB
      if (!isNBA) {
        if (oddsGames.length === 0) {
          const backup = getOddsBackup();
          if (backup && backup.age < 30) {
            oddsGames = backup.data;
          }
        } else {
          backupOddsToStorage(oddsGames);
        }
      }

      setOddsData(oddsGames);
      setAnalyses(analysisRes.analyses ?? []);
      if (!isNBA) snapshotOdds(oddsGames);

      // Robust game matching
      const matchMap = matchGames(scoreGames, oddsGames);
      const merged = scoreGames.map((score: any) => {
        const odds = matchMap.get(score.homeTeam);
        return { ...score, odds };
      });
      setGames(merged);

      // Persist a per-sport snapshot so that flipping sport tabs hydrates
      // INSTANTLY from cache (no empty screen) while a fresh fetch runs in
      // the background. Keeps the UI populated even on slow Vercel cold starts.
      try {
        if (
          typeof window !== "undefined" &&
          (scoreGames.length ||
            oddsGames.length ||
            analysisRes.analyses?.length)
        ) {
          localStorage.setItem(
            cacheKey,
            JSON.stringify({
              ts: Date.now(),
              scores: scoreGames,
              odds: oddsGames,
              analyses: analysisRes.analyses ?? [],
              merged,
            }),
          );
        }
      } catch {}
    } catch (e) {
      console.error("Fetch error:", e);
      setLoading(false);
    }
    setRefreshing(false);
    // selectedGameId is deliberately NOT a dependency: it's read through
    // useStore.getState() inside the callback, not captured from the closure.
    // Listing it re-created fetchData on every game selection, which re-ran
    // the polling effect and burned Odds API quota for nothing.
  }, [
    setScores,
    setOddsData,
    setGames,
    setLoading,
    snapshotOdds,
    selectGame,
    currentSport,
    config,
  ]);

  useEffect(() => {
    // Smart polling: dead overnight, fast during games, slow otherwise
    function shouldPoll(): boolean {
      const now = new Date();
      const etHour = new Date(
        now.toLocaleString("en-US", { timeZone: "America/New_York" }),
      ).getHours();
      return etHour >= 9 || etHour < 2; // Active 9 AM - 2 AM ET
    }

    fetchData();
    // 3min polling — scores/odds are cached server-side for 10-30min anyway,
    // so polling faster than that just burns Odds API free-tier quota (500
    // req/month) without getting fresher data back.
    const interval = setInterval(() => {
      if (shouldPoll()) fetchData();
    }, 180000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Sport switch: hydrate INSTANTLY from per-sport localStorage cache (so the
  // UI never goes blank), then trigger a background refresh. This eliminates
  // the "switch tab → empty screen for 5s → reload" pattern users were seeing.
  const { clearParlay } = useStore();
  useEffect(() => {
    selectGame(null);
    clearParlay(); // strip prior-sport legs from parlay builder
    let hydratedFromCache = false;
    try {
      if (typeof window !== "undefined") {
        const raw = localStorage.getItem(`dq_sport_cache_${currentSport}`);
        if (raw) {
          const cached = JSON.parse(raw);
          // Trust caches up to 30 min old — gives instant pop-in then refresh
          if (cached?.ts && Date.now() - cached.ts < 30 * 60 * 1000) {
            setScores(cached.scores ?? []);
            setOddsData(cached.odds ?? []);
            setAnalyses(cached.analyses ?? []);
            setGames(cached.merged ?? cached.scores ?? []);
            setLoading(false);
            hydratedFromCache = true;
          }
        }
      }
    } catch {}
    if (!hydratedFromCache) {
      // No cache for this sport — clear stale prior-sport data so we don't
      // briefly show MLB games on the NBA tab.
      setOddsData([]);
      setScores([]);
      setGames([]);
      setLoading(true);
    }
    fetchData();
  }, [currentSport]); // eslint-disable-line react-hooks/exhaustive-deps

  // Manual refresh event from PicksBoard empty state
  useEffect(() => {
    const handler = () => fetchData();
    window.addEventListener("dq-refresh", handler);
    return () => window.removeEventListener("dq-refresh", handler);
  }, [fetchData]);

  // Arb alert: flash + sound when new arbs appear
  const currentArbCount = oddsData.reduce(
    (sum: number, g: any) => sum + (g.arbitrage?.length ?? 0),
    0,
  );
  useEffect(() => {
    if (currentArbCount > prevArbCount && prevArbCount > 0) {
      setArbFlash(true);
      if (soundEnabled) playAlertSound();
      sendNotification(
        "Arbitrage Alert",
        `${currentArbCount - prevArbCount} new arbitrage opportunity found!`,
      );

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
              {
                name: "Profit",
                value: `+${newest.profit.toFixed(2)}%`,
                inline: true,
              },
              {
                name: "Stakes",
                value: `$${newest.stake1.toFixed(0)} / $${newest.stake2.toFixed(0)}`,
                inline: true,
              },
            ],
          });
        }
      }
      setTimeout(() => setArbFlash(false), 3000);
    }

    // High EV alert — fire ONCE per unique pick. Without dedupe, the every-3-min
    // poll re-fired the same alert (the prevArbCount===0 gate was a no-op once
    // arb count stabilized at 0, so it triggered on every refresh).
    const bigEV = oddsData
      .flatMap((g: any) => g.evBets ?? [])
      .filter((b: any) => b.evPercentage > 6 && !b.isSuspicious);
    if (bigEV.length > 0 && !isLoading) {
      const top = bigEV[0];
      const evKey = `${top.pick}|${top.bookmaker}|${top.odds}`;
      if (!alertedEvIds.current.has(evKey)) {
        alertedEvIds.current.add(evKey);
        sendNotification(
          "High EV Alert",
          `${top.pick} at ${top.bookmaker} — +${top.evPercentage.toFixed(1)}% edge`,
        );
        const webhook = getDiscordWebhook();
        if (webhook) {
          sendDiscordAlert(webhook, {
            title: "TOP LOCK ALERT",
            description: `${top.pick}\n${top.game} @ ${top.bookmaker}`,
            color: 0x00ff88,
            fields: [
              {
                name: "Odds",
                value: `${top.odds > 0 ? "+" : ""}${top.odds}`,
                inline: true,
              },
              {
                name: "EV Edge",
                value: `+${top.evPercentage.toFixed(1)}%`,
                inline: true,
              },
            ],
          });
        }
      }
    }
    setPrevArbCount(currentArbCount);
  }, [currentArbCount, prevArbCount, soundEnabled, oddsData, isLoading]);

  const selectedOdds = oddsData.find((g: any) => g.id === selectedGameId);
  const selectedScore = scores.find((s: any) => s.id === selectedGameId);
  const selectedAnalysis = analyses.find(
    (a: any) =>
      selectedScore &&
      (a.homeTeam === selectedScore.homeTeam ||
        a.homeAbbrev === selectedScore.homeAbbrev),
  );

  // Build quant verdict using real analysis data when available
  const buildVerdict = () => {
    const best = selectedOdds?.evBets?.[0];

    // Prefer the odds-board EV bet when the live feed has one; otherwise fall
    // back to the brain's own analysis-driven pick/odds/EV (populated even
    // when the odds API quota is exhausted, since analysis carries its own
    // best-price lookup).
    if (!best && !selectedAnalysis?.pick) return null;

    const engineProb = selectedAnalysis?.homeWinProb
      ? best?.pick.includes(selectedOdds?.homeTeam ?? "")
        ? selectedAnalysis.homeWinProb / 100
        : selectedAnalysis.awayWinProb / 100
      : (best?.fairProb ?? selectedAnalysis?.modelProb ?? 50) / 100;

    const engineReasoning =
      selectedAnalysis?.reasoning?.length > 0 ? selectedAnalysis.reasoning : [];

    const pick = best?.pick ?? selectedAnalysis?.pick;
    const bookmaker =
      best?.bookmaker ??
      selectedAnalysis?.bestBook ??
      selectedAnalysis?.bookmaker;
    const evPercentage = best?.evPercentage ?? selectedAnalysis?.evPct ?? 0;
    const fairOdds = best?.fairOdds ?? selectedAnalysis?.fairOdds ?? 0;
    const marketOdds =
      best?.odds ??
      selectedAnalysis?.marketOdds ??
      selectedAnalysis?.bestOdds ??
      0;
    const kellyStake = best?.kellyStake ?? 0;
    const confidence =
      best?.confidence ?? (evPercentage > 3 ? "MEDIUM" : "LOW");

    // "fair value" for game lines is the de-vigged consensus of all books
    // (getMarketConsensus), so calling the market mispriced is circular. What
    // this actually detects is one book pricing away from the others.
    const defaultReasoning = [
      "This book's price is off the consensus across other books",
      bookmaker
        ? `Best available line at ${bookmaker}`
        : "No live odds feed — consensus price unavailable",
      `${evPercentage.toFixed(1)}% vs consensus — quarter-Kelly sizing applied`,
    ];

    return {
      winProb: engineProb,
      evPercentage,
      kellyStake,
      confidence,
      pick,
      fairOdds,
      marketOdds,
      reasoning: [...engineReasoning, ...defaultReasoning].slice(0, 5),
      bookmaker: bookmaker ?? "—",
    };
  };

  const allArbs = oddsData.flatMap((g: any) => g.arbitrage ?? []);

  // Get line movements for selected game
  const lineMovements = selectedGameId ? getLineMovements(selectedGameId) : [];

  const openBetSlip = (prefill?: any) => {
    setBetSlipPrefill(prefill ?? null);
    setBetSlipOpen(true);
  };

  // Simplified to 4 tabs. Live / Props / Arbs / News all merge into Board.
  // The Bot Challenge (and the model/brain internals that sat beside it) is
  // no longer a dashboard tab at all — it lives at /admin/bot. The underlying
  // pick-generation/learning engine still runs on its normal schedule and
  // feeds picks elsewhere, but its own record/stats aren't public-facing
  // (thin sample, mixes backtest and live numbers in ways a visitor could
  // easily misread as a proven track record). Watch it internally instead.
  const tabs = [
    { key: "dashboard" as const, icon: BarChart3, label: "Board" },
    { key: "nrfi" as const, icon: Target, label: "NRFI" },
    { key: "dingers" as const, icon: Flame, label: "Dingers" },
    { key: "players" as const, icon: Search, label: "Players" },
    { key: "profile" as const, icon: UserCircle, label: "Profile" },
  ];

  // Only show live + upcoming games — never finals
  // For NBA: if scores are empty, build game list from odds data
  const activeGames =
    scores.length > 0
      ? scores.filter((g: any) => g.status !== "final")
      : oddsData.map((g: any) => ({
          id: g.id,
          homeTeam: g.homeTeam,
          awayTeam: g.awayTeam,
          homeAbbrev:
            teamNameToAbbrev(g.homeTeam ?? "", currentSport as "mlb" | "nba") ||
            (g.homeTeam?.split(" ").pop()?.slice(0, 3).toUpperCase() ?? ""),
          awayAbbrev:
            teamNameToAbbrev(g.awayTeam ?? "", currentSport as "mlb" | "nba") ||
            (g.awayTeam?.split(" ").pop()?.slice(0, 3).toUpperCase() ?? ""),
          homeScore: 0,
          awayScore: 0,
          status: "pre",
          startTime: g.commenceTime,
          venue: "",
          homePitcher: "",
          awayPitcher: "",
          detailedStatus: "Scheduled",
        }));

  const renderGameCards = () => (
    <div className="space-y-2">
      {activeGames.length === 0 ? (
        <div className="glass rounded-xl p-6 text-center">
          <p className="text-sm text-mercury">
            No {currentSport.toUpperCase()} games in the next few days
          </p>
          <p className="text-[11px] text-mercury/50 mt-1">
            Check back when the next slate is posted
          </p>
        </div>
      ) : (
        activeGames.map((game: any) => {
          const odds = oddsData.find(
            (o: any) =>
              o.homeTeam?.includes(game.homeAbbrev) ||
              o.homeTeam === game.homeTeam,
          );
          return (
            <div key={game.id} className="relative group">
              <GameCard
                game={game}
                oddsInfo={{
                  bestHomeML: odds?.bestLines?.bestHomeML,
                  bestAwayML: odds?.bestLines?.bestAwayML,
                  arbCount: odds?.arbitrage?.length ?? 0,
                  topEV: odds?.evBets?.[0]?.evPercentage ?? 0,
                }}
              />
              {/* Detail button — appears on hover (desktop) or always (mobile) */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setModalGameId(game.id);
                }}
                className="absolute top-2 right-8 sm:right-10 z-10 px-2 py-1 rounded-md text-[9px] font-bold text-electric/80 border border-electric/20 bg-bunker/90 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity hover:text-electric hover:border-electric/40"
                title="View game details"
              >
                DETAIL
              </button>
            </div>
          );
        })
      )}
    </div>
  );

  return (
    <div className="min-h-screen">
      <LiveTicker />

      {/* Header */}
      <header className="safe-top border-b border-slate/25 bg-void/70 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-[1800px] mx-auto px-3 sm:px-4 py-2 sm:py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {/* Brand mark — cropped from the QUANT logo. Sport-tinted ring
                keeps the existing NBA/MLB color cue without recoloring the
                artwork itself. */}
            <div
              className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center border flex-shrink-0 shadow-lg overflow-hidden ${
                currentSport === "nba"
                  ? "border-orange-500/25"
                  : "border-neon/25"
              }`}
            >
              <img
                src="/quant-mark.png"
                alt="Quant Betting"
                width={36}
                height={36}
                className="w-full h-full object-cover"
              />
            </div>
            {/* Wordmark shows on mobile too — it was `hidden sm:block`, which
                left the phone header with just an unlabelled logo tile. The
                "SPORTS INTELLIGENCE" subtitle stays desktop-only so the mobile
                header doesn't crowd the sport switcher. */}
            <div className="min-w-0">
              <h1 className="text-sm sm:text-lg font-extrabold text-silver tracking-tight leading-tight whitespace-nowrap">
                Quant
                <span
                  className={`ml-1 ${currentSport === "nba" ? "text-orange-400" : "text-neon"}`}
                >
                  Betting
                </span>
              </h1>
              <p className="hidden sm:block text-[10px] text-mercury/60 -mt-0.5 font-mono tracking-wider">
                SPORTS INTELLIGENCE
              </p>
            </div>
            {/* Sport Switcher — segmented pill, thumb-sized targets */}
            <div className="flex items-center bg-gunmetal/60 border border-slate/30 rounded-full p-0.5 sm:p-1 sm:ml-1">
              {(
                [
                  { key: "mlb", label: "MLB", active: "bg-neon/15 text-neon" },
                  {
                    key: "nba",
                    label: "NBA",
                    active: "bg-orange-500/15 text-orange-400",
                  },
                  {
                    key: "nfl",
                    label: "NFL",
                    active: "bg-electric/15 text-electric",
                  },
                  {
                    key: "nhl",
                    label: "NHL",
                    active: "bg-sky-300/15 text-sky-300",
                  },
                ] as const
              ).map((s) => (
                <button
                  key={s.key}
                  onClick={() => {
                    setSport(s.key);
                    selectGame(null);
                  }}
                  className={`min-h-[36px] min-w-[42px] sm:min-w-[48px] px-2 sm:px-3 rounded-full text-[11px] font-bold transition-all active:scale-95 ${
                    currentSport === s.key
                      ? `${s.active} shadow-sm`
                      : "text-mercury/50 hover:text-mercury"
                  }`}
                >
                  {s.label}
                </button>
              ))}
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
            <AuthButton />
            {isDemo && oddsData.length === 0 && (
              <span className="hidden sm:flex items-center gap-1 px-2 py-1 rounded bg-amber/10 border border-amber/20 text-[10px] text-amber font-semibold">
                <AlertTriangle className="w-3 h-3" /> NO ODDS
              </span>
            )}
            <button
              onClick={fetchData}
              disabled={refreshing}
              className="hidden sm:flex items-center justify-center min-w-[40px] min-h-[36px] rounded-lg hover:bg-gunmetal/50 transition-colors"
              title="Refresh data"
              aria-label="Refresh"
            >
              <RefreshCw
                className={`w-4 h-4 text-mercury ${refreshing ? "animate-spin" : ""}`}
              />
            </button>
          </div>
        </div>
      </header>

      <MigrationBanner />
      <ConversionBanner />

      {/* Help Panel */}
      {showHelp && (
        <div className="max-w-[1800px] mx-auto px-2 sm:px-4 pt-3">
          <div className="glass rounded-xl p-4 sm:p-5 animate-slide-up">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-silver">Quick Guide</h3>
              <button
                onClick={() => setShowHelp(false)}
                className="p-1 hover:bg-gunmetal/50 rounded"
              >
                <X className="w-4 h-4 text-mercury" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-gunmetal/30">
                <p className="font-semibold text-neon mb-1">
                  +EV (Positive Expected Value)
                </p>
                <p className="text-mercury">
                  {/* No profit promise: our game-line "fair" probability is the
                      de-vigged consensus of all books, so +EV here means one
                      book is off the others' price — not a guaranteed return. */}
                  A bet where the estimated probability of winning is higher
                  than what the odds imply. For game lines that estimate is the
                  consensus across books, so +EV means you found the best price.
                </p>
              </div>
              <div className="p-3 rounded-lg bg-gunmetal/30">
                <p className="font-semibold text-gold mb-1">Kelly Stake</p>
                <p className="text-mercury">
                  The mathematically optimal bet size based on your edge and
                  bankroll. We use quarter-Kelly (safer) by default.
                </p>
              </div>
              <div className="p-3 rounded-lg bg-gunmetal/30">
                <p className="font-semibold text-electric mb-1">
                  Arbitrage (Arb)
                </p>
                <p className="text-mercury">
                  When odds across different books guarantee profit regardless
                  of outcome. Rare but free money when found.
                </p>
              </div>
              <div className="p-3 rounded-lg bg-gunmetal/30">
                <p className="font-semibold text-purple mb-1">
                  Fair Odds / Vig
                </p>
                <p className="text-mercury">
                  Fair odds = what the line should be without the book's cut.
                  The vig (juice) is the book's profit margin built into the
                  odds.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Games Sheet */}
      {mobileGamesOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileGamesOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-[85vw] max-w-sm bg-bunker border-r border-slate/30 overflow-y-auto animate-slide-up">
            <div className="sticky top-0 bg-bunker/95 backdrop-blur-lg px-4 py-3 border-b border-slate/30 flex items-center justify-between z-10">
              <h2 className="text-sm font-semibold text-silver uppercase tracking-wider">
                Games ({activeGames.length})
              </h2>
              <button
                onClick={() => setMobileGamesOpen(false)}
                className="p-1.5 hover:bg-gunmetal/50 rounded-lg"
              >
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
      <main
        id="main"
        className="max-w-[1800px] mx-auto px-2 sm:px-4 py-3 sm:py-4 pb-28 md:pb-4"
      >
        {isLoading ? (
          <div
            className="flex gap-4"
            aria-label="Loading dashboard"
            role="status"
          >
            {/* Left sidebar skeleton (desktop) */}
            <div className="hidden lg:block w-72 flex-shrink-0">
              <div className="h-3 w-24 bg-slate/20 rounded animate-pulse mb-3" />
              <div className="space-y-2">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-slate/20 bg-gunmetal/20 p-3 animate-pulse"
                  >
                    <div className="h-3 w-1/2 bg-slate/20 rounded mb-2" />
                    <div className="h-4 w-3/4 bg-slate/20 rounded" />
                  </div>
                ))}
              </div>
            </div>

            {/* Center column skeleton */}
            <div className="flex-1 min-w-0 space-y-3 sm:space-y-4">
              {/* Streak banner */}
              <div className="rounded-xl glass p-3 animate-pulse">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-slate/20 flex-shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-2/3 bg-slate/20 rounded" />
                    <div className="h-2.5 w-1/2 bg-slate/15 rounded" />
                  </div>
                </div>
              </div>

              {/* Tonight's plays — 3 cards */}
              <div className="rounded-xl glass overflow-hidden">
                <div className="px-3 sm:px-4 py-2.5 border-b border-slate/20 animate-pulse">
                  <div className="h-3 w-32 bg-slate/20 rounded" />
                </div>
                <div className="p-2 sm:p-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-slate/20 bg-gunmetal/20 p-3 space-y-2 animate-pulse"
                    >
                      <div className="h-3 w-1/3 bg-slate/20 rounded" />
                      <div className="h-4 w-2/3 bg-slate/20 rounded" />
                      <div className="h-2.5 w-1/2 bg-slate/15 rounded" />
                    </div>
                  ))}
                </div>
              </div>

              {/* Picks board — 2 sections, 3 rows each */}
              {[0, 1].map((s) => (
                <div key={s} className="rounded-xl glass overflow-hidden">
                  <div className="px-3 sm:px-4 py-2.5 border-b border-slate/20 animate-pulse">
                    <div className="h-3 w-40 bg-slate/20 rounded mb-1.5" />
                    <div className="h-2.5 w-24 bg-slate/15 rounded" />
                  </div>
                  <div className="divide-y divide-slate/10">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className="px-3 sm:px-4 py-3 flex items-center gap-2 animate-pulse"
                      >
                        <div className="w-7 h-7 rounded-full bg-slate/20 flex-shrink-0" />
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="h-3 w-2/3 bg-slate/20 rounded" />
                          <div className="h-2.5 w-1/3 bg-slate/15 rounded" />
                        </div>
                        <div className="h-5 w-12 bg-slate/20 rounded" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* Tabs stay mounted once visited and are only hidden via CSS —
                switching Board <-> Bot <-> Bank <-> Profile no longer
                unmounts + refetches everything from scratch. */}
            <div className={activeTab === "dashboard" ? "" : "hidden"}>
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
                <div
                  className={`mb-3 ${arbFlash ? "animate-flash-gold rounded-xl" : ""}`}
                >
                  <ArbitrageAlert arbitrage={allArbs} />
                </div>
              )}

              <div className="flex gap-4">
                {/* Left Sidebar — Desktop */}
                <div
                  className={`hidden lg:block transition-all duration-300 ${sidebarOpen ? "w-72" : "w-12"} flex-shrink-0`}
                >
                  <div className="sticky top-24">
                    <div className="flex items-center justify-between mb-3">
                      {sidebarOpen && (
                        <h2 className="text-xs font-semibold text-mercury uppercase tracking-wider">
                          Games ({scores.length})
                        </h2>
                      )}
                      <button
                        onClick={toggleSidebar}
                        className="p-1 hover:bg-gunmetal/50 rounded"
                      >
                        {sidebarOpen ? (
                          <ChevronLeft className="w-4 h-4 text-mercury" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-mercury" />
                        )}
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
                  {/* Desktop hero — brand + value prop. Hidden on mobile so
                      the phone board still opens straight onto picks. */}
                  <SafeBoundary>
                    <HeroBanner />
                  </SafeBoundary>

                  {/* Streak banner — social proof / retention hook */}
                  <SafeBoundary>
                    <StreakBanner />
                  </SafeBoundary>

                  {/* Push opt-in card (auto-hides if granted/dismissed) */}
                  <SafeBoundary>
                    <PushOptIn />
                  </SafeBoundary>

                  <SafeBoundary
                    fallback={
                      <div className="glass rounded-xl p-6 text-center">
                        <p className="text-sm text-mercury">
                          Picks board temporarily unavailable.
                        </p>
                        <button
                          onClick={() => location.reload()}
                          className="mt-3 text-xs text-neon underline"
                        >
                          Reload
                        </button>
                      </div>
                    }
                  >
                    <PicksBoard />
                  </SafeBoundary>

                  {/* Arbitrage opportunities — admin-only for now, same as
                      Bot/QuantVerdict below (not a public trust claim yet) */}
                  {isAdmin && (
                    <details className="glass rounded-xl overflow-hidden border border-gold/15">
                      <summary className="px-4 py-2.5 flex items-center gap-2 cursor-pointer hover:bg-gunmetal/20 text-xs font-bold text-silver uppercase tracking-wider list-none">
                        <Zap className="w-3.5 h-3.5 text-gold" />
                        Arbitrage Scanner
                        <span className="ml-auto text-[10px] text-mercury/50 font-mono normal-case">
                          {allArbs.length} opps
                        </span>
                      </summary>
                      <div className="border-t border-slate/15 p-3">
                        <Suspense fallback={<TabSkeleton />}>
                          <ArbBoard />
                        </Suspense>
                      </div>
                    </details>
                  )}

                  {/* News + injury feed (NBA only) */}
                  {currentSport === "nba" && (
                    <details className="glass rounded-xl overflow-hidden border border-electric/15">
                      <summary className="px-4 py-2.5 flex items-center gap-2 cursor-pointer hover:bg-gunmetal/20 text-xs font-bold text-silver uppercase tracking-wider list-none">
                        <Newspaper className="w-3.5 h-3.5 text-electric" />
                        News & Injuries
                      </summary>
                      <div className="border-t border-slate/15 p-3">
                        <Suspense fallback={<TabSkeleton />}>
                          <NewsBoard />
                        </Suspense>
                      </div>
                    </details>
                  )}

                  {/* Live games — moved to the bottom of the board. Parlay
                      of the Day and player props (inside PicksBoard) are
                      the priority content up top. */}
                  <SafeBoundary>
                    <Suspense fallback={null}>
                      <LiveBoard />
                    </Suspense>
                  </SafeBoundary>

                  {/* Desktop stats strip — built and wired to the real graded
                      track record (/api/results), but not mounted right now:
                      the current 30-day sample is a losing record and Eddie
                      opted to hold it back rather than headline it. Component
                      is kept in place so it can be re-mounted as a one-liner
                      when the record supports it — the alternative (hardcoding
                      the flattering numbers from the design comp) was
                      explicitly rejected. See components/dashboard/StatsStrip.tsx */}
                </div>

                {/* Right Sidebar — XL */}
                <div className="hidden xl:block w-80 flex-shrink-0 space-y-4">
                  <div className="sticky top-24 space-y-4">
                    <SafeBoundary>
                      <EdgeFinder />
                    </SafeBoundary>
                    <SafeBoundary>
                      <LineMovement />
                    </SafeBoundary>
                    <SafeBoundary>
                      <InjuryAlerts sport={currentSport} />
                    </SafeBoundary>
                  </div>
                </div>
              </div>
            </div>

            {/* Bot Challenge + model internals moved to /admin/bot — see
                the tabs list above. Nothing bot-related renders publicly. */}

            <div className={activeTab === "nrfi" ? "" : "hidden"}>
              <Suspense fallback={<TabSkeleton />}>
                <NRFITab />
              </Suspense>
            </div>

            <div className={activeTab === "dingers" ? "" : "hidden"}>
              <Suspense fallback={<TabSkeleton />}>
                <DingersTab />
              </Suspense>
            </div>

            <div
              className={`max-w-2xl mx-auto space-y-4 ${activeTab === "players" ? "" : "hidden"}`}
            >
              <Suspense fallback={<TabSkeleton />}>
                <PlayersTab />
              </Suspense>
            </div>

            <div
              className={`max-w-lg mx-auto space-y-4 ${activeTab === "profile" ? "" : "hidden"}`}
            >
              <Suspense fallback={<TabSkeleton />}>
                <UserProfile />
              </Suspense>
              {authUser && <DiscordSettings />}
            </div>
          </>
        )}
      </main>

      {/* Game Detail Modal */}
      {modalGameId && (
        <GameDetailModal
          gameId={modalGameId}
          analyses={analyses}
          onClose={() => setModalGameId(null)}
          onAddToParlay={() => openBetSlip()}
        />
      )}

      {/* Global UI: ephemeral toasts + floating parlay slip */}
      <Toaster />
      <SafeBoundary>
        <FloatingParlayChip
          activeTab={activeTab}
          onOpenBuilder={() => openBetSlip()}
        />
      </SafeBoundary>

      {/* First-visit onboarding tour — topmost overlay, self-dismissing */}
      <OnboardingTour />

      {/* Mobile bottom nav — floating pill, native-app feel */}
      <nav
        className="md:hidden fixed inset-x-3 z-50 rounded-2xl bg-bunker/90 backdrop-blur-xl border border-slate/40 shadow-[0_8px_32px_rgba(0,0,0,0.5)] flex items-stretch overflow-hidden"
        style={{ bottom: "max(0.25rem, env(safe-area-inset-bottom))" }}
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`relative flex-1 flex flex-col items-center justify-center gap-1 min-h-[56px] transition-all active:scale-95 ${
                isActive ? "text-neon" : "text-mercury/60"
              }`}
            >
              {isActive && (
                <span className="absolute inset-x-3 top-0 h-0.5 rounded-b-full bg-neon" />
              )}
              <tab.icon
                className={`w-5 h-5 transition-transform ${isActive ? "scale-110" : ""}`}
              />
              <span
                className={`text-[10px] ${isActive ? "font-bold" : "font-medium"}`}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </nav>

      <footer className="border-t border-slate/15 mt-6 sm:mt-8 py-4 mb-24 md:mb-0 text-center px-4">
        <p className="text-[10px] sm:text-xs text-mercury/40 font-mono">
          Quant Betting v1.0 — Odds via The Odds API. Stats via{" "}
          {currentSport === "nba" ? "NBA Stats API" : "MLB Stats API"}.
        </p>
        {/* Responsible-gambling disclosure. The site previously had NO 21+
            notice, no problem-gambling resource, and no eligibility notice
            anywhere in the codebase — a real compliance gap for a paid
            betting-picks product, and a real harm risk for at-risk users.
            Deliberately legible (mercury/60, not /30): a disclaimer nobody can
            read isn't a disclaimer. */}
        <p className="text-[9px] sm:text-[10px] text-mercury/40 mt-1">
          Analytics platform — for informational &amp; educational purposes
          only. Not betting advice. Past performance does not guarantee future
          results.
        </p>
        <p className="text-[10px] sm:text-[11px] text-mercury/60 mt-2 font-semibold">
          21+ only. Must be physically located in a state where sports wagering
          is legal.
        </p>
        <p className="text-[10px] sm:text-[11px] text-mercury/60 mt-1">
          Gambling problem? Call{" "}
          <a href="tel:1-800-522-4700" className="underline hover:text-mercury">
            1-800-GAMBLER
          </a>{" "}
          or visit{" "}
          <a
            href="https://www.ncpgambling.org/help-treatment/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-mercury"
          >
            ncpgambling.org
          </a>
          .
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 mt-3 text-[10px] text-mercury/50">
          <a href="/results" className="hover:text-mercury transition-colors">
            Track Record
          </a>
          <span className="text-mercury/20">·</span>
          <a href="/pricing" className="hover:text-mercury transition-colors">
            Pricing
          </a>
          <span className="text-mercury/20">·</span>
          <a href="/terms" className="hover:text-mercury transition-colors">
            Terms
          </a>
          <span className="text-mercury/20">·</span>
          <a href="/privacy" className="hover:text-mercury transition-colors">
            Privacy
          </a>
        </div>
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
      title: "Test Alert from Quant Betting",
      description: "If you see this, Discord alerts are working!",
      color: 0x00ff88,
      fields: [{ name: "Status", value: "Connected", inline: true }],
    });
    setTesting(false);
  };

  return (
    <div className="glass rounded-xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <svg
          className="w-5 h-5 text-[#5865F2]"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
        </svg>
        <h3 className="text-sm font-semibold text-silver">Discord Alerts</h3>
      </div>
      <p className="text-xs text-mercury mb-3">
        Get arb and +EV alerts sent directly to your Discord server. Create a
        webhook in your channel settings and paste the URL below.
      </p>
      <div className="flex gap-2">
        <input
          type="url"
          value={webhook}
          onChange={(e) => setWebhook(e.target.value)}
          placeholder="https://discord.com/api/webhooks/..."
          className="flex-1 px-3 py-2 bg-gunmetal/50 border border-slate/30 rounded-lg text-sm text-silver placeholder:text-mercury/30 focus:outline-none focus:border-electric/30 font-mono text-xs"
        />
        <button
          onClick={handleSave}
          className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${saved ? "bg-neon/20 text-neon" : "bg-electric/15 text-electric hover:bg-electric/25"}`}
        >
          {saved ? "Saved!" : "Save"}
        </button>
        {webhook && (
          <button
            onClick={handleTest}
            disabled={testing}
            className="px-3 py-2 bg-gunmetal/50 text-mercury text-xs rounded-lg hover:bg-gunmetal/70 transition-colors"
          >
            {testing ? "..." : "Test"}
          </button>
        )}
      </div>
    </div>
  );
}
