// ──────────────────────────────────────────────────────────
// SPORT CONTEXT — Global toggle between MLB and NBA
// Changes data layer, colors, labels, API endpoints
// ──────────────────────────────────────────────────────────

import { create } from "zustand";

export type Sport = "mlb" | "nba" | "nfl" | "nhl";

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
    model3Label: "Elo Power",
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
  nfl: {
    sport: "nfl",
    name: "NFL",
    accent: "electric",
    accentHex: "#00d4ff",
    oddsApiKey: "americanfootball_nfl",
    model1Label: "QB Rating",
    model2Label: "Market",
    model3Label: "DVOA",
    brainKey: "brain_nfl",
    botKey: "smart_bot_nfl",
    propMarkets: [
      { key: "player_pass_yds", label: "Passing Yds" },
      { key: "player_pass_tds", label: "Passing TDs" },
      { key: "player_pass_attempts", label: "Pass Attempts" },
      { key: "player_rush_yds", label: "Rushing Yds" },
      { key: "player_rush_attempts", label: "Carries" },
      { key: "player_receptions", label: "Receptions" },
      { key: "player_reception_yds", label: "Receiving Yds" },
      { key: "player_anytime_td", label: "Anytime TD" },
    ],
  },
  nhl: {
    sport: "nhl",
    name: "NHL",
    accent: "ice",
    accentHex: "#7dd3fc",
    oddsApiKey: "icehockey_nhl",
    model1Label: "Goalie",
    model2Label: "Market",
    model3Label: "xG",
    brainKey: "brain_nhl",
    botKey: "smart_bot_nhl",
    propMarkets: [
      { key: "player_points", label: "Points" },
      { key: "player_goals", label: "Goals" },
      { key: "player_assists", label: "Assists" },
      { key: "player_shots_on_goal", label: "Shots on Goal" },
      { key: "player_total_saves", label: "Saves" },
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
