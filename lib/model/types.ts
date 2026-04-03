// ──────────────────────────────────────────────────────────
// Diamond-Quant Live — Core Types
// ──────────────────────────────────────────────────────────

export interface TeamStats {
  name: string;
  abbrev: string;
  pitching: number;      // 0-100 composite
  hitting: number;       // 0-100 composite
  bullpen: number;       // 0-100 composite
  defense: number;       // 0-100 composite
  baserunning: number;   // 0-100 composite
  recentForm: number;    // last 10 games win %
  homeAway: number;      // home/away split factor
}

export interface PitcherStats {
  name: string;
  team: string;
  era: number;
  whip: number;
  k9: number;
  bb9: number;
  fip: number;
  velocity: number;      // avg fastball mph
  spinRate: number;
  pitchCount: number;    // current game
  fatigueIndex: number;  // 0-1, increases with pitch count
  handedness: "L" | "R";
}

export interface GameState {
  inning: number;
  halfInning: "top" | "bottom";
  outs: number;
  runners: { first: boolean; second: boolean; third: boolean };
  homeScore: number;
  visitorScore: number;
  homePitcher: PitcherStats;
  visitorPitcher: PitcherStats;
  isLive: boolean;
}

export interface WeatherData {
  temperature: number;   // fahrenheit
  windSpeed: number;     // mph
  windDirection: string; // "in", "out", "cross-left", "cross-right"
  humidity: number;      // 0-100
  precipitation: number; // % chance
  roofClosed: boolean;
}

export interface UmpireData {
  name: string;
  kZoneAccuracy: number;   // 0-100
  runScoringIndex: number; // avg runs/game with this ump
  homeTeamWinRate: number; // historical home win %
}

export interface OddsLine {
  bookmaker: string;
  bookmakerKey: string;
  homeML: number;        // american odds
  awayML: number;        // american odds
  homeSpread: number;
  awaySpread: number;
  spreadPrice: number;
  total: number;         // over/under line
  overPrice: number;
  underPrice: number;
  lastUpdate: string;
}

export interface PlayerProp {
  bookmaker: string;
  playerName: string;
  playerId: string;
  team: string;
  market: string;        // "strikeouts", "hits", "home_runs", "total_bases", etc.
  line: number;
  overPrice: number;
  underPrice: number;
}

export interface ArbitrageOpportunity {
  type: "moneyline" | "spread" | "total" | "player_prop";
  game: string;
  side1: { bookmaker: string; odds: number; pick: string };
  side2: { bookmaker: string; odds: number; pick: string };
  holdPercentage: number;  // negative = arb exists
  profit: number;          // % guaranteed profit
  stake1: number;          // optimal stake ratios
  stake2: number;
}

export interface EVBet {
  game: string;
  market: string;
  pick: string;
  bookmaker: string;
  odds: number;
  fairOdds: number;
  impliedProb: number;
  fairProb: number;
  evPercentage: number;
  kellyStake: number;
  halfKellyStake: number;
  confidence: string;     // "HIGH" | "MEDIUM" | "LOW"
  reasoning: string[];
}

export interface ParlayLeg {
  id: string;
  game: string;
  market: "moneyline" | "spread" | "total" | "player_prop";
  pick: string;
  odds: number;
  impliedProb: number;
  fairProb: number;
  bookmaker: string;
  correlation?: number;   // -1 to 1, how correlated with other legs
}

export interface ParlaySlip {
  legs: ParlayLeg[];
  combinedOdds: number;
  impliedProb: number;
  fairProb: number;
  evPercentage: number;
  correlationAdjustedProb: number;
  suggestedStake: number;
  potentialPayout: number;
}

export interface BetRecord {
  id: string;
  timestamp: string;
  game: string;
  market: string;
  pick: string;
  bookmaker: string;
  odds: number;
  stake: number;
  result: "pending" | "win" | "loss" | "push" | "void";
  payout: number;
  isParlay: boolean;
  parlayLegs?: string[];
  evAtPlacement: number;
}

export interface BankrollState {
  startingBankroll: number;
  currentBankroll: number;
  totalBets: number;
  wins: number;
  losses: number;
  pushes: number;
  totalStaked: number;
  totalReturns: number;
  roi: number;
  clv: number;  // closing line value
  sharpScore: number;
  streak: number;
  bestBet: BetRecord | null;
  worstBet: BetRecord | null;
}

export interface LiveGame {
  id: string;
  homeTeam: TeamStats;
  awayTeam: TeamStats;
  gameState: GameState;
  odds: OddsLine[];
  weather?: WeatherData;
  umpire?: UmpireData;
  winProb: number;        // home team win prob
  evBets: EVBet[];
  arbitrage: ArbitrageOpportunity[];
  playerProps: PlayerProp[];
  startTime: string;
  venue: string;
  status: "pre" | "live" | "final";
}

export interface RoomState {
  roomId: string;
  users: RoomUser[];
  sharedParlays: ParlaySlip[];
  chat: ChatMessage[];
  selectedGame: string | null;
  modelOverrides: Record<string, number>;  // weight overrides
}

export interface RoomUser {
  id: string;
  name: string;
  avatar: string;
  isOnline: boolean;
  lastSeen: string;
}

export interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: string;
  type: "message" | "alert" | "bet" | "system";
}
