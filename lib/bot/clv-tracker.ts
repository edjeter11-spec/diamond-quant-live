// ──────────────────────────────────────────────────────────
// CLV TRACKER — Closing Line Value
// Stores odds at time of pick, compares to closing odds
// CLV > 0 consistently = proven edge
// ──────────────────────────────────────────────────────────

export interface CLVRecord {
  id: string;
  date: string;
  game: string;
  pick: string;
  bookmaker: string;
  // Odds tracking
  openingOdds: number;       // odds when the pick was made
  closingOdds: number;       // odds at game start (filled later)
  // CLV calculation
  clvPercent: number;        // how much you beat the closing line
  beatClosing: boolean;      // did you get better odds than close?
  // Result
  result: "pending" | "win" | "loss" | "push";
  sport: "mlb" | "nba";
}

export interface CLVSummary {
  totalBets: number;
  betsWithCLV: number;       // how many have closing odds recorded
  beatClosingCount: number;
  beatClosingRate: number;   // % of bets that beat the close
  avgCLV: number;            // average CLV across all bets
  isSharp: boolean;          // >55% beat rate = sharp bettor
  // By confidence
  highConfCLV: number;
  medConfCLV: number;
}

// Calculate CLV from opening vs closing odds
export function calculateCLV(openingOdds: number, closingOdds: number): { clvPercent: number; beatClosing: boolean } {
  const toProb = (odds: number) => odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);

  const openProb = toProb(openingOdds);
  const closeProb = toProb(closingOdds);

  // CLV = (closeProb - openProb) / openProb * 100
  // Positive = you got better odds than the market settled on
  const clvPercent = openProb > 0 ? Math.round(((closeProb - openProb) / openProb) * 10000) / 100 : 0;

  return { clvPercent, beatClosing: clvPercent > 0 };
}

// Load CLV records
export function loadCLVRecords(sport: string = "mlb"): CLVRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(`dq_clv_${sport}`);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

// Save CLV records
export function saveCLVRecords(records: CLVRecord[], sport: string = "mlb") {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(`dq_clv_${sport}`, JSON.stringify(records.slice(-200)));
  } catch {}
  // Cloud sync
  syncCLVToCloud(records.slice(-100), sport);
}

async function syncCLVToCloud(records: CLVRecord[], sport: string) {
  try {
    const { cloudSet } = await import("@/lib/supabase/client");
    await cloudSet(`clv_${sport}`, records);
  } catch {}
}

// Add a new bet to CLV tracking
export function trackBet(
  records: CLVRecord[],
  bet: { id: string; date: string; game: string; pick: string; bookmaker: string; odds: number; sport: string }
): CLVRecord[] {
  const existing = records.find(r => r.id === bet.id);
  if (existing) return records;

  return [...records, {
    id: bet.id,
    date: bet.date,
    game: bet.game,
    pick: bet.pick,
    bookmaker: bet.bookmaker,
    openingOdds: bet.odds,
    closingOdds: 0, // filled when game starts
    clvPercent: 0,
    beatClosing: false,
    result: "pending",
    sport: bet.sport as "mlb" | "nba",
  }];
}

// Update closing odds for pending bets (called when game starts)
export function updateClosingOdds(
  records: CLVRecord[],
  game: string,
  closingOdds: Record<string, number> // pick -> closing odds
): CLVRecord[] {
  return records.map(r => {
    if (r.closingOdds !== 0) return r; // already has closing
    if (!r.game.includes(game) && !game.includes(r.game)) return r;

    const closing = closingOdds[r.pick] ?? 0;
    if (closing === 0) return r;

    const { clvPercent, beatClosing } = calculateCLV(r.openingOdds, closing);
    return { ...r, closingOdds: closing, clvPercent, beatClosing };
  });
}

// Get CLV summary
export function getCLVSummary(records: CLVRecord[]): CLVSummary {
  const withCLV = records.filter(r => r.closingOdds !== 0);
  const beatCount = withCLV.filter(r => r.beatClosing).length;
  const avgCLV = withCLV.length > 0
    ? Math.round((withCLV.reduce((s, r) => s + r.clvPercent, 0) / withCLV.length) * 100) / 100
    : 0;

  return {
    totalBets: records.length,
    betsWithCLV: withCLV.length,
    beatClosingCount: beatCount,
    beatClosingRate: withCLV.length > 0 ? Math.round((beatCount / withCLV.length) * 1000) / 10 : 0,
    avgCLV,
    isSharp: withCLV.length >= 10 && (beatCount / withCLV.length) > 0.55,
    highConfCLV: 0,
    medConfCLV: 0,
  };
}
