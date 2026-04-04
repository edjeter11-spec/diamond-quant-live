"use client";

import { useState, useRef, useCallback } from "react";
import { useStore } from "@/lib/store";
import {
  Camera, Upload, X, CheckCircle, RefreshCw, AlertTriangle,
  DollarSign, Layers, Target, Zap,
} from "lucide-react";

interface ScannedSlip {
  sportsbook: string | null;
  betType: string;
  stake: number;
  toWin: number;
  odds: number;
  legs: Array<{
    game: string;
    pick: string;
    odds: number;
    market: string;
  }>;
  status: string;
}

export default function SnapSync() {
  const { addBet } = useStore();
  const [mode, setMode] = useState<"idle" | "scanning" | "review" | "success" | "error">("idle");
  const [slip, setSlip] = useState<ScannedSlip | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setMode("scanning");
    setErrorMsg("");

    // Convert to base64
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result as string;
      setPreview(base64);

      try {
        const res = await fetch("/api/scan-slip", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: base64 }),
        });

        const data = await res.json();

        if (data.success && data.slip) {
          setSlip(data.slip);
          setMode("review");
        } else {
          setErrorMsg(data.error ?? "Couldn't read the slip — try a clearer screenshot");
          setMode("error");
        }
      } catch (err) {
        setErrorMsg("Scan failed — check your connection");
        setMode("error");
      }
    };
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) handleFile(file);
  }, [handleFile]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) handleFile(file);
        break;
      }
    }
  }, [handleFile]);

  const confirmBet = () => {
    if (!slip) return;

    if (slip.betType === "parlay" && slip.legs.length > 1) {
      // Log as parlay
      addBet({
        game: slip.legs.map(l => l.game).join(" + "),
        market: "parlay",
        pick: slip.legs.map(l => l.pick).join(" / "),
        bookmaker: slip.sportsbook ?? "Unknown",
        odds: slip.odds,
        stake: slip.stake,
        result: "pending",
        payout: 0,
        isParlay: true,
        parlayLegs: slip.legs.map(l => l.pick),
        evAtPlacement: 0,
      });
    } else {
      // Log as straight bet
      const leg = slip.legs[0];
      addBet({
        game: leg?.game ?? "",
        market: leg?.market ?? "moneyline",
        pick: leg?.pick ?? slip.betType,
        bookmaker: slip.sportsbook ?? "Unknown",
        odds: leg?.odds ?? slip.odds,
        stake: slip.stake,
        result: "pending",
        payout: 0,
        isParlay: false,
        evAtPlacement: 0,
      });
    }

    setMode("success");
    setTimeout(() => {
      setMode("idle");
      setSlip(null);
      setPreview(null);
    }, 2000);
  };

  const reset = () => {
    setMode("idle");
    setSlip(null);
    setPreview(null);
    setErrorMsg("");
  };

  const formatOdds = (odds: number) => {
    if (!odds) return "—";
    return odds > 0 ? `+${odds}` : `${odds}`;
  };

  return (
    <div className="glass rounded-xl overflow-hidden" onPaste={handlePaste}>
      <div className="px-4 py-3 border-b border-slate/50 flex items-center gap-2">
        <Camera className="w-5 h-5 text-electric" />
        <div>
          <h3 className="text-sm font-semibold text-silver uppercase tracking-wide">Snap & Sync</h3>
          <p className="text-[10px] text-mercury/60">Screenshot your bet slip — AI reads it instantly</p>
        </div>
      </div>

      <div className="p-4">
        {/* Idle — Drop zone */}
        {mode === "idle" && (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-slate/30 rounded-xl p-6 text-center cursor-pointer hover:border-electric/40 hover:bg-electric/5 transition-all"
          >
            <Upload className="w-8 h-8 text-mercury/30 mx-auto mb-2" />
            <p className="text-sm text-mercury font-medium">Drop a screenshot or tap to upload</p>
            <p className="text-[10px] text-mercury/50 mt-1">Works with DraftKings, FanDuel, BetMGM, and more</p>
            <p className="text-[10px] text-electric mt-2">Or paste a screenshot (Ctrl+V / Cmd+V)</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
          </div>
        )}

        {/* Scanning */}
        {mode === "scanning" && (
          <div className="text-center py-6">
            {preview && (
              <div className="w-32 h-32 mx-auto mb-3 rounded-lg overflow-hidden border border-slate/30">
                <img src={preview} alt="Scanning" className="w-full h-full object-cover opacity-50" />
              </div>
            )}
            <RefreshCw className="w-6 h-6 text-electric animate-spin mx-auto mb-2" />
            <p className="text-sm text-electric font-medium">Reading your bet slip...</p>
            <p className="text-[10px] text-mercury/50 mt-1">AI is extracting teams, odds, and stakes</p>
          </div>
        )}

        {/* Review */}
        {mode === "review" && slip && (
          <div className="space-y-3 animate-slide-up">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-electric/5 border border-electric/15">
              <Zap className="w-4 h-4 text-electric" />
              <p className="text-xs text-electric font-medium">
                Found a {slip.legs.length > 1 ? `${slip.legs.length}-leg parlay` : "straight bet"} on {slip.sportsbook ?? "Unknown"}
              </p>
            </div>

            {/* Slip preview */}
            <div className="rounded-lg bg-gunmetal/30 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-mercury uppercase">{slip.sportsbook}</span>
                <span className="text-xs font-mono text-silver">{slip.betType?.toUpperCase()}</span>
              </div>

              {slip.legs.map((leg, i) => (
                <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded bg-bunker/50">
                  <span className="w-4 h-4 rounded-full bg-electric/15 text-electric text-[9px] font-bold flex items-center justify-center flex-shrink-0">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-silver truncate">{leg.pick}</p>
                    <p className="text-[9px] text-mercury/60 truncate">{leg.game} • {leg.market}</p>
                  </div>
                  <span className="text-xs font-mono text-silver">{formatOdds(leg.odds)}</span>
                </div>
              ))}

              <div className="flex items-center justify-between pt-2 border-t border-slate/20">
                <div>
                  <p className="text-[9px] text-mercury">Risk</p>
                  <p className="text-sm font-mono font-bold text-silver">${slip.stake}</p>
                </div>
                <div className="text-center">
                  <p className="text-[9px] text-mercury">Odds</p>
                  <p className="text-sm font-mono font-bold text-electric">{formatOdds(slip.odds)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[9px] text-mercury">To Win</p>
                  <p className="text-sm font-mono font-bold text-neon">${slip.toWin}</p>
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              <button
                onClick={reset}
                className="flex-1 py-2.5 rounded-lg bg-gunmetal/50 border border-slate/30 text-mercury text-xs font-semibold hover:bg-gunmetal/70 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmBet}
                className="flex-1 py-2.5 rounded-lg bg-neon/15 border border-neon/25 text-neon text-xs font-bold hover:bg-neon/25 active:scale-[0.98] transition-all flex items-center justify-center gap-1.5"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                Confirm & Log
              </button>
            </div>
          </div>
        )}

        {/* Success */}
        {mode === "success" && (
          <div className="text-center py-6 animate-slide-up">
            <CheckCircle className="w-10 h-10 text-neon mx-auto mb-2" />
            <p className="text-sm text-neon font-semibold">Bet logged!</p>
            <p className="text-[10px] text-mercury/50 mt-1">Added to your bankroll — will auto-settle when the game ends</p>
          </div>
        )}

        {/* Error */}
        {mode === "error" && (
          <div className="text-center py-6">
            <AlertTriangle className="w-8 h-8 text-danger/50 mx-auto mb-2" />
            <p className="text-sm text-danger">{errorMsg}</p>
            <button onClick={reset} className="mt-3 px-4 py-2 rounded-lg bg-gunmetal/50 text-mercury text-xs hover:bg-gunmetal/70 transition-colors">
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
