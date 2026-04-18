"use client";

import { useEffect, useState } from "react";
import { ArrowUp, ArrowDown, Zap } from "lucide-react";
import { useSport } from "@/lib/sport-context";

interface Movement {
  game_id: string;
  bookmaker: string;
  market: string; // "ML" | "Spread" | "Total"
  from: number;
  to: number;
  delta: number;
  direction: "up" | "down";
  minutes_ago: number;
  is_sharp: boolean;
}

// Cache movements per sport in-module so every badge shares one fetch.
let cache: { sport: string; movements: Movement[]; ts: number } | null = null;
let inflight: Promise<Movement[]> | null = null;

async function loadMovements(sport: string): Promise<Movement[]> {
  if (cache && cache.sport === sport && Date.now() - cache.ts < 90_000) {
    return cache.movements;
  }
  if (inflight) return inflight;

  const apiSport = sport === "nba" ? "basketball_nba" : "baseball_mlb";
  inflight = fetch(`/api/sharp-money?sport=${apiSport}`)
    .then(r => r.ok ? r.json() : { movements: [] })
    .then(data => {
      const movements: Movement[] = data.movements ?? [];
      cache = { sport, movements, ts: Date.now() };
      return movements;
    })
    .catch(() => [])
    .finally(() => { inflight = null; });
  return inflight;
}

interface Props {
  gameId: string;
  market: string;        // "moneyline" | "spread" | "total"
  pickText?: string;     // optional — to determine direction intent (e.g. "Yankees ML")
  teamOrSide?: string;   // "home" | "away" | team abbrev — for direction interpretation
}

// Match UI market to odds_history market naming
function matchesMarket(uiMarket: string, histMarket: string): boolean {
  const m = uiMarket.toLowerCase();
  const h = histMarket.toLowerCase();
  if (m === "moneyline" && h === "ml") return true;
  if (m === "spread" && h === "spread") return true;
  if (m === "total" && h === "total") return true;
  return m === h;
}

export default function LineMovementBadge({ gameId, market }: Props) {
  const { currentSport } = useSport();
  const [movement, setMovement] = useState<Movement | null>(null);

  useEffect(() => {
    if (!gameId || !market) return;
    let cancelled = false;
    loadMovements(currentSport).then(movs => {
      if (cancelled) return;
      const match = movs
        .filter(m => m.game_id === gameId && matchesMarket(market, m.market))
        .sort((a, b) => b.delta - a.delta)[0]; // biggest move wins
      if (match) setMovement(match);
    });
    return () => { cancelled = true; };
  }, [gameId, market, currentSport]);

  if (!movement) return null;

  // Only show when the move is meaningful
  if (movement.delta < 0.5) return null;

  const Icon = movement.direction === "up" ? ArrowUp : ArrowDown;
  const color = movement.is_sharp
    ? "text-amber border-amber/40 bg-amber/10"
    : movement.direction === "up"
    ? "text-neon border-neon/30 bg-neon/10"
    : "text-danger border-danger/30 bg-danger/10";

  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded border text-[9px] font-bold font-mono ${color}`}
      title={`Line moved ${movement.direction} ${movement.delta}${movement.market === "ML" ? "%" : "pt"} in the last ${movement.minutes_ago}min${movement.is_sharp ? " — sharp action" : ""}`}
    >
      {movement.is_sharp && <Zap className="w-2.5 h-2.5" />}
      <Icon className="w-2.5 h-2.5" />
      {movement.delta}{movement.market === "ML" ? "%" : "pt"}
    </span>
  );
}
