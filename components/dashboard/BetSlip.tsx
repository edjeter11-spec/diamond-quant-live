"use client";

import { useState, useEffect } from "react";
import { X, DollarSign, CheckCircle } from "lucide-react";
import { useStore } from "@/lib/store";
import type { BetRecord } from "@/lib/model/types";

interface BetSlipPrefill {
  game?: string;
  pick?: string;
  odds?: number;
  bookmaker?: string;
  market?: string;
  evAtPlacement?: number;
}

interface BetSlipProps {
  isOpen: boolean;
  onClose: () => void;
  prefill?: BetSlipPrefill;
}

const BOOKMAKERS = [
  "DraftKings",
  "FanDuel",
  "BetMGM",
  "PointsBet",
  "Caesars",
  "Other",
];

const MARKETS: BetRecord["market"][] = [
  "moneyline",
  "spread",
  "total",
  "player_prop",
];

export default function BetSlip({ isOpen, onClose, prefill }: BetSlipProps) {
  const addBet = useStore((s) => s.addBet);

  const [game, setGame] = useState("");
  const [pick, setPick] = useState("");
  const [bookmaker, setBookmaker] = useState(BOOKMAKERS[0]);
  const [odds, setOdds] = useState("");
  const [stake, setStake] = useState("");
  const [market, setMarket] = useState<string>(MARKETS[0]);
  const [isParlay, setIsParlay] = useState(false);
  const [evAtPlacement, setEvAtPlacement] = useState(0);
  const [showSuccess, setShowSuccess] = useState(false);

  // Reset / prefill when the modal opens
  useEffect(() => {
    if (isOpen) {
      setGame(prefill?.game ?? "");
      setPick(prefill?.pick ?? "");
      setBookmaker(prefill?.bookmaker ?? BOOKMAKERS[0]);
      setOdds(prefill?.odds != null ? String(prefill.odds) : "");
      setStake("");
      setMarket(prefill?.market ?? MARKETS[0]);
      setIsParlay(false);
      setEvAtPlacement(prefill?.evAtPlacement ?? 0);
      setShowSuccess(false);
    }
  }, [isOpen, prefill]);

  if (!isOpen) return null;

  const canSubmit =
    game.trim() !== "" &&
    pick.trim() !== "" &&
    odds !== "" &&
    stake !== "" &&
    Number(stake) > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;

    addBet({
      game: game.trim(),
      pick: pick.trim(),
      bookmaker,
      odds: Number(odds),
      stake: Number(stake),
      market,
      isParlay,
      result: "pending",
      payout: 0,
      evAtPlacement,
    });

    setShowSuccess(true);
    setTimeout(() => {
      setShowSuccess(false);
      onClose();
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Card */}
      <div className="relative w-full max-w-md glass rounded-xl border border-slate/40 shadow-2xl animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate/40">
          <div className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-neon" />
            <h2 className="text-base font-semibold text-silver">Place Bet</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate/30 transition-colors"
          >
            <X className="w-4 h-4 text-mercury" />
          </button>
        </div>

        {/* Success overlay */}
        {showSuccess ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <CheckCircle className="w-12 h-12 text-neon" />
            <p className="text-sm font-semibold text-neon">Bet Placed!</p>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-4">
            {/* Game */}
            <div>
              <label className="block text-xs text-mercury mb-1 uppercase tracking-wider">
                Game
              </label>
              <input
                type="text"
                value={game}
                onChange={(e) => setGame(e.target.value)}
                placeholder="e.g. NYY vs BOS"
                className="w-full px-3 py-2 rounded-lg bg-bunker border border-slate/50 text-silver text-sm placeholder:text-mercury/40 focus:outline-none focus:border-neon/50 transition-colors"
              />
            </div>

            {/* Pick */}
            <div>
              <label className="block text-xs text-mercury mb-1 uppercase tracking-wider">
                Pick
              </label>
              <input
                type="text"
                value={pick}
                onChange={(e) => setPick(e.target.value)}
                placeholder="e.g. NYY ML"
                className="w-full px-3 py-2 rounded-lg bg-bunker border border-slate/50 text-silver text-sm placeholder:text-mercury/40 focus:outline-none focus:border-neon/50 transition-colors"
              />
            </div>

            {/* Bookmaker + Market row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-mercury mb-1 uppercase tracking-wider">
                  Bookmaker
                </label>
                <select
                  value={bookmaker}
                  onChange={(e) => setBookmaker(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-bunker border border-slate/50 text-silver text-sm focus:outline-none focus:border-neon/50 transition-colors appearance-none cursor-pointer"
                >
                  {BOOKMAKERS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-mercury mb-1 uppercase tracking-wider">
                  Market
                </label>
                <select
                  value={market}
                  onChange={(e) => setMarket(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-bunker border border-slate/50 text-silver text-sm focus:outline-none focus:border-neon/50 transition-colors appearance-none cursor-pointer"
                >
                  {MARKETS.map((m) => (
                    <option key={m} value={m}>
                      {m === "player_prop"
                        ? "Player Prop"
                        : m.charAt(0).toUpperCase() + m.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Odds + Stake row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-mercury mb-1 uppercase tracking-wider">
                  Odds (American)
                </label>
                <input
                  type="number"
                  value={odds}
                  onChange={(e) => setOdds(e.target.value)}
                  placeholder="+150 or -110"
                  className="w-full px-3 py-2 rounded-lg bg-bunker border border-slate/50 text-silver text-sm font-mono placeholder:text-mercury/40 focus:outline-none focus:border-neon/50 transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs text-mercury mb-1 uppercase tracking-wider">
                  Stake
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-mercury text-sm">
                    $
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={stake}
                    onChange={(e) => setStake(e.target.value)}
                    placeholder="0.00"
                    className="w-full pl-7 pr-3 py-2 rounded-lg bg-bunker border border-slate/50 text-silver text-sm font-mono placeholder:text-mercury/40 focus:outline-none focus:border-neon/50 transition-colors"
                  />
                </div>
              </div>
            </div>

            {/* Parlay toggle */}
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isParlay}
                onChange={(e) => setIsParlay(e.target.checked)}
                className="w-4 h-4 rounded border-slate/50 bg-bunker text-neon focus:ring-neon/30 focus:ring-offset-0 accent-neon"
              />
              <span className="text-sm text-mercury">This is a parlay</span>
            </label>

            {/* Submit */}
            <button
              disabled={!canSubmit}
              onClick={handleSubmit}
              className={`w-full py-3 rounded-xl text-sm font-semibold transition-all ${
                canSubmit
                  ? "bg-neon/15 border border-neon/30 text-neon hover:bg-neon/25 active:scale-[0.98]"
                  : "bg-slate/20 border border-slate/20 text-mercury/40 cursor-not-allowed"
              }`}
            >
              Place Bet
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
