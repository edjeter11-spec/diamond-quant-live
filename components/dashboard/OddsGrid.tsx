"use client";

import { useStore } from "@/lib/store";
import { useSport } from "@/lib/sport-context";
import { getDeepLink } from "@/lib/odds/sportsbooks";
import { ExternalLink } from "lucide-react";

interface OddsGridProps {
  gameId: string;
}

export default function OddsGrid({ gameId }: OddsGridProps) {
  const { oddsData, addParlayLeg } = useStore();
  const { currentSport } = useSport();
  const gameOdds = oddsData.find((g: any) => g.id === gameId);

  if (!gameOdds) {
    return (
      <div className="glass rounded-xl p-6 text-center text-mercury">
        Select a game to view odds across books
      </div>
    );
  }

  const { oddsLines, bestLines, homeTeam, awayTeam } = gameOdds;

  const formatOdds = (odds: number) => {
    if (odds === 0) return "—";
    return odds > 0 ? `+${odds}` : `${odds}`;
  };

  const isBestOdds = (bookmaker: string, odds: number, bestLine: any) => {
    return bestLine && bookmaker === bestLine.bookmaker && odds === bestLine.odds;
  };

  const handleClickOdds = (
    bookmaker: string,
    odds: number,
    market: "moneyline" | "spread" | "total",
    pick: string,
    fairProb: number
  ) => {
    addParlayLeg({
      game: `${awayTeam} @ ${homeTeam}`,
      market,
      pick,
      odds,
      fairProb,
      bookmaker,
    });
  };

  const awayShort = awayTeam?.split(" ").pop() ?? "Away";
  const homeShort = homeTeam?.split(" ").pop() ?? "Home";

  return (
    <div className="glass rounded-xl overflow-hidden">
      <div className="px-3 sm:px-4 py-2.5 sm:py-3 border-b border-slate/50">
        <h3 className="text-sm font-semibold text-silver tracking-wide uppercase">
          Live Odds Grid
        </h3>
        <p className="text-[11px] text-mercury mt-0.5">Tap odds to add to parlay</p>
      </div>

      {/* Desktop Table */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate/30">
              <th className="px-4 py-2 text-left text-xs text-mercury font-medium uppercase tracking-wider w-32">
                Book
              </th>
              <th className="px-3 py-2 text-center text-xs text-mercury font-medium uppercase tracking-wider" colSpan={2}>
                Moneyline
              </th>
              <th className="px-3 py-2 text-center text-xs text-mercury font-medium uppercase tracking-wider" colSpan={2}>
                Run Line
              </th>
              <th className="px-3 py-2 text-center text-xs text-mercury font-medium uppercase tracking-wider" colSpan={2}>
                Total
              </th>
            </tr>
            <tr className="border-b border-slate/20">
              <th className="px-4 py-1" />
              <th className="px-3 py-1 text-[10px] text-mercury/60 font-normal">{awayShort}</th>
              <th className="px-3 py-1 text-[10px] text-mercury/60 font-normal">{homeShort}</th>
              <th className="px-3 py-1 text-[10px] text-mercury/60 font-normal">Away</th>
              <th className="px-3 py-1 text-[10px] text-mercury/60 font-normal">Home</th>
              <th className="px-3 py-1 text-[10px] text-mercury/60 font-normal">Over</th>
              <th className="px-3 py-1 text-[10px] text-mercury/60 font-normal">Under</th>
            </tr>
          </thead>
          <tbody>
            {oddsLines?.map((line: any, idx: number) => (
              <tr key={idx} className="border-b border-slate/10 hover:bg-gunmetal/50 transition-colors">
                <td className="px-4 py-2.5">
                  {getDeepLink(line.bookmakerKey || line.bookmaker, { sport: currentSport as "mlb" | "nba" }) ? (
                    <a
                      href={getDeepLink(line.bookmakerKey || line.bookmaker, { sport: currentSport as "mlb" | "nba" })}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-silver hover:text-neon transition-colors inline-flex items-center gap-1 group"
                    >
                      {line.bookmaker}
                      <ExternalLink className="w-3 h-3 text-mercury/30 group-hover:text-neon/50" />
                    </a>
                  ) : (
                    <span className="text-sm font-medium text-silver">{line.bookmaker}</span>
                  )}
                </td>
                <td className="px-1 py-1.5 text-center">
                  <button
                    onClick={() => handleClickOdds(line.bookmaker, line.awayML, "moneyline", `${awayTeam} ML`, 0.5)}
                    className={`inline-block px-3 py-1.5 rounded font-mono text-sm font-semibold transition-all hover:scale-105 ${
                      isBestOdds(line.bookmaker, line.awayML, bestLines?.bestAwayML)
                        ? "best-odds" : "text-silver hover:bg-slate/30"
                    }`}
                  >
                    {formatOdds(line.awayML)}
                  </button>
                </td>
                <td className="px-1 py-1.5 text-center">
                  <button
                    onClick={() => handleClickOdds(line.bookmaker, line.homeML, "moneyline", `${homeTeam} ML`, 0.5)}
                    className={`inline-block px-3 py-1.5 rounded font-mono text-sm font-semibold transition-all hover:scale-105 ${
                      isBestOdds(line.bookmaker, line.homeML, bestLines?.bestHomeML)
                        ? "best-odds" : "text-silver hover:bg-slate/30"
                    }`}
                  >
                    {formatOdds(line.homeML)}
                  </button>
                </td>
                <td className="px-1 py-1.5 text-center">
                  <button
                    onClick={() => handleClickOdds(line.bookmaker, line.spreadPrice, "spread", `${awayTeam} ${line.awaySpread > 0 ? "+" : ""}${line.awaySpread}`, 0.5)}
                    className="inline-block px-2 py-1.5 rounded font-mono text-xs text-mercury hover:bg-slate/30 transition-all"
                  >
                    <span className="text-electric">{line.awaySpread > 0 ? "+" : ""}{line.awaySpread}</span>{" "}
                    <span className="text-silver">{formatOdds(line.spreadPrice)}</span>
                  </button>
                </td>
                <td className="px-1 py-1.5 text-center">
                  <button
                    onClick={() => handleClickOdds(line.bookmaker, line.spreadPrice, "spread", `${homeTeam} ${line.homeSpread}`, 0.5)}
                    className="inline-block px-2 py-1.5 rounded font-mono text-xs text-mercury hover:bg-slate/30 transition-all"
                  >
                    <span className="text-electric">{line.homeSpread}</span>{" "}
                    <span className="text-silver">{formatOdds(line.spreadPrice)}</span>
                  </button>
                </td>
                <td className="px-1 py-1.5 text-center">
                  <button
                    onClick={() => handleClickOdds(line.bookmaker, line.overPrice, "total", `Over ${line.total}`, 0.5)}
                    className={`inline-block px-2 py-1.5 rounded font-mono text-xs transition-all hover:bg-slate/30 ${
                      isBestOdds(line.bookmaker, line.overPrice, bestLines?.bestOver)
                        ? "best-odds" : "text-silver"
                    }`}
                  >
                    <span className="text-amber">O{line.total}</span> {formatOdds(line.overPrice)}
                  </button>
                </td>
                <td className="px-1 py-1.5 text-center">
                  <button
                    onClick={() => handleClickOdds(line.bookmaker, line.underPrice, "total", `Under ${line.total}`, 0.5)}
                    className={`inline-block px-2 py-1.5 rounded font-mono text-xs transition-all hover:bg-slate/30 ${
                      isBestOdds(line.bookmaker, line.underPrice, bestLines?.bestUnder)
                        ? "best-odds" : "text-silver"
                    }`}
                  >
                    <span className="text-purple">U{line.total}</span> {formatOdds(line.underPrice)}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Card Layout */}
      <div className="sm:hidden divide-y divide-slate/15">
        {oddsLines?.map((line: any, idx: number) => (
          <div key={idx} className="px-3 py-3">
            {/* Book name */}
            <p className="text-xs font-semibold text-silver mb-2">{line.bookmaker}</p>

            {/* Moneyline row */}
            <div className="grid grid-cols-2 gap-2 mb-2">
              <button
                onClick={() => handleClickOdds(line.bookmaker, line.awayML, "moneyline", `${awayTeam} ML`, 0.5)}
                className={`flex items-center justify-between px-3 py-2 rounded-lg transition-all active:scale-95 ${
                  isBestOdds(line.bookmaker, line.awayML, bestLines?.bestAwayML)
                    ? "best-odds" : "bg-gunmetal/40 text-silver"
                }`}
              >
                <span className="text-[11px] text-mercury/70">{awayShort}</span>
                <span className="font-mono text-sm font-bold">{formatOdds(line.awayML)}</span>
              </button>
              <button
                onClick={() => handleClickOdds(line.bookmaker, line.homeML, "moneyline", `${homeTeam} ML`, 0.5)}
                className={`flex items-center justify-between px-3 py-2 rounded-lg transition-all active:scale-95 ${
                  isBestOdds(line.bookmaker, line.homeML, bestLines?.bestHomeML)
                    ? "best-odds" : "bg-gunmetal/40 text-silver"
                }`}
              >
                <span className="text-[11px] text-mercury/70">{homeShort}</span>
                <span className="font-mono text-sm font-bold">{formatOdds(line.homeML)}</span>
              </button>
            </div>

            {/* Spread + Total row */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleClickOdds(line.bookmaker, line.spreadPrice, "spread", `${homeTeam} ${line.homeSpread}`, 0.5)}
                className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-gunmetal/25 text-mercury transition-all active:scale-95"
              >
                <span className="text-[10px]">RL</span>
                <span className="font-mono text-xs">
                  <span className="text-electric">{line.homeSpread}</span>{" "}
                  {formatOdds(line.spreadPrice)}
                </span>
              </button>
              <button
                onClick={() => handleClickOdds(line.bookmaker, line.overPrice, "total", `Over ${line.total}`, 0.5)}
                className={`flex items-center justify-between px-3 py-1.5 rounded-lg transition-all active:scale-95 ${
                  isBestOdds(line.bookmaker, line.overPrice, bestLines?.bestOver)
                    ? "best-odds" : "bg-gunmetal/25 text-mercury"
                }`}
              >
                <span className="text-[10px]">O/U</span>
                <span className="font-mono text-xs">
                  <span className="text-amber">O{line.total}</span>{" "}
                  {formatOdds(line.overPrice)}
                </span>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Visual Odds Comparison — ML bar chart */}
      {oddsLines && oddsLines.length >= 2 && (
        <div className="px-3 sm:px-4 py-3 border-t border-slate/20">
          <p className="text-[10px] text-mercury uppercase tracking-wider mb-2 font-semibold">ML Comparison Across Books</p>
          <div className="space-y-1.5">
            {/* Away ML bars */}
            <div>
              <p className="text-[9px] text-mercury/60 mb-1">{awayShort}</p>
              <div className="flex items-center gap-1">
                {oddsLines.map((line: any, i: number) => {
                  const allAway = oddsLines.map((l: any) => l.awayML).filter((o: number) => o !== 0);
                  const best = Math.max(...allAway);
                  const worst = Math.min(...allAway);
                  const range = Math.max(best - worst, 1);
                  const pct = worst < 0 ? ((line.awayML - worst) / range) * 100 : ((line.awayML - worst) / range) * 100;
                  const isBest = line.awayML === best;
                  return (
                    <div key={i} className="flex-1" title={`${line.bookmaker}: ${formatOdds(line.awayML)}`}>
                      <div className={`h-5 rounded flex items-center justify-center text-[8px] font-mono font-bold ${
                        isBest ? "bg-neon/30 text-neon" : "bg-gunmetal/50 text-mercury/70"
                      }`}>
                        {formatOdds(line.awayML)}
                      </div>
                      <p className="text-[7px] text-mercury/40 text-center mt-0.5 truncate">{line.bookmaker?.split(" ")[0]?.slice(0, 5)}</p>
                    </div>
                  );
                })}
              </div>
            </div>
            {/* Home ML bars */}
            <div>
              <p className="text-[9px] text-mercury/60 mb-1">{homeShort}</p>
              <div className="flex items-center gap-1">
                {oddsLines.map((line: any, i: number) => {
                  const allHome = oddsLines.map((l: any) => l.homeML).filter((o: number) => o !== 0);
                  const best = Math.max(...allHome);
                  const isBest = line.homeML === best;
                  return (
                    <div key={i} className="flex-1" title={`${line.bookmaker}: ${formatOdds(line.homeML)}`}>
                      <div className={`h-5 rounded flex items-center justify-center text-[8px] font-mono font-bold ${
                        isBest ? "bg-neon/30 text-neon" : "bg-gunmetal/50 text-mercury/70"
                      }`}>
                        {formatOdds(line.homeML)}
                      </div>
                      <p className="text-[7px] text-mercury/40 text-center mt-0.5 truncate">{line.bookmaker?.split(" ")[0]?.slice(0, 5)}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
