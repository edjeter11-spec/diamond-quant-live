// ──────────────────────────────────────────────────────────
// SPORT CONTEXT — Global toggle between MLB and NBA
// Changes data layer, colors, labels, API endpoints
// ──────────────────────────────────────────────────────────

import { create } from "zustand";

export type Sport = "mlb" | "nba";

export interface SportConfig {
  sport: Sport;
  name: string;
  accent: string;          // tailwind color class
  accentHex: string;       // hex for dynamic styles
  oddsApiKey: string;      // sport key for The Odds API
  // Model labels
  model1Label: string;     // "Pitcher" or "Net Rating"
  model2Label: string;     // "Market"
  model3Label: string;     // "Trend" or "Form"
  // Brain key in Supabase
  brainKey: string;
  botKey: string;
  // Prop markets
  propMarkets: Array<{ key: string; label: string }>;
}

export const SPORT_CONFIGS: Record<Sport, SportConfig> = {
  mlb: {
    sport: "mlb",
    name: "MLB",
    accent: "neon",
    accentHex: "#00ff88",
    oddsApiKey: "baseball_mlb",
    model1Label: "Pitcher",
    model2Label: "Market",
    model3Label: "Trend",
    brainKey: "brain",
    botKey: "smart_bot",
    propMarkets: [
      { key: "pitcher_strikeouts", label: "Strikeouts" },
      { key: "batter_hits", label: "Hits" },
      { key: "batter_home_runs", label: "Home Runs" },
      { key: "batter_total_bases", label: "Total Bases" },
    ],
  },
  nba: {
    sport: "nba",
    name: "NBA",
    accent: "orange",
    accentHex: "#ff6b00",
    oddsApiKey: "basketball_nba",
    model1Label: "Net Rating",
    model2Label: "Market",
    model3Label: "Form",
    brainKey: "brain_nba",
    botKey: "smart_bot_nba",
    propMarkets: [
      { key: "player_points", label: "Points" },
      { key: "player_rebounds", label: "Rebounds" },
      { key: "player_assists", label: "Assists" },
      { key: "player_threes", label: "3-Pointers" },
      { key: "player_pra", label: "Pts+Reb+Ast" },
    ],
  },
};

interface SportStore {
  currentSport: Sport;
  config: SportConfig;
  setSport: (sport: Sport) => void;
}

export const useSport = create<SportStore>((set) => ({
  currentSport: "mlb",
  config: SPORT_CONFIGS.mlb,
  setSport: (sport) => set({ currentSport: sport, config: SPORT_CONFIGS[sport] }),
}));
