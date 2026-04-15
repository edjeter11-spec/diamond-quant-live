"use client";

import { useState, useEffect } from "react";
import { useStore } from "@/lib/store";
import { useSport } from "@/lib/sport-context";
import { BOOK_DISPLAY } from "@/lib/odds/the-odds-api";
import {
  User, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight,
  RefreshCw, ChevronDown, ChevronUp, Target, BarChart3, Clock,
  Minus, Star, AlertCircle, Zap, Search, X,
} from "lucide-react";

interface PropLine {
  playerName: string;
  line: number;
  market: string;
  team: string;
  gameTime?: string | null;
  books: Array<{ bookmaker: string; overPrice: number; underPrice: number }>;
  bestOver: { bookmaker: string; price: number };
  bestUnder: { bookmaker: string; price: number };
  fairOverProb: number;
  fairUnderProb: number;
}

interface StatBlock {
  gamesPlayed?: number; era?: number; whip?: number; strikeouts?: number;
  k9?: number; avgStrikeoutsPerGame?: number; avg?: number; ops?: number;
  hits?: number; homeRuns?: number; rbi?: number; stolenBases?: number;
  hitsPerGame?: number; tbPerGame?: number; wins?: number; losses?: number;
  totalBases?: number;
}

interface PlayerAnalysis {
  player: StatBlock & {
    name: string; team: string; teamAbbrev: string; position: string;
    number?: string; photo?: string;
  };
  lastYearStats?: StatBlock;
  careerStats?: StatBlock;
  dataSource?: "current" | "lastYear" | "career";
  last10Games: Array<{
    date: string; opponent: string; strikeouts?: number;
    hitsB?: number; homeRuns?: number; totalBases?: number; rbi?: number;
  }>;
  vsOpponent: { games: number; avgStat: number; trend: string };
  recommendation: {
    side: "over" | "under" | "lean_over" | "lean_under" | "no_edge";
    confidence: number;
    reasons: string[];
  };
}

const MARKET_LABELS: Record<string, string> = {
  pitcher_strikeouts: "Strikeouts",
  batter_hits: "Hits",
  batter_total_bases: "Total Bases",
  batter_home_runs: "Home Runs",
  batter_rbis: "RBIs",
  batter_runs_scored: "Runs",
  batter_stolen_bases: "Stolen Bases",
};

const MARKET_STAT_KEY: Record<string, string> = {
  pitcher_strikeouts: "strikeouts",
  batter_hits: "hitsB",
  batter_total_bases: "totalBases",
  batter_home_runs: "homeRuns",
  batter_rbis: "rbi",
};

const SIDE_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  over: { label: "BET OVER", color: "text-neon", icon: "up" },
  lean_over: { label: "LEAN OVER", color: "text-neon/70", icon: "up" },
  under: { label: "BET UNDER", color: "text-purple", icon: "down" },
  lean_under: { label: "LEAN UNDER", color: "text-purple/70", icon: "down" },
  no_edge: { label: "NO EDGE", color: "text-mercury", icon: "none" },
};

function getBookColor(key: string): string {
  return BOOK_DISPLAY[key]?.color ?? "#888";
}
function getBookShort(name: string): string {
  const entry = Object.values(BOOK_DISPLAY).find((b) => b.name === name);
  return entry?.short ?? name.slice(0, 3);
}

export default function PlayerProps() {
  const { addParlayLeg } = useStore();
  const { currentSport, config } = useSport();
  const [props, setProps] = useState<PropLine[]>([]);
  const [selectedMarket, setSelectedMarket] = useState(config.propMarkets[0]?.key ?? "pitcher_strikeouts");

  // Reset market when sport changes
  useEffect(() => {
    setSelectedMarket(config.propMarkets[0]?.key ?? "pitcher_strikeouts");
    setProps([]);
  }, [currentSport, config]);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null);
  const [playerAnalyses, setPlayerAnalyses] = useState<Record<string, PlayerAnalysis>>({});
  const [loadingAnalysis, setLoadingAnalysis] = useState<string | null>(null);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResult, setSearchResult] = useState<PlayerAnalysis | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");

  const [currentMarket, setCurrentMarket] = useState(selectedMarket);

  useEffect(() => {
    // Only fetch if market actually changed
    if (currentMarket !== selectedMarket) {
      setCurrentMarket(selectedMarket);
      setExpandedPlayer(null);
      setPlayerAnalyses({});
    }
    fetchProps();
  }, [selectedMarket]); // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchProps() {
    // DON'T clear existing props while loading — show stale data until new arrives
    setLoading(true);
    try {
      const res = await fetch(`/api/players?market=${selectedMarket}&sport=${config.oddsApiKey}`);
      const data = await res.json();
      const newProps = data.props ?? [];
      // Only update if we actually got data (don't replace good data with empty)
      if (newProps.length > 0 || props.length === 0) {
        setProps(newProps);
      }
      setIsDemo(data.demo === true);
    } catch {
      // Don't clear existing props on error
    }
    setLoading(false);
  }

  async function searchPlayer() {
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    setSearchError("");
    setSearchResult(null);
    try {
      const params = new URLSearchParams({
        name: searchQuery.trim(),
        market: selectedMarket,
        line: "0",
      });
      const endpoint = currentSport === "nba" ? "/api/nba-player" : "/api/player-analysis";
      const res = await fetch(`${endpoint}?${params}`);
      if (res.ok) {
        const data = await res.json();
        setSearchResult(data);
      } else {
        setSearchError("Player not found — try full name (e.g. 'Gerrit Cole')");
      }
    } catch {
      setSearchError("Search failed — try again");
    }
    setSearchLoading(false);
  }

  async function fetchAnalysis(playerName: string, line: number, team: string) {
    if (playerAnalyses[playerName]) return;
    setLoadingAnalysis(playerName);
    try {
      // Use sport-specific endpoint
      const isNBA = currentSport === "nba";
      const endpoint = isNBA ? "/api/nba-player" : "/api/player-analysis";
      const params = new URLSearchParams({
        name: playerName,
        market: selectedMarket,
        line: String(line),
        ...(team && !isNBA ? { opponent: team } : {}),
      });
      const res = await fetch(`${endpoint}?${params}`);
      if (res.ok) {
        const data = await res.json();
        setPlayerAnalyses((prev) => ({ ...prev, [playerName]: data }));
      }
    } catch {}
    setLoadingAnalysis(null);
  }

  const formatOdds = (odds: number) => (odds > 0 ? `+${odds}` : `${odds}`);

  const togglePlayer = (playerName: string, line: number, team: string) => {
    if (expandedPlayer === playerName) {
      setExpandedPlayer(null);
    } else {
      setExpandedPlayer(playerName);
      fetchAnalysis(playerName, line, team);
    }
  };

  const handleAddProp = (prop: PropLine, side: "over" | "under") => {
    const odds = side === "over" ? prop.bestOver.price : prop.bestUnder.price;
    const fairProb = side === "over" ? prop.fairOverProb / 100 : prop.fairUnderProb / 100;
    addParlayLeg({
      game: prop.playerName,
      market: "player_prop",
      pick: `${prop.playerName} ${side === "over" ? "Over" : "Under"} ${prop.line} ${MARKET_LABELS[prop.market] ?? prop.market}`,
      odds,
      fairProb,
      bookmaker: side === "over" ? prop.bestOver.bookmaker : prop.bestUnder.bookmaker,
    });
  };

  return (
    <div className="glass rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-3 sm:px-4 py-3 border-b border-slate/50">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <User className="w-5 h-5 text-electric" />
            <h3 className="text-sm font-semibold text-silver uppercase tracking-wide">Player Props</h3>
          </div>
          <button onClick={fetchProps} className="p-1.5 hover:bg-slate/30 rounded transition-colors">
            <RefreshCw className={`w-4 h-4 text-mercury ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Search Bar */}
        <div className="flex gap-2 mb-3">
          <div className="flex-1 relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-mercury/50" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchPlayer()}
              placeholder="Search any player (e.g. Aaron Judge)..."
              className="w-full pl-8 pr-3 py-2 bg-gunmetal/50 border border-slate/30 rounded-lg text-sm text-silver placeholder:text-mercury/40 focus:outline-none focus:border-electric/30"
            />
            {searchQuery && (
              <button onClick={() => { setSearchQuery(""); setSearchResult(null); setSearchError(""); }} className="absolute right-2 top-1/2 -translate-y-1/2">
                <X className="w-3.5 h-3.5 text-mercury/50" />
              </button>
            )}
          </div>
          <button
            onClick={searchPlayer}
            disabled={searchLoading || !searchQuery.trim()}
            className="px-3 py-2 bg-electric/15 text-electric border border-electric/30 rounded-lg text-xs font-semibold hover:bg-electric/25 disabled:opacity-40 transition-colors flex-shrink-0"
          >
            {searchLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : "Search"}
          </button>
        </div>

        {/* Market Filter */}
        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-0.5">
          {config.propMarkets.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setSelectedMarket(key)}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap flex-shrink-0 ${
                selectedMarket === key
                  ? "bg-electric/20 text-electric border border-electric/30"
                  : "text-mercury hover:bg-slate/30 border border-transparent"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Search Result */}
      {searchError && (
        <div className="px-4 py-3 bg-danger/5 border-b border-danger/15 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-danger flex-shrink-0" />
          <p className="text-xs text-danger">{searchError}</p>
        </div>
      )}
      {searchResult && (
        <div className="px-3 sm:px-4 py-4 bg-electric/5 border-b border-electric/15">
          {/* Player Card Header with Photo */}
          <div className="flex gap-3 mb-3">
            {/* Headshot */}
            {searchResult.player.photo && (
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden bg-gunmetal/50 flex-shrink-0 border border-slate/30">
                <img
                  src={searchResult.player.photo}
                  alt={searchResult.player.name}
                  className="w-full h-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base sm:text-lg font-bold text-silver">{searchResult.player.name}</h3>
                {searchResult.player.number && (
                  <span className="text-xs font-mono text-electric">#{searchResult.player.number}</span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs px-2 py-0.5 rounded bg-electric/15 text-electric font-medium">{searchResult.player.team}</span>
                <span className="text-xs px-2 py-0.5 rounded bg-gunmetal text-mercury">{searchResult.player.position}</span>
                <span className="text-[10px] text-mercury/50">{searchResult.player.gamesPlayed}G this season</span>
              </div>
            </div>
          </div>

          {/* Data source notice */}
          {searchResult.dataSource && searchResult.dataSource !== "current" && (
            <div className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-amber/5 border border-amber/15 mb-2">
              <AlertCircle className="w-3 h-3 text-amber flex-shrink-0" />
              <p className="text-[10px] text-amber">
                {searchResult.dataSource === "lastYear" ? "Early season — showing last year's stats as primary" : "Showing career stats (no recent season data)"}
              </p>
            </div>
          )}

          {/* Current / Primary Stats */}
          <p className="text-[9px] text-mercury uppercase tracking-wider mb-1 font-semibold">
            {searchResult.dataSource === "lastYear" ? `${new Date().getFullYear() - 1} Season` : searchResult.dataSource === "career" ? "Career" : `${new Date().getFullYear()} Season`}
          </p>
          <div className="grid grid-cols-4 gap-1.5 sm:gap-2 mb-3">
            <SeasonStatsGrid stats={searchResult.player} />
          </div>

          {/* Last Year Stats */}
          {searchResult.lastYearStats && searchResult.dataSource === "current" && (
            <div className="mb-3">
              <p className="text-[9px] text-mercury uppercase tracking-wider mb-1 font-semibold">{new Date().getFullYear() - 1} Season</p>
              <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
                <SeasonStatsGrid stats={searchResult.lastYearStats} />
              </div>
            </div>
          )}

          {/* Career Stats */}
          {searchResult.careerStats && (
            <div className="mb-3">
              <p className="text-[9px] text-mercury uppercase tracking-wider mb-1 font-semibold">Career</p>
              <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
                <SeasonStatsGrid stats={searchResult.careerStats} />
              </div>
            </div>
          )}

          {/* Last 10+ Games Chart */}
          {searchResult.last10Games.length > 0 && (
            <div className="mb-3 rounded-lg bg-gunmetal/20 p-3">
              <p className="text-[10px] text-mercury uppercase tracking-wider mb-2 font-semibold">
                Last {searchResult.last10Games.length} Games
              </p>
              <div className="flex items-end gap-1 h-20">
                {searchResult.last10Games.map((game: any, gi: number) => {
                  const statKey = MARKET_STAT_KEY[selectedMarket] || "strikeouts";
                  const val = game[statKey] ?? 0;
                  const maxVal = Math.max(...searchResult.last10Games.map((g: any) => g[statKey] ?? 0), 1);
                  const height = maxVal > 0 ? (val / maxVal) * 100 : 0;
                  return (
                    <div key={gi} className="flex-1 flex flex-col items-center gap-0.5" title={`${game.opponent}: ${val}`}>
                      <span className="text-[8px] font-mono text-silver font-bold">{val}</span>
                      <div
                        className="w-full rounded-t bg-gradient-to-t from-electric/60 to-electric/30 transition-all"
                        style={{ height: `${Math.max(height, 6)}%` }}
                      />
                      <span className="text-[7px] text-mercury/50 truncate w-full text-center">
                        {game.opponent?.split(" ").pop()?.slice(0, 3)}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Game log table */}
              <div className="mt-3 space-y-0.5">
                {searchResult.last10Games.slice(-5).reverse().map((game: any, gi: number) => {
                  const statKey = MARKET_STAT_KEY[selectedMarket] || "strikeouts";
                  const val = game[statKey] ?? 0;
                  return (
                    <div key={gi} className="flex items-center gap-2 text-[10px]">
                      <span className="text-mercury/50 w-16 truncate">{game.opponent?.split(" ").pop()}</span>
                      <div className="flex-1 h-1 bg-gunmetal rounded-full overflow-hidden">
                        <div className="h-full bg-electric/50 rounded-full" style={{ width: `${Math.min((val / Math.max(...searchResult.last10Games.map((g: any) => g[statKey] ?? 0), 1)) * 100, 100)}%` }} />
                      </div>
                      <span className="font-mono text-silver font-bold w-5 text-right">{val}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Recommendation */}
          {searchResult.recommendation && (
            <div className={`rounded-lg p-3 border ${
              searchResult.recommendation.side.includes("over") ? "bg-neon/5 border-neon/20" :
              searchResult.recommendation.side.includes("under") ? "bg-purple/5 border-purple/20" :
              "bg-gunmetal/30 border-slate/20"
            }`}>
              <div className="flex items-center gap-2 mb-2">
                <Target className="w-4 h-4 text-gold" />
                <span className={`text-sm font-bold ${SIDE_LABELS[searchResult.recommendation.side]?.color ?? "text-mercury"}`}>
                  {SIDE_LABELS[searchResult.recommendation.side]?.label ?? "ANALYZING"}
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  <div className="w-12 h-1.5 bg-gunmetal rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${searchResult.recommendation.confidence > 50 ? "bg-neon" : "bg-amber"}`} style={{ width: `${searchResult.recommendation.confidence}%` }} />
                  </div>
                  <span className="text-[10px] font-mono text-mercury">{searchResult.recommendation.confidence}%</span>
                </div>
              </div>
              {searchResult.recommendation.reasons.map((r: string, ri: number) => (
                <p key={ri} className="text-[11px] text-mercury flex gap-1.5 mb-0.5">
                  <span className="text-electric font-bold">{'>'}</span> {r}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Props List */}
      <div className="divide-y divide-slate/15">
        {loading && props.length === 0 ? (
          <div className="p-8 text-center">
            <RefreshCw className="w-6 h-6 text-mercury/30 animate-spin mx-auto mb-2" />
            <p className="text-sm text-mercury">Loading props...</p>
          </div>
        ) : !loading && props.length === 0 ? (
          <div className="p-8 text-center text-mercury text-sm">No props available for this market</div>
        ) : (
          props.map((prop, i) => {
            const isExpanded = expandedPlayer === prop.playerName;
            const analysis = playerAnalyses[prop.playerName];
            const isLoadingThis = loadingAnalysis === prop.playerName;

            return (
              <div key={i} className={`transition-colors ${isExpanded ? "bg-gunmetal/20" : ""}`}>
                {/* Main Row — clickable */}
                <button
                  onClick={() => togglePlayer(prop.playerName, prop.line, prop.team)}
                  className="w-full px-3 sm:px-4 py-3 flex items-center gap-3 hover:bg-gunmetal/30 active:bg-gunmetal/40 transition-colors text-left"
                >
                  {/* Player Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-silver truncate">{prop.playerName}</p>
                      {prop.team && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gunmetal text-mercury flex-shrink-0">
                          {prop.team}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-mercury/60">
                      {prop.gameTime && (
                        <span className="text-mercury/80">{new Date(prop.gameTime!).toLocaleString("en-US", { hour: "numeric", minute: "2-digit" })} — </span>
                      )}
                      {MARKET_LABELS[prop.market] ?? prop.market}
                    </p>
                  </div>

                  {/* Line */}
                  <span className="text-lg font-bold font-mono text-electric flex-shrink-0">{prop.line}</span>

                  {/* Best Over/Under */}
                  <div className="flex gap-1.5 flex-shrink-0">
                    <span className="text-xs font-mono text-neon bg-neon/10 px-1.5 py-0.5 rounded">
                      O {formatOdds(prop.bestOver.price)}
                    </span>
                    <span className="text-xs font-mono text-purple bg-purple/10 px-1.5 py-0.5 rounded">
                      U {formatOdds(prop.bestUnder.price)}
                    </span>
                  </div>

                  {/* Recommendation badge (if analyzed) */}
                  {analysis && (
                    <div className="hidden sm:flex flex-shrink-0">
                      {analysis.recommendation.side === "over" || analysis.recommendation.side === "lean_over" ? (
                        <ArrowUpRight className="w-4 h-4 text-neon" />
                      ) : analysis.recommendation.side === "under" || analysis.recommendation.side === "lean_under" ? (
                        <ArrowDownRight className="w-4 h-4 text-purple" />
                      ) : (
                        <Minus className="w-4 h-4 text-mercury/50" />
                      )}
                    </div>
                  )}

                  <ChevronDown className={`w-4 h-4 text-mercury/50 flex-shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                </button>

                {/* Expanded Detail Panel */}
                {isExpanded && (
                  <div className="px-3 sm:px-4 pb-4 animate-slide-up">
                    {isLoadingThis && !analysis ? (
                      <div className="flex items-center justify-center py-6 gap-2">
                        <RefreshCw className="w-4 h-4 text-mercury animate-spin" />
                        <span className="text-sm text-mercury">Analyzing {prop.playerName}...</span>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {/* All Books Odds Grid */}
                        <div className="rounded-lg bg-gunmetal/30 p-3">
                          <p className="text-[11px] text-mercury uppercase tracking-wider mb-2 font-semibold">Odds by Sportsbook</p>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                            {prop.books.map((book, bi) => {
                              const isBestOver = book.bookmaker === prop.bestOver.bookmaker && book.overPrice === prop.bestOver.price;
                              const isBestUnder = book.bookmaker === prop.bestUnder.bookmaker && book.underPrice === prop.bestUnder.price;
                              return (
                                <div key={bi} className="flex items-center justify-between px-2.5 py-2 rounded bg-bunker/60 border border-slate/20">
                                  <span className="text-[11px] font-medium text-mercury truncate mr-2">
                                    {getBookShort(book.bookmaker)}
                                  </span>
                                  <div className="flex gap-2 flex-shrink-0">
                                    <button
                                      onClick={() => {
                                        addParlayLeg({
                                          game: prop.playerName,
                                          market: "player_prop",
                                          pick: `${prop.playerName} Over ${prop.line} ${MARKET_LABELS[prop.market]}`,
                                          odds: book.overPrice,
                                          fairProb: prop.fairOverProb / 100,
                                          bookmaker: book.bookmaker,
                                        });
                                      }}
                                      className={`text-[11px] font-mono font-semibold px-1.5 py-0.5 rounded transition-all active:scale-95 ${
                                        isBestOver ? "best-odds" : "text-neon/80 hover:bg-neon/10"
                                      }`}
                                    >
                                      O {formatOdds(book.overPrice)}
                                    </button>
                                    <button
                                      onClick={() => {
                                        addParlayLeg({
                                          game: prop.playerName,
                                          market: "player_prop",
                                          pick: `${prop.playerName} Under ${prop.line} ${MARKET_LABELS[prop.market]}`,
                                          odds: book.underPrice,
                                          fairProb: prop.fairUnderProb / 100,
                                          bookmaker: book.bookmaker,
                                        });
                                      }}
                                      className={`text-[11px] font-mono font-semibold px-1.5 py-0.5 rounded transition-all active:scale-95 ${
                                        isBestUnder ? "best-odds" : "text-purple/80 hover:bg-purple/10"
                                      }`}
                                    >
                                      U {formatOdds(book.underPrice)}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Analysis Section */}
                        {analysis && (
                          <>
                            {/* Player Season Stats */}
                            <div className="rounded-lg bg-gunmetal/30 p-3">
                              <div className="flex items-center gap-2 mb-2">
                                <BarChart3 className="w-3.5 h-3.5 text-electric" />
                                <p className="text-[11px] text-mercury uppercase tracking-wider font-semibold">
                                  {analysis.player.name} — {analysis.player.team}
                                </p>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-electric/10 text-electric">
                                  {analysis.player.position}
                                </span>
                              </div>
                              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                                {analysis.player.ppg !== undefined && (
                                  <>
                                    <StatBox label="PPG" value={analysis.player.ppg?.toFixed(1) ?? "—"} />
                                    <StatBox label="RPG" value={analysis.player.rpg?.toFixed(1) ?? "—"} />
                                    <StatBox label="APG" value={analysis.player.apg?.toFixed(1) ?? "—"} />
                                    <StatBox label="HIT%" value={`${analysis.player.hitRates?.[selectedMarket]?.rate ?? 50}%`} />
                                  </>
                                )}
                                {analysis.player.era !== undefined && (
                                  <>
                                    <StatBox label="ERA" value={analysis.player.era.toFixed(2)} />
                                    <StatBox label="K/9" value={analysis.player.k9?.toFixed(1) ?? "—"} />
                                    <StatBox label="WHIP" value={analysis.player.whip?.toFixed(2) ?? "—"} />
                                    <StatBox label="Avg K/G" value={analysis.player.avgStrikeoutsPerGame?.toFixed(1) ?? "—"} />
                                  </>
                                )}
                                {analysis.player.avg !== undefined && (
                                  <>
                                    <StatBox label="AVG" value={analysis.player.avg.toFixed(3)} />
                                    <StatBox label="OPS" value={analysis.player.ops?.toFixed(3) ?? "—"} />
                                    <StatBox label="H/G" value={analysis.player.hitsPerGame?.toFixed(1) ?? "—"} />
                                    <StatBox label="TB/G" value={analysis.player.tbPerGame?.toFixed(1) ?? "—"} />
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Last 10 Games Sparkline */}
                            {(analysis.last10Games?.length ?? 0) > 0 && (
                            <div className="rounded-lg bg-gunmetal/30 p-3">
                              <div className="flex items-center gap-2 mb-2">
                                <Clock className="w-3.5 h-3.5 text-amber" />
                                <p className="text-[11px] text-mercury uppercase tracking-wider font-semibold">
                                  Last {analysis.last10Games?.length ?? 0} Games
                                </p>
                                {(analysis.vsOpponent?.games ?? 0) > 0 && (
                                  <span className="text-[10px] text-amber ml-auto">
                                    vs Opp: {analysis.vsOpponent.avgStat?.toFixed(1) ?? "?"} avg ({analysis.vsOpponent.games}g)
                                  </span>
                                )}
                              </div>
                              <div className="flex items-end gap-1 h-16">
                                {analysis.last10Games.map((game, gi) => {
                                  const statKey = MARKET_STAT_KEY[selectedMarket] || "strikeouts";
                                  const val = (game as any)[statKey] ?? 0;
                                  const maxVal = Math.max(...analysis.last10Games.map((g: any) => g[statKey] ?? 0), prop.line + 2);
                                  const height = maxVal > 0 ? (val / maxVal) * 100 : 0;
                                  const isOver = val > prop.line;
                                  return (
                                    <div key={gi} className="flex-1 flex flex-col items-center gap-0.5" title={`${game.opponent}: ${val}`}>
                                      <span className="text-[8px] font-mono text-mercury/50">{val}</span>
                                      <div
                                        className={`w-full rounded-t transition-all ${isOver ? "bg-neon/60" : "bg-danger/40"}`}
                                        style={{ height: `${Math.max(height, 8)}%` }}
                                      />
                                      <span className="text-[7px] text-mercury/40 truncate w-full text-center">
                                        {game.opponent?.split(" ").pop()?.slice(0, 3)}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                              {/* Line marker */}
                              <div className="relative h-0 -mt-8">
                                <div className="absolute w-full border-t border-dashed border-electric/40" style={{
                                  bottom: `${(prop.line / Math.max(...(analysis.last10Games ?? []).map((g: any) => (g as any)[MARKET_STAT_KEY[selectedMarket] || "strikeouts"] ?? 0), prop.line + 2)) * 64}px`
                                }} />
                              </div>
                            </div>
                            )}

                            {/* NBA-specific stats display */}
                            {analysis.player?.ppg !== undefined && (
                              <div className="rounded-lg bg-gunmetal/30 p-3">
                                <div className="flex items-center gap-3 mb-2">
                                  {analysis.player.photo && (
                                    <img src={analysis.player.photo} alt={analysis.player.name} className="w-12 h-12 rounded-lg object-cover bg-gunmetal/50" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                                  )}
                                  <div>
                                    <p className="text-xs font-semibold text-silver">{analysis.player.name}</p>
                                    <p className="text-[10px] text-mercury">{analysis.player.teamAbbrev} • {analysis.player.position} • #{analysis.player.number}</p>
                                  </div>
                                </div>
                                <div className="grid grid-cols-4 gap-1.5">
                                  <StatBox label="PPG" value={analysis.player.ppg?.toFixed(1) ?? "—"} />
                                  <StatBox label="RPG" value={analysis.player.rpg?.toFixed(1) ?? "—"} />
                                  <StatBox label="APG" value={analysis.player.apg?.toFixed(1) ?? "—"} />
                                  <StatBox label="HIT%" value={`${analysis.player.hitRates?.[selectedMarket]?.rate ?? 50}%`} />
                                </div>
                              </div>
                            )}

                            {/* Recommendation */}
                            {analysis.recommendation && (
                            <div className={`rounded-lg p-3 border ${
                              analysis.recommendation.side?.includes("over") ? "bg-neon/5 border-neon/20" :
                              analysis.recommendation.side?.includes("under") ? "bg-purple/5 border-purple/20" :
                              "bg-gunmetal/30 border-slate/20"
                            }`}>
                              <div className="flex items-center gap-2 mb-2">
                                <Target className="w-4 h-4 text-gold" />
                                <span className={`text-sm font-bold ${SIDE_LABELS[analysis.recommendation.side].color}`}>
                                  {SIDE_LABELS[analysis.recommendation.side].label}
                                </span>
                                <div className="ml-auto flex items-center gap-1">
                                  <span className="text-[10px] text-mercury">Confidence:</span>
                                  <div className="w-16 h-1.5 bg-gunmetal rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${
                                        analysis.recommendation.confidence > 50 ? "bg-neon" :
                                        analysis.recommendation.confidence > 25 ? "bg-amber" : "bg-mercury"
                                      }`}
                                      style={{ width: `${analysis.recommendation.confidence}%` }}
                                    />
                                  </div>
                                  <span className="text-[10px] font-mono text-mercury">{analysis.recommendation.confidence}%</span>
                                </div>
                              </div>
                              <div className="space-y-1">
                                {(analysis.recommendation.reasons ?? []).map((reason: string, ri: number) => (
                                  <div key={ri} className="flex items-start gap-1.5">
                                    <span className="text-electric text-[10px] mt-0.5">{'>'}</span>
                                    <p className="text-xs text-mercury">{reason}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                            )}
                          </>
                        )}

                        {/* Quick bet buttons */}
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => handleAddProp(prop, "over")}
                            className="flex items-center justify-center gap-2 py-2.5 rounded-lg bg-neon/10 border border-neon/20 text-neon text-sm font-semibold hover:bg-neon/20 active:scale-[0.98] transition-all"
                          >
                            <ArrowUpRight className="w-4 h-4" />
                            Over {prop.line} ({formatOdds(prop.bestOver.price)})
                          </button>
                          <button
                            onClick={() => handleAddProp(prop, "under")}
                            className="flex items-center justify-center gap-2 py-2.5 rounded-lg bg-purple/10 border border-purple/20 text-purple text-sm font-semibold hover:bg-purple/20 active:scale-[0.98] transition-all"
                          >
                            <ArrowDownRight className="w-4 h-4" />
                            Under {prop.line} ({formatOdds(prop.bestUnder.price)})
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center p-1.5 rounded bg-bunker/50">
      <p className="text-sm font-bold font-mono text-silver">{value}</p>
      <p className="text-[9px] text-mercury/60 uppercase">{label}</p>
    </div>
  );
}

function SeasonStatsGrid({ stats }: { stats: any }) {
  // NBA player
  if (stats.ppg !== undefined) {
    return (
      <>
        <StatBox label="PPG" value={stats.ppg?.toFixed(1) ?? "—"} />
        <StatBox label="RPG" value={stats.rpg?.toFixed(1) ?? "—"} />
        <StatBox label="APG" value={stats.apg?.toFixed(1) ?? "—"} />
        <StatBox label="FG%" value={stats.fgPct?.toFixed(1) ?? "—"} />
        <StatBox label="3P%" value={stats.threePct?.toFixed(1) ?? "—"} />
        <StatBox label="FT%" value={stats.ftPct?.toFixed(1) ?? "—"} />
        <StatBox label="MPG" value={stats.mpg?.toFixed(1) ?? "—"} />
        <StatBox label="GP" value={String(stats.gamesPlayed ?? 0)} />
      </>
    );
  }
  // MLB Pitcher
  if (stats.era !== undefined) {
    return (
      <>
        <StatBox label="ERA" value={stats.era?.toFixed(2) ?? "—"} />
        <StatBox label="K/9" value={stats.k9?.toFixed(1) ?? "—"} />
        <StatBox label="WHIP" value={stats.whip?.toFixed(2) ?? "—"} />
        <StatBox label="K/G" value={stats.avgStrikeoutsPerGame?.toFixed(1) ?? "—"} />
        {stats.wins !== undefined && <StatBox label="W" value={String(stats.wins)} />}
        {stats.losses !== undefined && <StatBox label="L" value={String(stats.losses)} />}
        {stats.strikeouts !== undefined && <StatBox label="K" value={String(stats.strikeouts)} />}
        {stats.gamesPlayed !== undefined && <StatBox label="GP" value={String(stats.gamesPlayed)} />}
      </>
    );
  }
  // MLB Batter
  if (stats.avg !== undefined) {
    return (
      <>
        <StatBox label="AVG" value={stats.avg?.toFixed(3) ?? "—"} />
        <StatBox label="OPS" value={stats.ops?.toFixed(3) ?? "—"} />
        <StatBox label="Hits" value={String(stats.hits ?? 0)} />
        <StatBox label="HR" value={String(stats.homeRuns ?? 0)} />
        <StatBox label="RBI" value={String(stats.rbi ?? 0)} />
        <StatBox label="H/G" value={stats.hitsPerGame?.toFixed(2) ?? "—"} />
        <StatBox label="TB/G" value={stats.tbPerGame?.toFixed(2) ?? "—"} />
        <StatBox label="SB" value={String(stats.stolenBases ?? 0)} />
      </>
    );
  }
  return <StatBox label="GP" value={String(stats.gamesPlayed ?? 0)} />;
}
