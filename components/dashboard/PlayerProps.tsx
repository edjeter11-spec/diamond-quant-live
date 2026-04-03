"use client";

import { useState, useEffect } from "react";
import { useStore } from "@/lib/store";
import { BOOK_DISPLAY } from "@/lib/odds/the-odds-api";
import {
  User, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight,
  RefreshCw, ChevronDown, ChevronUp, Target, BarChart3, Clock,
  Minus, Star, AlertCircle, Zap,
} from "lucide-react";

interface PropLine {
  playerName: string;
  line: number;
  market: string;
  team: string;
  books: Array<{ bookmaker: string; overPrice: number; underPrice: number }>;
  bestOver: { bookmaker: string; price: number };
  bestUnder: { bookmaker: string; price: number };
  fairOverProb: number;
  fairUnderProb: number;
}

interface PlayerAnalysis {
  player: {
    name: string; team: string; teamAbbrev: string; position: string;
    gamesPlayed: number; era?: number; whip?: number; strikeouts?: number;
    k9?: number; avgStrikeoutsPerGame?: number; avg?: number; ops?: number;
    hits?: number; homeRuns?: number; rbi?: number; hitsPerGame?: number; tbPerGame?: number;
  };
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
  const [props, setProps] = useState<PropLine[]>([]);
  const [selectedMarket, setSelectedMarket] = useState("pitcher_strikeouts");
  const [loading, setLoading] = useState(true);
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null);
  const [playerAnalyses, setPlayerAnalyses] = useState<Record<string, PlayerAnalysis>>({});
  const [loadingAnalysis, setLoadingAnalysis] = useState<string | null>(null);

  useEffect(() => {
    fetchProps();
    setExpandedPlayer(null);
    setPlayerAnalyses({});
  }, [selectedMarket]);

  async function fetchProps() {
    setLoading(true);
    try {
      const res = await fetch(`/api/players?market=${selectedMarket}`);
      const data = await res.json();
      setProps(data.props ?? []);
    } catch {
      setProps([]);
    }
    setLoading(false);
  }

  async function fetchAnalysis(playerName: string, line: number, team: string) {
    if (playerAnalyses[playerName]) return; // already fetched
    setLoadingAnalysis(playerName);
    try {
      const params = new URLSearchParams({
        name: playerName,
        market: selectedMarket,
        line: String(line),
        ...(team ? { opponent: team } : {}),
      });
      const res = await fetch(`/api/player-analysis?${params}`);
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

        {/* Market Filter */}
        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-0.5">
          {Object.entries(MARKET_LABELS).map(([key, label]) => (
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

      {/* Props List */}
      <div className="divide-y divide-slate/15">
        {loading ? (
          <div className="p-8 text-center">
            <RefreshCw className="w-6 h-6 text-mercury/30 animate-spin mx-auto mb-2" />
            <p className="text-sm text-mercury">Loading props...</p>
          </div>
        ) : props.length === 0 ? (
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
                    <p className="text-[11px] text-mercury/60">{MARKET_LABELS[prop.market] ?? prop.market}</p>
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
                            <div className="rounded-lg bg-gunmetal/30 p-3">
                              <div className="flex items-center gap-2 mb-2">
                                <Clock className="w-3.5 h-3.5 text-amber" />
                                <p className="text-[11px] text-mercury uppercase tracking-wider font-semibold">
                                  Last {analysis.last10Games.length} Games
                                </p>
                                {analysis.vsOpponent.games > 0 && (
                                  <span className="text-[10px] text-amber ml-auto">
                                    vs Opp: {analysis.vsOpponent.avgStat.toFixed(1)} avg ({analysis.vsOpponent.games}g)
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
                                  bottom: `${(prop.line / Math.max(...analysis.last10Games.map((g: any) => (g as any)[MARKET_STAT_KEY[selectedMarket] || "strikeouts"] ?? 0), prop.line + 2)) * 64}px`
                                }} />
                              </div>
                            </div>

                            {/* Recommendation */}
                            <div className={`rounded-lg p-3 border ${
                              analysis.recommendation.side.includes("over") ? "bg-neon/5 border-neon/20" :
                              analysis.recommendation.side.includes("under") ? "bg-purple/5 border-purple/20" :
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
                                {analysis.recommendation.reasons.map((reason, ri) => (
                                  <div key={ri} className="flex items-start gap-1.5">
                                    <span className="text-electric text-[10px] mt-0.5">{'>'}</span>
                                    <p className="text-xs text-mercury">{reason}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
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
