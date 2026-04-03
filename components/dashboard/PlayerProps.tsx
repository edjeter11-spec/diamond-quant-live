"use client";

import { useState, useEffect } from "react";
import { useStore } from "@/lib/store";
import { User, TrendingUp, ArrowUpRight, ArrowDownRight, Filter, RefreshCw } from "lucide-react";

interface PropLine {
  playerName: string;
  line: number;
  market: string;
  books: Array<{ bookmaker: string; overPrice: number; underPrice: number }>;
  bestOver: { bookmaker: string; price: number };
  bestUnder: { bookmaker: string; price: number };
  fairOverProb: number;
  fairUnderProb: number;
}

const MARKET_LABELS: Record<string, string> = {
  pitcher_strikeouts: "Strikeouts",
  batter_hits: "Hits",
  batter_total_bases: "Total Bases",
  batter_home_runs: "Home Runs",
  batter_rbis: "RBIs",
  batter_runs_scored: "Runs",
  batter_stolen_bases: "Stolen Bases",
  pitcher_outs: "Outs Recorded",
};

export default function PlayerProps() {
  const { addParlayLeg } = useStore();
  const [props, setProps] = useState<PropLine[]>([]);
  const [selectedMarket, setSelectedMarket] = useState("pitcher_strikeouts");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProps();
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

  const formatOdds = (odds: number) => (odds > 0 ? `+${odds}` : `${odds}`);

  const handleAddToProp = (prop: PropLine, side: "over" | "under") => {
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
      <div className="px-4 py-3 border-b border-slate/50">
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
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(MARKET_LABELS).slice(0, 5).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSelectedMarket(key)}
              className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
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
      <div className="divide-y divide-slate/20">
        {loading ? (
          <div className="p-6 text-center">
            <RefreshCw className="w-6 h-6 text-mercury/30 animate-spin mx-auto mb-2" />
            <p className="text-sm text-mercury">Loading props...</p>
          </div>
        ) : props.length === 0 ? (
          <div className="p-6 text-center text-mercury text-sm">No props available</div>
        ) : (
          props.map((prop, i) => (
            <div key={i} className="px-4 py-3 hover:bg-gunmetal/30 transition-colors">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-sm font-semibold text-silver">{prop.playerName}</p>
                  <p className="text-xs text-mercury/70">{MARKET_LABELS[prop.market] ?? prop.market}</p>
                </div>
                <span className="text-lg font-bold font-mono text-electric">{prop.line}</span>
              </div>

              <div className="flex gap-2">
                {/* Over */}
                <button
                  onClick={() => handleAddToProp(prop, "over")}
                  className="flex-1 flex items-center justify-between px-3 py-2 rounded-lg bg-gunmetal/50 hover:bg-neon/10 hover:border-neon/20 border border-transparent transition-all group"
                >
                  <div className="flex items-center gap-1.5">
                    <ArrowUpRight className="w-3.5 h-3.5 text-neon" />
                    <span className="text-xs text-mercury group-hover:text-neon transition-colors">Over</span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-mono font-semibold text-silver group-hover:text-neon transition-colors">
                      {formatOdds(prop.bestOver.price)}
                    </span>
                    <p className="text-[9px] text-mercury/50">{prop.bestOver.bookmaker}</p>
                  </div>
                </button>

                {/* Under */}
                <button
                  onClick={() => handleAddToProp(prop, "under")}
                  className="flex-1 flex items-center justify-between px-3 py-2 rounded-lg bg-gunmetal/50 hover:bg-purple/10 hover:border-purple/20 border border-transparent transition-all group"
                >
                  <div className="flex items-center gap-1.5">
                    <ArrowDownRight className="w-3.5 h-3.5 text-purple" />
                    <span className="text-xs text-mercury group-hover:text-purple transition-colors">Under</span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-mono font-semibold text-silver group-hover:text-purple transition-colors">
                      {formatOdds(prop.bestUnder.price)}
                    </span>
                    <p className="text-[9px] text-mercury/50">{prop.bestUnder.bookmaker}</p>
                  </div>
                </button>
              </div>

              {/* Fair prob bar */}
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-gunmetal rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-neon to-electric rounded-full"
                    style={{ width: `${prop.fairOverProb}%` }}
                  />
                </div>
                <span className="text-[10px] font-mono text-mercury/60">
                  {prop.fairOverProb}% / {prop.fairUnderProb}%
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
