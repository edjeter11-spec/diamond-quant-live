"use client";

import { useEffect, useState } from "react";
import { Brain, TrendingUp, TrendingDown, Minus, Activity, CheckCircle, XCircle, Sparkles, RefreshCw } from "lucide-react";

export interface PropDetailProps {
  sport: "mlb" | "nba";
  playerName: string;
  market: string;          // e.g. pitcher_strikeouts, player_points
  line: number;
  side: "over" | "under";
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

export default function PropDetail({ sport, playerName, market, line, side, opponent }: PropDetailProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

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
      setAiSummary(result.summary ?? "AI analysis unavailable.");
    } catch {
      setAiSummary("AI analysis unavailable — try again in a moment.");
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

  return (
    <div className="p-3 space-y-3 animate-slide-up">
      {/* Key numbers */}
      <div className="grid grid-cols-4 gap-1.5">
        <StatTile label="Line" value={line.toFixed(1)} />
        <StatTile label="Season" value={seasonAvg.toFixed(1)} accent={seasonAvg > line === (side === "over") ? "good" : "neutral"} />
        <StatTile label="Last 5" value={last5Avg.toFixed(1)} accent={last5Avg > line === (side === "over") ? "good" : "neutral"} />
        <StatTile label="Hit %" value={`${hitRate.toFixed(0)}%`} accent={hitRate >= 60 ? "good" : hitRate <= 40 ? "bad" : "neutral"} />
      </div>

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

function computeHitRate(log: any[], market: string, line: number): number {
  const recent = log.slice(0, 10);
  if (recent.length === 0) return 0;
  const hits = recent.filter(g => getStatFromLog(g, market) >= line).length;
  return (hits / recent.length) * 100;
}
