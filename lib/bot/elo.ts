// ───���────────────────────���─────────────────────────────────
// ELO POWER RANKINGS
// Self-updating rating system for MLB and NBA teams
// Every game result adjusts ratings. Replaces the weak trend model.
// ───────────────��──────────────────────────────────────────

export interface TeamElo {
  team: string;
  rating: number;        // starts at 1500
  gamesPlayed: number;
  wins: number;
  losses: number;
  lastUpdated: string;
  // Trend
  ratingHistory: number[]; // last 20 ratings
  peakRating: number;
  troughRating: number;
}

export interface EloState {
  teams: Record<string, TeamElo>;
  sport: string;
  lastUpdated: string;
  totalGamesProcessed: number;
}

const K_FACTOR = 20; // how much each game moves ratings
const HOME_ADVANTAGE = 50; // ~50 Elo points for home (MLB: ~54%, NBA: ~58%)
const INITIAL_RATING = 1500;

// Calculate expected win probability from Elo ratings
export function expectedWinProb(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

// Update Elo after a game result
export function updateElo(
  state: EloState,
  homeTeam: string,
  awayTeam: string,
  homeWon: boolean,
  margin: number = 0 // point/run differential for margin-of-victory adjustment
): EloState {
  const updated = { ...state };

  // Initialize teams if new
  if (!updated.teams[homeTeam]) updated.teams[homeTeam] = createTeam(homeTeam);
  if (!updated.teams[awayTeam]) updated.teams[awayTeam] = createTeam(awayTeam);

  const home = updated.teams[homeTeam];
  const away = updated.teams[awayTeam];

  // Expected probabilities (with home advantage)
  const homeExpected = expectedWinProb(home.rating + HOME_ADVANTAGE, away.rating);
  const awayExpected = 1 - homeExpected;

  // Actual outcome
  const homeActual = homeWon ? 1 : 0;
  const awayActual = homeWon ? 0 : 1;

  // Margin of victory multiplier (bigger wins = bigger Elo change)
  const movMultiplier = margin > 0 ? Math.log(Math.abs(margin) + 1) * 0.6 + 0.7 : 1;

  // Update ratings
  const homeChange = K_FACTOR * movMultiplier * (homeActual - homeExpected);
  const awayChange = K_FACTOR * movMultiplier * (awayActual - awayExpected);

  home.rating = Math.round(home.rating + homeChange);
  away.rating = Math.round(away.rating + awayChange);
  home.gamesPlayed++;
  away.gamesPlayed++;
  if (homeWon) { home.wins++; away.losses++; }
  else { away.wins++; home.losses++; }
  home.lastUpdated = new Date().toISOString();
  away.lastUpdated = new Date().toISOString();

  // Track history
  home.ratingHistory = [...home.ratingHistory.slice(-19), home.rating];
  away.ratingHistory = [...away.ratingHistory.slice(-19), away.rating];
  home.peakRating = Math.max(home.peakRating, home.rating);
  home.troughRating = Math.min(home.troughRating, home.rating);
  away.peakRating = Math.max(away.peakRating, away.rating);
  away.troughRating = Math.min(away.troughRating, away.rating);

  updated.totalGamesProcessed++;
  updated.lastUpdated = new Date().toISOString();

  return updated;
}

function createTeam(name: string): TeamElo {
  return {
    team: name,
    rating: INITIAL_RATING,
    gamesPlayed: 0,
    wins: 0, losses: 0,
    lastUpdated: new Date().toISOString(),
    ratingHistory: [INITIAL_RATING],
    peakRating: INITIAL_RATING,
    troughRating: INITIAL_RATING,
  };
}

// Get prediction from Elo
export function eloPrediction(
  state: EloState,
  homeTeam: string,
  awayTeam: string,
  isNBA: boolean = false
): { homeWinProb: number; awayWinProb: number; homeRating: number; awayRating: number; ratingDiff: number; confidence: number } {
  const home = state.teams[homeTeam];
  const away = state.teams[awayTeam];

  const homeRating = home?.rating ?? INITIAL_RATING;
  const awayRating = away?.rating ?? INITIAL_RATING;
  const homeAdv = isNBA ? 65 : HOME_ADVANTAGE; // NBA has bigger home advantage

  const homeWinProb = expectedWinProb(homeRating + homeAdv, awayRating);
  const ratingDiff = homeRating - awayRating;

  // Confidence based on how many games we've seen from both teams
  const minGames = Math.min(home?.gamesPlayed ?? 0, away?.gamesPlayed ?? 0);
  const confidence = Math.min(80, minGames * 3 + 10);

  return {
    homeWinProb,
    awayWinProb: 1 - homeWinProb,
    homeRating,
    awayRating,
    ratingDiff,
    confidence,
  };
}

// Get power rankings (sorted by rating)
export function getPowerRankings(state: EloState): TeamElo[] {
  return Object.values(state.teams)
    .filter(t => t.gamesPlayed >= 5)
    .sort((a, b) => b.rating - a.rating);
}

// Load/Save Elo state
export function loadEloState(sport: string = "mlb"): EloState {
  if (typeof window === "undefined") return { teams: {}, sport, lastUpdated: "", totalGamesProcessed: 0 };
  try {
    const stored = localStorage.getItem(`dq_elo_${sport}`);
    if (stored) return JSON.parse(stored);
  } catch {}
  return { teams: {}, sport, lastUpdated: "", totalGamesProcessed: 0 };
}

export function saveEloState(state: EloState) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(`dq_elo_${state.sport}`, JSON.stringify(state)); } catch {}
  // Cloud sync
  syncEloToCloud(state);
}

async function syncEloToCloud(state: EloState) {
  try {
    const { cloudSet } = await import("@/lib/supabase/client");
    await cloudSet(`elo_${state.sport}`, state);
  } catch {}
}

// Initialize Elo from historical games (for Brain training)
export function trainEloFromGames(
  sport: string,
  games: Array<{ homeTeam: string; awayTeam: string; homeWon: boolean; homeScore: number; awayScore: number }>
): EloState {
  let state: EloState = { teams: {}, sport, lastUpdated: "", totalGamesProcessed: 0 };
  for (const game of games) {
    const margin = Math.abs(game.homeScore - game.awayScore);
    state = updateElo(state, game.homeTeam, game.awayTeam, game.homeWon, margin);
  }
  return state;
}
