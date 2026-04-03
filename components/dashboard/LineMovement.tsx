"use client";

import { Activity, ArrowUp, ArrowDown, Minus, Clock } from "lucide-react";

interface LineMove {
  bookmaker: string;
  market: string;
  oldOdds: number;
  newOdds: number;
  movement: number;
  time: string;
}

interface LineMovementProps {
  movements: LineMove[];
}

export default function LineMovement({ movements }: LineMovementProps) {
  return (
    <div className="glass rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate/50 flex items-center gap-2">
        <Activity className="w-5 h-5 text-amber" />
        <h3 className="text-sm font-semibold text-silver uppercase tracking-wide">Line Movement</h3>
        {movements.length > 0 && (
          <span className="px-1.5 py-0.5 bg-amber/15 text-amber text-[10px] font-bold rounded">
            {movements.length} moves
          </span>
        )}
      </div>

      {movements.length === 0 ? (
        <div className="p-5 text-center">
          <div className="w-10 h-10 rounded-full bg-gunmetal/50 flex items-center justify-center mx-auto mb-2">
            <Clock className="w-5 h-5 text-mercury/40" />
          </div>
          <p className="text-sm text-mercury">Collecting odds data...</p>
          <p className="text-xs text-mercury/50 mt-1 max-w-[200px] mx-auto">
            Line moves appear after ~5 min of tracking. Keep the page open and we'll catch every shift.
          </p>
          <div className="flex items-center justify-center gap-1.5 mt-3">
            <div className="w-1.5 h-1.5 rounded-full bg-amber/50 animate-pulse" />
            <span className="text-[10px] text-amber/60 font-mono">Monitoring all books</span>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-slate/10">
          {movements.map((move, i) => (
            <div key={i} className="px-4 py-2.5 flex items-center gap-3 hover:bg-gunmetal/30 transition-colors">
              <div className={`p-1.5 rounded ${
                move.movement > 0 ? "bg-neon/10" : move.movement < 0 ? "bg-danger/10" : "bg-mercury/10"
              }`}>
                {move.movement > 0 ? (
                  <ArrowUp className="w-3.5 h-3.5 text-neon" />
                ) : move.movement < 0 ? (
                  <ArrowDown className="w-3.5 h-3.5 text-danger" />
                ) : (
                  <Minus className="w-3.5 h-3.5 text-mercury" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-silver">{move.market}</p>
                <p className="text-xs text-mercury/60">{move.bookmaker}</p>
              </div>
              <div className="text-right">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-mono text-mercury/60 line-through">
                    {move.oldOdds > 0 ? `+${move.oldOdds}` : move.oldOdds}
                  </span>
                  <span className="text-xs text-mercury/40">→</span>
                  <span className={`text-sm font-mono font-semibold ${
                    move.movement > 0 ? "text-neon" : "text-danger"
                  }`}>
                    {move.newOdds > 0 ? `+${move.newOdds}` : move.newOdds}
                  </span>
                </div>
                <p className="text-[10px] text-mercury/40 mt-0.5">{move.time}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
