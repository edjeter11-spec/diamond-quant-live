"use client";

import { useEffect, useState } from "react";
import { Brain, TrendingUp, TrendingDown, Minus, Activity, CheckCircle, XCircle, Sparkles, RefreshCw, ArrowUpRight, ArrowDownRight, ExternalLink } from "lucide-react";
import { useStore } from "@/lib/store";
import MatchupInsights from "@/components/dashboard/MatchupInsights";
import { getDeepLink } from "@/lib/odds/sportsbooks";

export interface PropDetailProps {
  sport: "mlb" | "nba";
  playerName: string;
  market: string;          // e.g. pitcher_strikeouts, player_points
  line: number;
  side: "over" | "under";
  /** Optional over/under odds for the Add-to-Parlay buttons */
  overOdds?: number;
  underOdds?: number;
  overBook?: string;
  underBook?: string;
  overFairProb?: number;   // 0-1
  underFairProb?: number;  // 0-1
  /** Optional context to improve MLB matchup lookup */
  opponent?: string;
}

const LABEL_FOR_MARKET: Record<string, string> = {
  pitcher_strikeouts: "K",
  batter_hits: "H",
  batter_home_runs: "HR",
  batter_total_bases: "TB",
  player_points: "PTS",
  player_rebounds: "REB",
  player_assists: "AST",
};

export default function PropDetail({
  sport, playerName, market, line, side, opponent,
  overOdds, underOdds, overBook, underBook, overFairProb, underFairProb,
}: PropDetailProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const { addParlayLeg } = useStore();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const url = sport === "nba"
      ? `/api/nba-player?name=${encodeURIComponent(playerName)}&market=${market}&line=${line}`
      : `/api/player-analysis?name=${encodeURIComponent(playerName)}&market=${market}&line=${line}${opponent ? `&opponent=${encodeURIComponent(opponent)}` : ""}`;

    fetch(url)
      .then(r => r.json())
      .then(d => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) { setData(null); setLoading(false); } });

    return () => { cancelled = true; };
  }, [sport, playerName, market, line, opponent]);

  const generateAI = async () => {
    if (aiSummary || aiLoading) return;
    setAiLoading(true);
    try {
      // Reuse game-summary-ai with a player-props payload
      const statLabel = LABEL_FOR_MARKET[market] ?? market;
      const seasonAvg = data?.player?.statAvg?.[market] ?? data?.player?.[market.replace(/^.*?_/, "")] ?? null;
      const hitRate = data?.player?.hitRates?.[market]?.rate ?? null;
      const logSnippet = (data?.player?.gameLog ?? data?.last10Games ?? [])
        .slice(0, 5)
        .map((g: any) => `${g.date ?? g.opponent}: ${getStatFromLog(g, market)}`).join(", ");

      const prompt = {
        game: `${playerName} ${side === "over" ? "Over" : "Under"} ${line} ${statLabel}`,
        reasoning: [
          seasonAvg != null ? `Season avg: ${seasonAvg.toFixed(1)}` : null,
          hitRate != null ? `Hits line in ${hitRate.toFixed(0)}% of recent games` : null,
          logSnippet ? `Last 5: ${logSnippet}` : null,
          ...(data?.recommendation?.reasons ?? []),
        ].filter(Boolean),
        history: data?.last10Games?.slice(0, 3).map((g: any) => `${g.opponent}: ${getStatFromLog(g, market)}`) ?? [],
        aiTip: `Give a 2-sentence assessment on whether to take this ${side} bet.`,
        gameId: `prop-${playerName}-${market}`.toLowerCase().replace(/\s+/g, "-"),
      };

      const res = await fetch("/api/game-summary-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prompt),
      });
      const result = await res.json();
      setAiSummary(result.summary ?? buildLocalAnalysis(data, sport, market, line, side, playerName));
    } catch {
      setAiSummary(buildLocalAnalysis(data, sport, market, line, side, playerName));
    }
    setAiLoading(false);
  };

  if (loading) {
    return (
      <div className="p-4 text-center animate-pulse">
        <Activity className="w-5 h-5 text-purple/40 mx-auto mb-2 animate-pulse" />
        <p className="text-xs text-mercury/60">Loading {playerName}&apos;s stats...</p>
      </div>
    );
  }

  if (!data || data.error) {
    return (
      <div className="p-4 text-center">
        <p className="text-xs text-mercury/60">Stats unavailable for {playerName}.</p>
      </div>
    );
  }

  // Unify NBA vs MLB shapes
  const isNBA = sport === "nba";
  const gameLog = isNBA ? (data.player?.gameLog ?? []) : (data.last10Games ?? []);
  const seasonAvg = getSeasonAvg(data, sport, market);
  const last5 = gameLog.slice(0, 5);
  const last5Avg = last5.length > 0
    ? last5.reduce((s: number, g: any) => s + (getStatFromLog(g, market) ?? 0), 0) / last5.length
    : 0;
  const hitRate = computeHitRate(gameLog, market, line);
  const reasons: string[] = isNBA
    ? (data.player?.trend ? [data.player.trend] : [])
    : (data.recommendation?.reasons ?? []);
  const recommendation = isNBA ? null : data.recommendation;

  const nbaPlayer = isNBA ? data.player ?? {} : {};
  const brainProj = data.brainProjection ?? null;
  const hitRateData = nbaPlayer.hitRates?.[market];
  const effectiveHitRate = hitRate > 0 ? hitRate : (hitRateData?.rate ?? 0);

  return (
    <div className="p-3 space-y-3 animate-slide-up">
      {/* Key numbers */}
      <div className="grid grid-cols-4 gap-1.5">
        <StatTile label="Line" value={line.toFixed(1)} />
        <StatTile label="Season" value={seasonAvg.toFixed(1)} accent={seasonAvg > line === (side === "over") ? "good" : "neutral"} />
        <StatTile
          label={gameLog.length > 0 ? "Last 5" : "Proj"}
          value={(gameLog.length > 0 ? last5Avg : (brainProj?.projectedValue ?? seasonAvg)).toFixed(1)}
          accent={((gameLog.length > 0 ? last5Avg : brainProj?.projectedValue ?? 0) > line) === (side === "over") ? "good" : "neutral"}
        />
        <StatTile label="Hit %" value={`${effectiveHitRate.toFixed(0)}%`} accent={effectiveHitRate >= 60 ? "good" : effectiveHitRate <= 40 ? "bad" : "neutral"} />
      </div>

      {/* NBA extra stats — shows fg%/3pt%/ft%/mpg when game log isn't available */}
      {isNBA && (
        <div className="grid grid-cols-4 gap-1.5">
          <StatTile label="PPG" value={(nbaPlayer.ppg ?? 0).toFixed(1)} />
          <StatTile label="RPG" value={(nbaPlayer.rpg ?? 0).toFixed(1)} />
          <StatTile label="APG" value={(nbaPlayer.apg ?? 0).toFixed(1)} />
          <StatTile label="MPG" value={(nbaPlayer.mpg ?? 0).toFixed(1)} />
        </div>
      )}
      {isNBA && (nbaPlayer.fgPct || nbaPlayer.threePct || nbaPlayer.ftPct) && (
        <div className="grid grid-cols-3 gap-1.5">
          <StatTile label="FG%" value={`${((nbaPlayer.fgPct ?? 0) * 100).toFixed(1)}%`} />
          <StatTile label="3PT%" value={`${((nbaPlayer.threePct ?? 0) * 100).toFixed(1)}%`} />
          <StatTile label="FT%" value={`${((nbaPlayer.ftPct ?? 0) * 100).toFixed(1)}%`} />
        </div>
      )}

      {/* Brain projection card — only for NBA when brain weighed in */}
      {isNBA && brainProj && (
        <div className={`rounded-lg p-3 border ${brainProj.side === side ? "border-neon/25 bg-neon/5" : "border-amber/25 bg-amber/5"}`}>
          <div className="flex items-center gap-1.5 mb-2">
            <Brain className={`w-3.5 h-3.5 ${brainProj.side === side ? "text-neon" : "text-amber"}`} />
            <span className={`text-[11px] font-bold uppercase tracking-wider ${brainProj.side === side ? "text-neon" : "text-amber"}`}>
              {brainProj.side === side ? `Brain agrees — ${side.toUpperCase()}` : `Brain leans ${brainProj.side.toUpperCase()}`}
            </span>
            <span className="ml-auto text-[10px] text-mercury/60">{Math.round((brainProj.confidence ?? 0))}% conf</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5 mb-2">
            <StatTile label="Projected" value={(brainProj.projectedValue ?? 0).toFixed(1)} accent="good" />
            <StatTile label="Probability" value={`${Math.round((brainProj.probability ?? 0) * 100)}%`} />
            <StatTile label="Edge vs Line" value={`${((brainProj.projectedValue ?? 0) - line > 0 ? "+" : "")}${((brainProj.projectedValue ?? 0) - line).toFixed(1)}`} accent={((brainProj.projectedValue ?? 0) - line > 0) === (side === "over") ? "good" : "neutral"} />
          </div>
          {Array.isArray(brainProj.reasoning) && brainProj.reasoning.length > 0 && (
            <ul className="space-y-1 mt-2 pt-2 border-t border-slate/20">
              {brainProj.reasoning.slice(0, 4).map((r: string, i: number) => (
                <li key={i} className="text-[10px] text-mercury/80 flex items-start gap-1">
                  <span className="text-mercury/40 mt-0.5">·</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Last N games */}
      {gameLog.length > 0 && (
        <div className="rounded-lg bg-gunmetal/30 border border-slate/15 p-2.5">
          <p className="text-[10px] text-mercury/60 uppercase tracking-wider font-semibold mb-2">
            Last {Math.min(gameLog.length, 10)} games
          </p>
          <div className="flex items-end gap-1 h-16">
            {gameLog.slice(0, 10).reverse().map((g: any, i: number) => {
              const val = getStatFromLog(g, market) ?? 0;
              const max = Math.max(...gameLog.slice(0, 10).map((x: any) => getStatFromLog(x, market) ?? 0), line, 1);
              const h = Math.max(6, (val / max) * 56);
              const beatLine = val >= line;
              return (
                <div
                  key={i}
                  className="flex-1 flex flex-col items-center justify-end gap-0.5"
                  title={`${g.date ?? g.opponent ?? ""}: ${val}`}
                >
                  <div
                    className={`w-full rounded-sm ${beatLine ? "bg-neon/70" : "bg-mercury/30"}`}
                    style={{ height: `${h}px` }}
                  />
                  <span className="text-[7px] text-mercury/40">{val}</span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-2 mt-2 text-[9px] text-mercury/50">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-neon/70 inline-block" /> hit line
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-mercury/30 inline-block" /> missed
            </span>
          </div>
        </div>
      )}

      {/* Matchup Insights — rolling averages, hit rate, trend, dynamic advice */}
      {gameLog.length > 0 && (
        <MatchupInsights
          playerName={playerName}
          market={market}
          line={line}
          gameLog={gameLog}
          seasonAvg={seasonAvg}
          vsOpponent={data.vsOpponent}
        />
      )}

      {/* Recommendation + reasoning */}
      {recommendation && recommendation.reasons?.length > 0 && (
        <div className={`rounded-lg p-2.5 border ${
          recommendation.side === side ? "border-neon/25 bg-neon/5" : "border-amber/25 bg-amber/5"
        }`}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Brain className={`w-3.5 h-3.5 ${recommendation.side === side ? "text-neon" : "text-amber"}`} />
            <p className={`text-[11px] font-bold uppercase tracking-wider ${recommendation.side === side ? "text-neon" : "text-amber"}`}>
              {recommendation.side === side
                ? `Model agrees with this ${side}`
                : `Model leans ${recommendation.side.replace("_", " ")}`}
            </p>
            <span className="ml-auto text-[10px] text-mercury/60">
              {Math.round((recommendation.confidence ?? 0) * 100)}% conf
            </span>
          </div>
          <ul className="space-y-1">
            {recommendation.reasons.slice(0, 4).map((r: string, i: number) => (
              <li key={i} className="text-[10px] text-mercury/80 flex items-start gap-1">
                <span className="text-mercury/40 mt-0.5">·</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isNBA && reasons.length > 0 && (
        <div className="rounded-lg p-2.5 border border-purple/20 bg-purple/5">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Brain className="w-3.5 h-3.5 text-purple" />
            <p className="text-[11px] font-bold text-purple uppercase tracking-wider">Brain read</p>
          </div>
          <ul className="space-y-1">
            {reasons.slice(0, 4).map((r, i) => (
              <li key={i} className="text-[10px] text-mercury/80 flex items-start gap-1">
                <span className="text-mercury/40 mt-0.5">·</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* AI analysis */}
      <div className="rounded-lg border border-electric/20 bg-electric/5 p-2.5">
        {aiSummary ? (
          <div className="flex items-start gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-electric flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-silver leading-relaxed">{aiSummary}</p>
          </div>
        ) : (
          <button
            onClick={generateAI}
            disabled={aiLoading}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] text-electric font-semibold hover:bg-electric/10 rounded transition-colors disabled:opacity-60"
          >
            {aiLoading ? (
              <>
                <RefreshCw className="w-3 h-3 animate-spin" />
                Generating AI analysis...
              </>
            ) : (
              <>
                <Sparkles className="w-3 h-3" />
                Generate AI analysis
              </>
            )}
          </button>
        )}
      </div>

      {/* Open-in-sportsbook deep-link row */}
      <div className="flex items-center gap-1.5 pt-1">
        <span className="text-[10px] text-mercury/60 uppercase tracking-wider flex-shrink-0">Bet on</span>
        {(["draftkings", "fanduel", "betmgm"] as const).map((book) => {
          const href = getDeepLink(book, { sport });
          const labels: Record<string, string> = { draftkings: "DraftKings", fanduel: "FanDuel", betmgm: "BetMGM" };
          return (
            <a
              key={book}
              href={href || "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-gunmetal/40 border border-slate/25 hover:border-electric/40 hover:bg-electric/10 text-silver text-[10px] font-semibold transition-colors"
            >
              {labels[book]} <ExternalLink className="w-2.5 h-2.5" />
            </a>
          );
        })}
      </div>

      {/* Add to Parlay — Over only for markets where Under is dead money (HRs) */}
      {market === "batter_home_runs" ? (
        <button
          onClick={() => addParlayLeg({
            game: playerName,
            market: "player_prop" as any,
            pick: `${playerName} Over ${line} ${(LABEL_FOR_MARKET[market] ?? "").toUpperCase()}`,
            odds: overOdds ?? -110,
            fairProb: overFairProb ?? 0.5,
            bookmaker: overBook ?? "best price",
          })}
          className="flex items-center justify-center gap-1 py-2 rounded-lg bg-neon/15 border border-neon/30 text-neon hover:bg-neon/25 text-[11px] font-semibold transition-colors"
        >
          <ArrowUpRight className="w-3 h-3" /> Over {line}
          {overOdds != null && <span className="text-[10px] opacity-70">({overOdds > 0 ? "+" : ""}{overOdds})</span>}
        </button>
      ) : (
        <div className="grid grid-cols-2 gap-1.5 pt-1">
          <button
            onClick={() => addParlayLeg({
              game: playerName,
              market: "player_prop" as any,
              pick: `${playerName} Over ${line} ${(LABEL_FOR_MARKET[market] ?? "").toUpperCase()}`,
              odds: overOdds ?? -110,
              fairProb: overFairProb ?? 0.5,
              bookmaker: overBook ?? "best price",
            })}
            className={`flex items-center justify-center gap-1 py-2 rounded-lg text-[11px] font-semibold transition-colors ${
              side === "over"
                ? "bg-neon/15 border border-neon/30 text-neon hover:bg-neon/25"
                : "bg-gunmetal/40 border border-slate/25 text-mercury hover:text-silver"
            }`}
          >
            <ArrowUpRight className="w-3 h-3" /> Over {line}
            {overOdds != null && <span className="text-[10px] opacity-70">({overOdds > 0 ? "+" : ""}{overOdds})</span>}
          </button>
          <button
            onClick={() => addParlayLeg({
              game: playerName,
              market: "player_prop" as any,
              pick: `${playerName} Under ${line} ${(LABEL_FOR_MARKET[market] ?? "").toUpperCase()}`,
              odds: underOdds ?? -110,
              fairProb: underFairProb ?? 0.5,
              bookmaker: underBook ?? "best price",
            })}
            className={`flex items-center justify-center gap-1 py-2 rounded-lg text-[11px] font-semibold transition-colors ${
              side === "under"
                ? "bg-purple/15 border border-purple/30 text-purple hover:bg-purple/25"
                : "bg-gunmetal/40 border border-slate/25 text-mercury hover:text-silver"
            }`}
          >
            <ArrowDownRight className="w-3 h-3" /> Under {line}
            {underOdds != null && <span className="text-[10px] opacity-70">({underOdds > 0 ? "+" : ""}{underOdds})</span>}
          </button>
        </div>
      )}
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────

function StatTile({ label, value, accent = "neutral" }: { label: string; value: string; accent?: "good" | "bad" | "neutral" }) {
  const color = accent === "good" ? "text-neon" : accent === "bad" ? "text-danger" : "text-silver";
  return (
    <div className="text-center p-1.5 rounded bg-bunker/50 border border-slate/15">
      <p className={`text-sm font-bold font-mono ${color}`}>{value}</p>
      <p className="text-[9px] text-mercury/60 uppercase">{label}</p>
    </div>
  );
}

function getStatFromLog(g: any, market: string): number {
  if (!g) return 0;
  if (market === "player_points") return g.points ?? g.pts ?? 0;
  if (market === "player_rebounds") return g.rebounds ?? g.reb ?? 0;
  if (market === "player_assists") return g.assists ?? g.ast ?? 0;
  if (market === "pitcher_strikeouts") return g.strikeouts ?? g.K ?? 0;
  if (market === "batter_hits") return g.hitsB ?? g.hits ?? 0;
  if (market === "batter_home_runs") return g.homeRuns ?? g.HR ?? 0;
  if (market === "batter_total_bases") return g.totalBases ?? g.TB ?? 0;
  return 0;
}

function getSeasonAvg(data: any, sport: "mlb" | "nba", market: string): number {
  if (sport === "nba") {
    const p = data.player ?? {};
    if (market === "player_points") return p.ppg ?? 0;
    if (market === "player_rebounds") return p.rpg ?? 0;
    if (market === "player_assists") return p.apg ?? 0;
  } else {
    const p = data.player ?? {};
    if (market === "pitcher_strikeouts") return p.avgStrikeoutsPerGame ?? 0;
    if (market === "batter_hits") return p.hitsPerGame ?? 0;
    if (market === "batter_home_runs") return (p.homeRuns && p.gamesPlayed ? p.homeRuns / p.gamesPlayed : 0);
    if (market === "batter_total_bases") return p.tbPerGame ?? 0;
  }
  return 0;
}

function buildLocalAnalysis(
  data: any, sport: "mlb" | "nba", market: string, line: number, side: "over" | "under", playerName: string,
): string {
  const label = sport === "nba"
    ? (market === "player_points" ? "points" : market === "player_rebounds" ? "rebounds" : market === "player_assists" ? "assists" : market.replace("player_", ""))
    : (market === "pitcher_strikeouts" ? "strikeouts" : market.replace("batter_", "").replace(/_/g, " "));
  const p = data?.player ?? {};
  const seasonAvg = getSeasonAvg(data, sport, market);
  const brain = data?.brainProjection;
  const projected = brain?.projectedValue;
  const conf = brain?.confidence ? Math.round(brain.confidence) : null;
  const hitRate = p.hitRates?.[market]?.rate;
  const diff = seasonAvg - line;
  const direction = diff > 0 ? "above" : "below";
  const abs = Math.abs(diff).toFixed(1);

  const parts: string[] = [];
  parts.push(`${playerName} averages ${seasonAvg.toFixed(1)} ${label} this season, ${abs} ${direction} the ${line} line.`);
  if (projected != null) {
    const brainAgree = brain.side === side;
    parts.push(`The brain projects ${projected.toFixed(1)} (${conf ?? "—"}% confidence) — ${brainAgree ? "backing" : "fading"} the ${side}.`);
  } else if (hitRate != null) {
    parts.push(`Hits the ${line} line in roughly ${hitRate}% of recent games.`);
  }
  return parts.join(" ");
}

function computeHitRate(log: any[], market: string, line: number): number {
  const recent = log.slice(0, 10);
  if (recent.length === 0) return 0;
  const hits = recent.filter(g => getStatFromLog(g, market) >= line).length;
  return (hits / recent.length) * 100;
}
