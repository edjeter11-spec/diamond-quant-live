"use client";

import { useStore } from "@/lib/store";
import { Wallet, TrendingUp, TrendingDown, Trophy, Target, BarChart3 } from "lucide-react";
import { useState } from "react";

export default function BankrollTracker() {
  const { bankroll, betHistory, setBankroll } = useStore();
  const [editingBankroll, setEditingBankroll] = useState(false);
  const [inputValue, setInputValue] = useState(String(bankroll.startingBankroll));

  const handleSetBankroll = () => {
    const amount = parseFloat(inputValue);
    if (amount > 0) {
      setBankroll(amount);
      setEditingBankroll(false);
    }
  };

  const profitLoss = bankroll.currentBankroll - bankroll.startingBankroll;
  const isProfit = profitLoss >= 0;

  const winRate = bankroll.totalBets > 0
    ? ((bankroll.wins / (bankroll.wins + bankroll.losses)) * 100).toFixed(1)
    : "0.0";

  return (
    <div className="glass rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wallet className="w-5 h-5 text-gold" />
          <h3 className="text-sm font-semibold text-silver uppercase tracking-wide">Bankroll</h3>
        </div>
        <button
          onClick={() => setEditingBankroll(!editingBankroll)}
          className="text-xs text-mercury hover:text-silver transition-colors"
        >
          {editingBankroll ? "Cancel" : "Edit"}
        </button>
      </div>

      {/* Bankroll Input */}
      {editingBankroll && (
        <div className="px-4 py-3 border-b border-slate/30 flex items-center gap-2">
          <span className="text-sm text-mercury">$</span>
          <input
            type="number"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className="flex-1 bg-gunmetal/50 border border-slate/30 rounded px-3 py-1.5 text-sm font-mono text-silver focus:outline-none focus:border-neon/30"
            placeholder="Starting bankroll"
          />
          <button
            onClick={handleSetBankroll}
            className="px-3 py-1.5 bg-neon/20 text-neon text-xs font-semibold rounded hover:bg-neon/30 transition-colors"
          >
            Set
          </button>
        </div>
      )}

      <div className="p-4 space-y-4">
        {/* Current Bankroll */}
        <div className="text-center">
          <p className="text-xs text-mercury uppercase tracking-wider mb-1">Current Bankroll</p>
          <p className={`text-3xl font-bold font-mono ${isProfit ? "text-neon" : "text-danger"}`}>
            ${bankroll.currentBankroll.toFixed(2)}
          </p>
          <div className="flex items-center justify-center gap-1 mt-1">
            {isProfit ? (
              <TrendingUp className="w-3.5 h-3.5 text-neon" />
            ) : (
              <TrendingDown className="w-3.5 h-3.5 text-danger" />
            )}
            <span className={`text-sm font-mono ${isProfit ? "text-neon" : "text-danger"}`}>
              {isProfit ? "+" : ""}{profitLoss.toFixed(2)} ({bankroll.roi.toFixed(1)}% ROI)
            </span>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-2">
          <div className="p-2.5 rounded-lg bg-gunmetal/40 text-center">
            <p className="text-lg font-bold font-mono text-silver">{bankroll.totalBets}</p>
            <p className="text-[10px] text-mercury uppercase">Total Bets</p>
          </div>
          <div className="p-2.5 rounded-lg bg-gunmetal/40 text-center">
            <p className="text-lg font-bold font-mono text-silver">{winRate}%</p>
            <p className="text-[10px] text-mercury uppercase">Win Rate</p>
          </div>
          <div className="p-2.5 rounded-lg bg-gunmetal/40 text-center">
            <p className="text-lg font-bold font-mono text-neon">{bankroll.wins}</p>
            <p className="text-[10px] text-mercury uppercase">Wins</p>
          </div>
          <div className="p-2.5 rounded-lg bg-gunmetal/40 text-center">
            <p className="text-lg font-bold font-mono text-danger">{bankroll.losses}</p>
            <p className="text-[10px] text-mercury uppercase">Losses</p>
          </div>
        </div>

        {/* Recent Bets */}
        {betHistory.length > 0 && (
          <div>
            <p className="text-xs text-mercury uppercase tracking-wider mb-2">Recent Bets</p>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {betHistory.slice(-5).reverse().map((bet) => (
                <div key={bet.id} className="flex items-center justify-between px-2 py-1.5 rounded bg-gunmetal/30">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-silver truncate">{bet.pick}</p>
                    <p className="text-[10px] text-mercury/60">{bet.bookmaker}</p>
                  </div>
                  <div className="flex items-center gap-2 ml-2">
                    <span className="text-xs font-mono text-mercury">${bet.stake}</span>
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                      bet.result === "win" ? "bg-neon/15 text-neon" :
                      bet.result === "loss" ? "bg-danger/15 text-danger" :
                      bet.result === "push" ? "bg-mercury/15 text-mercury" :
                      "bg-amber/15 text-amber"
                    }`}>
                      {bet.result}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
