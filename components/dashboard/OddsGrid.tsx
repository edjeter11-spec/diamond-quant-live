"use client";

import { useStore } from "@/lib/store";
import { ArrowUpRight, ArrowDownRight, Star } from "lucide-react";

interface OddsGridProps {
  gameId: string;
}

export default function OddsGrid({ gameId }: OddsGridProps) {
  const { oddsData, addParlayLeg } = useStore();
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

  return (
    <div className="glass rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate/50">
        <h3 className="text-sm font-semibold text-silver tracking-wide uppercase">
          Live Odds Grid
        </h3>
        <p className="text-xs text-mercury mt-0.5">Click any odds to add to parlay builder</p>
      </div>

      <div className="overflow-x-auto">
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
              <th className="px-3 py-1 text-[10px] text-mercury/60 font-normal">{awayTeam?.split(" ").pop()}</th>
              <th className="px-3 py-1 text-[10px] text-mercury/60 font-normal">{homeTeam?.split(" ").pop()}</th>
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
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-silver">{line.bookmaker}</span>
                  </div>
                </td>
                {/* Away ML */}
                <td className="px-1 py-1.5 text-center">
                  <button
                    onClick={() => handleClickOdds(line.bookmaker, line.awayML, "moneyline", `${awayTeam} ML`, 0.5)}
                    className={`inline-block px-3 py-1.5 rounded font-mono text-sm font-semibold transition-all hover:scale-105 ${
                      isBestOdds(line.bookmaker, line.awayML, bestLines?.bestAwayML)
                        ? "best-odds"
                        : "text-silver hover:bg-slate/30"
                    }`}
                  >
                    {formatOdds(line.awayML)}
                  </button>
                </td>
                {/* Home ML */}
                <td className="px-1 py-1.5 text-center">
                  <button
                    onClick={() => handleClickOdds(line.bookmaker, line.homeML, "moneyline", `${homeTeam} ML`, 0.5)}
                    className={`inline-block px-3 py-1.5 rounded font-mono text-sm font-semibold transition-all hover:scale-105 ${
                      isBestOdds(line.bookmaker, line.homeML, bestLines?.bestHomeML)
                        ? "best-odds"
                        : "text-silver hover:bg-slate/30"
                    }`}
                  >
                    {formatOdds(line.homeML)}
                  </button>
                </td>
                {/* Away Spread */}
                <td className="px-1 py-1.5 text-center">
                  <button
                    onClick={() => handleClickOdds(line.bookmaker, line.spreadPrice, "spread", `${awayTeam} ${line.awaySpread > 0 ? "+" : ""}${line.awaySpread}`, 0.5)}
                    className="inline-block px-2 py-1.5 rounded font-mono text-xs text-mercury hover:bg-slate/30 transition-all"
                  >
                    <span className="text-electric">{line.awaySpread > 0 ? "+" : ""}{line.awaySpread}</span>{" "}
                    <span className="text-silver">{formatOdds(line.spreadPrice)}</span>
                  </button>
                </td>
                {/* Home Spread */}
                <td className="px-1 py-1.5 text-center">
                  <button
                    onClick={() => handleClickOdds(line.bookmaker, line.spreadPrice, "spread", `${homeTeam} ${line.homeSpread}`, 0.5)}
                    className="inline-block px-2 py-1.5 rounded font-mono text-xs text-mercury hover:bg-slate/30 transition-all"
                  >
                    <span className="text-electric">{line.homeSpread}</span>{" "}
                    <span className="text-silver">{formatOdds(line.spreadPrice)}</span>
                  </button>
                </td>
                {/* Over */}
                <td className="px-1 py-1.5 text-center">
                  <button
                    onClick={() => handleClickOdds(line.bookmaker, line.overPrice, "total", `Over ${line.total}`, 0.5)}
                    className={`inline-block px-2 py-1.5 rounded font-mono text-xs transition-all hover:bg-slate/30 ${
                      isBestOdds(line.bookmaker, line.overPrice, bestLines?.bestOver)
                        ? "best-odds"
                        : "text-silver"
                    }`}
                  >
                    <span className="text-amber">O{line.total}</span>{" "}
                    {formatOdds(line.overPrice)}
                  </button>
                </td>
                {/* Under */}
                <td className="px-1 py-1.5 text-center">
                  <button
                    onClick={() => handleClickOdds(line.bookmaker, line.underPrice, "total", `Under ${line.total}`, 0.5)}
                    className={`inline-block px-2 py-1.5 rounded font-mono text-xs transition-all hover:bg-slate/30 ${
                      isBestOdds(line.bookmaker, line.underPrice, bestLines?.bestUnder)
                        ? "best-odds"
                        : "text-silver"
                    }`}
                  >
                    <span className="text-purple">U{line.total}</span>{" "}
                    {formatOdds(line.underPrice)}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
