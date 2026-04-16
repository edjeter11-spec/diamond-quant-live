// ──────────────────────────────────────────────────────────
// Global State Management — Zustand + localStorage persistence
// ──────────────────────────────────────────────────────────

import { create } from "zustand";
import type { ParlayLeg, ParlaySlip, BetRecord, BankrollState, OddsLine } from "./model/types";
import { buildParlay } from "./model/parlay";
import { americanToImpliedProb } from "./model/kelly";

// localStorage helpers + cloud sync
function loadFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
}

// Throttle cloud sync to max 1 write per key per 2 minutes
const lastSyncTimes: Record<string, number> = {};

// Critical keys sync immediately for cross-device consistency
const IMMEDIATE_SYNC = new Set(["dq_bankroll", "dq_betHistory", "dq_savedParlays"]);

function saveToStorage(key: string, value: any) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
  // Immediate sync for bankroll/bets/parlays, throttled for everything else
  if (IMMEDIATE_SYNC.has(key)) {
    syncToCloud(key, value);
  } else {
    const now = Date.now();
    if (!lastSyncTimes[key] || now - lastSyncTimes[key] > 120000) {
      lastSyncTimes[key] = now;
      syncToCloud(key, value);
    }
  }
}

async function syncToCloud(key: string, value: any) {
  try {
    const { cloudSet } = await import("@/lib/supabase/client");
    await cloudSet(key.replace("dq_", ""), value);
  } catch {}
}

const DEFAULT_BANKROLL: BankrollState = {
  startingBankroll: 1000,
  currentBankroll: 1000,
  totalBets: 0,
  wins: 0,
  losses: 0,
  pushes: 0,
  totalStaked: 0,
  totalReturns: 0,
  roi: 0,
  clv: 0,
  sharpScore: 0,
  streak: 0,
  bestBet: null,
  worstBet: null,
};

// Odds snapshot for line movement
interface OddsSnapshot {
  timestamp: string;
  lines: Record<string, OddsLine[]>; // gameId -> odds
}

interface AppState {
  // UI State
  selectedGameId: string | null;
  activeTab: "dashboard" | "nrfi" | "bot" | "parlays" | "props" | "bankroll" | "room" | "profile";
  sidebarOpen: boolean;

  // Live Data
  games: any[];
  oddsData: any[];
  scores: any[];
  lastUpdate: string | null;
  isLoading: boolean;

  // Parlay Builder
  parlayLegs: ParlayLeg[];
  currentParlay: ParlaySlip | null;
  savedParlays: ParlaySlip[];

  // Bankroll (persisted)
  bankroll: BankrollState;
  betHistory: BetRecord[];

  // Line Movement
  oddsSnapshots: OddsSnapshot[];

  // Room
  roomId: string | null;
  roomUsers: Array<{ id: string; name: string; isOnline: boolean }>;

  // Actions
  selectGame: (id: string | null) => void;
  setActiveTab: (tab: AppState["activeTab"]) => void;
  toggleSidebar: () => void;
  setGames: (games: any[]) => void;
  setOddsData: (odds: any[]) => void;
  setScores: (scores: any[]) => void;
  setLoading: (loading: boolean) => void;

  // Parlay Actions
  addParlayLeg: (leg: Omit<ParlayLeg, "id" | "impliedProb">) => void;
  removeParlayLeg: (legId: string) => void;
  clearParlay: () => void;
  saveParlay: () => void;

  // Bankroll Actions
  setBankroll: (amount: number) => void;
  addBet: (bet: Omit<BetRecord, "id" | "timestamp">) => void;
  settleBet: (betId: string, result: BetRecord["result"], payout: number) => void;

  // Line Movement
  snapshotOdds: (oddsData: any[]) => void;
  getLineMovements: (gameId: string) => Array<{ bookmaker: string; market: string; oldOdds: number; newOdds: number; movement: number; time: string }>;

  // Room Actions
  setRoomId: (id: string | null) => void;
  setRoomUsers: (users: AppState["roomUsers"]) => void;

  // Hydrate persisted state
  hydrate: () => void;
}

// Cloud hydration helper — tries user-scoped first, falls back to global
async function hydrateFromCloud(set: any) {
  try {
    const { userGetAll } = await import("@/lib/supabase/user-sync");
    const userData = await userGetAll();
    if (Object.keys(userData).length > 0) {
      const updates: any = {};
      if (userData.bankroll) updates.bankroll = userData.bankroll;
      if (userData.betHistory) updates.betHistory = userData.betHistory;
      if (userData.savedParlays) updates.savedParlays = userData.savedParlays;
      if (Object.keys(updates).length > 0) { set(updates); return; }
    }
    const { cloudGet } = await import("@/lib/supabase/client");
    const [bankroll, betHistory, savedParlays] = await Promise.all([
      cloudGet("bankroll", null),
      cloudGet("betHistory", null),
      cloudGet("savedParlays", null),
    ]);
    const updates: any = {};
    if (bankroll) updates.bankroll = bankroll;
    if (betHistory) updates.betHistory = betHistory;
    if (savedParlays) updates.savedParlays = savedParlays;
    if (Object.keys(updates).length > 0) set(updates);
  } catch {}
}

export const useStore = create<AppState>((set, get) => ({
  // Initial UI State
  selectedGameId: null,
  activeTab: "dashboard",
  sidebarOpen: true,
  games: [],
  oddsData: [],
  scores: [],
  lastUpdate: null,
  isLoading: true,

  // Initial Parlay State
  parlayLegs: [],
  currentParlay: null,
  savedParlays: [],

  // Initial Bankroll — will be hydrated from localStorage
  bankroll: DEFAULT_BANKROLL,
  betHistory: [],

  // Line Movement
  oddsSnapshots: [],

  // Initial Room State
  roomId: null,
  roomUsers: [],

  // Hydrate from localStorage on mount
  hydrate: () => {
    // Load from localStorage first (instant)
    const bankroll = loadFromStorage("dq_bankroll", DEFAULT_BANKROLL);
    const betHistory = loadFromStorage<BetRecord[]>("dq_betHistory", []);
    const savedParlays = loadFromStorage<ParlaySlip[]>("dq_savedParlays", []);
    const oddsSnapshots = loadFromStorage<OddsSnapshot[]>("dq_oddsSnapshots", []);
    set({ bankroll, betHistory, savedParlays, oddsSnapshots });

    // Then try cloud (async, may override with newer data)
    hydrateFromCloud(set);
  },

  // UI Actions
  selectGame: (id) => set({ selectedGameId: id }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setGames: (games) => set({ games, lastUpdate: new Date().toISOString() }),
  setOddsData: (odds) => set({ oddsData: odds }),
  setScores: (scores) => set({ scores }),
  setLoading: (loading) => set({ isLoading: loading }),

  // Parlay Actions
  addParlayLeg: (leg) => {
    const id = `leg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const impliedProb = americanToImpliedProb(leg.odds);
    const newLeg: ParlayLeg = { ...leg, id, impliedProb };

    set((s) => {
      const legs = [...s.parlayLegs, newLeg];
      const currentParlay = legs.length >= 2 ? buildParlay(legs, s.bankroll.currentBankroll) : null;
      return { parlayLegs: legs, currentParlay };
    });
  },

  removeParlayLeg: (legId) => {
    set((s) => {
      const legs = s.parlayLegs.filter((l) => l.id !== legId);
      const currentParlay = legs.length >= 2 ? buildParlay(legs, s.bankroll.currentBankroll) : null;
      return { parlayLegs: legs, currentParlay };
    });
  },

  clearParlay: () => set({ parlayLegs: [], currentParlay: null }),

  saveParlay: () => {
    const { currentParlay, savedParlays } = get();
    if (currentParlay) {
      const updated = [...savedParlays, currentParlay];
      saveToStorage("dq_savedParlays", updated);
      set({ savedParlays: updated, parlayLegs: [], currentParlay: null });
    }
  },

  // Bankroll Actions — all persist to localStorage
  setBankroll: (amount) => {
    set((s) => {
      const bankroll = { ...s.bankroll, startingBankroll: amount, currentBankroll: amount };
      saveToStorage("dq_bankroll", bankroll);
      return { bankroll };
    });
  },

  addBet: (bet) => {
    const id = `bet-${Date.now()}`;
    const timestamp = new Date().toISOString();
    const record: BetRecord = { ...bet, id, timestamp };

    set((s) => {
      const betHistory = [...s.betHistory, record];
      const bankroll = {
        ...s.bankroll,
        totalBets: s.bankroll.totalBets + 1,
        totalStaked: s.bankroll.totalStaked + bet.stake,
        currentBankroll: s.bankroll.currentBankroll - bet.stake,
      };
      saveToStorage("dq_bankroll", bankroll);
      saveToStorage("dq_betHistory", betHistory);
      return { betHistory, bankroll };
    });
  },

  settleBet: (betId, result, payout) => {
    set((s) => {
      const betHistory = s.betHistory.map((b) =>
        b.id === betId ? { ...b, result, payout } : b
      );

      const wins = betHistory.filter((b) => b.result === "win").length;
      const losses = betHistory.filter((b) => b.result === "loss").length;
      const pushes = betHistory.filter((b) => b.result === "push").length;
      const totalReturns = betHistory.reduce((sum, b) => sum + b.payout, 0);
      const totalStaked = betHistory.reduce((sum, b) => sum + b.stake, 0);
      const currentBankroll = s.bankroll.startingBankroll + totalReturns - totalStaked;
      const roi = totalStaked > 0 ? ((totalReturns - totalStaked) / totalStaked) * 100 : 0;

      const bankroll = {
        ...s.bankroll,
        wins, losses, pushes, totalReturns, currentBankroll, roi,
      };
      saveToStorage("dq_bankroll", bankroll);
      saveToStorage("dq_betHistory", betHistory);
      return { betHistory, bankroll };
    });
  },

  // Line Movement — snapshot current odds for comparison
  snapshotOdds: (oddsData) => {
    const lines: Record<string, OddsLine[]> = {};
    for (const game of oddsData) {
      if (game.id && game.oddsLines) {
        lines[game.id] = game.oddsLines;
      }
    }

    set((s) => {
      // Keep last 20 snapshots (~ 10 minutes at 30s intervals)
      const snapshots = [...s.oddsSnapshots, { timestamp: new Date().toISOString(), lines }].slice(-20);
      saveToStorage("dq_oddsSnapshots", snapshots);
      return { oddsSnapshots: snapshots };
    });
  },

  getLineMovements: (gameId) => {
    const { oddsSnapshots } = get();
    if (oddsSnapshots.length < 2) return [];

    const latest = oddsSnapshots[oddsSnapshots.length - 1];
    // Compare against snapshot from ~5 min ago if available
    const compareIdx = Math.max(0, oddsSnapshots.length - 10);
    const previous = oddsSnapshots[compareIdx];

    const currentLines = latest.lines[gameId];
    const prevLines = previous.lines[gameId];
    if (!currentLines || !prevLines) return [];

    const movements: Array<{ bookmaker: string; market: string; oldOdds: number; newOdds: number; movement: number; time: string }> = [];

    for (const current of currentLines) {
      const prev = prevLines.find((p: OddsLine) => p.bookmaker === current.bookmaker);
      if (!prev) continue;

      // Check ML movement
      if (current.homeML !== prev.homeML && current.homeML !== 0 && prev.homeML !== 0) {
        movements.push({
          bookmaker: current.bookmaker,
          market: "Home ML",
          oldOdds: prev.homeML,
          newOdds: current.homeML,
          movement: current.homeML - prev.homeML,
          time: new Date(latest.timestamp).toLocaleTimeString(),
        });
      }
      if (current.awayML !== prev.awayML && current.awayML !== 0 && prev.awayML !== 0) {
        movements.push({
          bookmaker: current.bookmaker,
          market: "Away ML",
          oldOdds: prev.awayML,
          newOdds: current.awayML,
          movement: current.awayML - prev.awayML,
          time: new Date(latest.timestamp).toLocaleTimeString(),
        });
      }
      // Check total movement
      if (current.total !== prev.total && current.total > 0 && prev.total > 0) {
        movements.push({
          bookmaker: current.bookmaker,
          market: "Total",
          oldOdds: prev.total,
          newOdds: current.total,
          movement: current.total - prev.total,
          time: new Date(latest.timestamp).toLocaleTimeString(),
        });
      }
    }

    return movements;
  },

  // Room Actions
  setRoomId: (id) => set({ roomId: id }),
  setRoomUsers: (users) => set({ roomUsers: users }),
}));

// Discord webhook URL (persisted separately)
export function getDiscordWebhook(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("dq_discord_webhook") ?? "";
}
export function setDiscordWebhook(url: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem("dq_discord_webhook", url);
}
