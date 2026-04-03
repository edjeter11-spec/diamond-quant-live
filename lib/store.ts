// ──────────────────────────────────────────────────────────
// Global State Management — Zustand
// ──────────────────────────────────────────────────────────

import { create } from "zustand";
import type { ParlayLeg, ParlaySlip, BetRecord, BankrollState } from "./model/types";
import { buildParlay } from "./model/parlay";
import { americanToImpliedProb } from "./model/kelly";

interface AppState {
  // UI State
  selectedGameId: string | null;
  activeTab: "dashboard" | "parlays" | "props" | "bankroll" | "room";
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

  // Bankroll
  bankroll: BankrollState;
  betHistory: BetRecord[];

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

  // Room Actions
  setRoomId: (id: string | null) => void;
  setRoomUsers: (users: AppState["roomUsers"]) => void;
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

  // Initial Bankroll
  bankroll: {
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
  },
  betHistory: [],

  // Initial Room State
  roomId: null,
  roomUsers: [],

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
      set({ savedParlays: [...savedParlays, currentParlay], parlayLegs: [], currentParlay: null });
    }
  },

  // Bankroll Actions
  setBankroll: (amount) =>
    set((s) => ({
      bankroll: { ...s.bankroll, startingBankroll: amount, currentBankroll: amount },
    })),

  addBet: (bet) => {
    const id = `bet-${Date.now()}`;
    const timestamp = new Date().toISOString();
    const record: BetRecord = { ...bet, id, timestamp };

    set((s) => ({
      betHistory: [...s.betHistory, record],
      bankroll: {
        ...s.bankroll,
        totalBets: s.bankroll.totalBets + 1,
        totalStaked: s.bankroll.totalStaked + bet.stake,
        currentBankroll: s.bankroll.currentBankroll - bet.stake,
      },
    }));
  },

  settleBet: (betId, result, payout) => {
    set((s) => {
      const history = s.betHistory.map((b) =>
        b.id === betId ? { ...b, result, payout } : b
      );

      const wins = history.filter((b) => b.result === "win").length;
      const losses = history.filter((b) => b.result === "loss").length;
      const pushes = history.filter((b) => b.result === "push").length;
      const totalReturns = history.reduce((sum, b) => sum + b.payout, 0);
      const totalStaked = history.reduce((sum, b) => sum + b.stake, 0);
      const currentBankroll = s.bankroll.startingBankroll + totalReturns - totalStaked;
      const roi = totalStaked > 0 ? ((totalReturns - totalStaked) / totalStaked) * 100 : 0;

      return {
        betHistory: history,
        bankroll: {
          ...s.bankroll,
          wins,
          losses,
          pushes,
          totalReturns,
          currentBankroll,
          roi,
        },
      };
    });
  },

  // Room Actions
  setRoomId: (id) => set({ roomId: id }),
  setRoomUsers: (users) => set({ roomUsers: users }),
}));
