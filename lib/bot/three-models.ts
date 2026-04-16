// ──────────────────────────────────────────────────────────
// THREE COMPETING MODELS
// Each independently predicts every game
// Consensus = confidence, disagreement = opportunity
// ──────────────────────────────────────────────────────────

import { americanToImpliedProb, americanToDecimal, devig, kellyStake } from "@/lib/model/kelly";

const MLB_API = "https://statsapi.mlb.com/api/v1";

// ── Types ──

export interface ModelPrediction {
  homeWinProb: number;   // 0-1
  totalProjection: number; // projected total runs
  confidence: number;     // 0-100
  factors: string[];      // reasoning
}

export interface GameAnalysis {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  // Odds
  bestHomeML: number;
  bestAwayML: number;
  bestOver: number;
  bestUnder: number;
  bestTotal: number;
  bestHomeBook: string;
  bestAwayBook: string;
  // 3 Model predictions
  pitcherModel: ModelPrediction;
  marketModel: ModelPrediction;
  trendModel: ModelPrediction;
  // Consensus
  consensus: {
    homeWinProb: number;
    confidence: "HIGH" | "MEDIUM" | "LOW" | "NO_PLAY";
    modelsAgree: boolean;
    disagreementLevel: number; // 0-1, higher = more disagreement
  };
  // Final picks
  picks: GamePick[];
  // Raw data for transparency
  homePitcher: PitcherProfile | null;
  awayPitcher: PitcherProfile | null;
  weather?: string;
  fatigue?: { home: string; away: string };
}

export interface GamePick {
  pick: string;
  market: string;
  odds: number;
  bookmaker: string;
  evPercentage: number;
  fairProb: number;
  kellyStake: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reasoning: string[];
  modelScores: { pitcher: number; market: number; trend: number };
}

export interface PitcherProfile {
  name: string;
  era: number;        // season ERA
  recentEra: number;  // recency-weighted: 60% last-5 starts + 40% season
  whip: number;
  k9: number;
  bb9: number;
  record: string;
  avgGameScore: number;
  vsOpponent: { games: number; era: number; kPer9: number } | null;
  last5: Array<{ opponent: string; ip: number; er: number; k: number }>;
  fatigueRisk: boolean;
}

// ── Fetch pitcher data ──

async function buildPitcherProfile(pitcherName: string, opponentTeam: string): Promise<PitcherProfile | null> {
  if (!pitcherName || pitcherName === "TBD") return null;

  try {
    // Search for pitcher
    const searchRes = await fetch(`${MLB_API}/people/search?names=${encodeURIComponent(pitcherName)}&sportIds=1&active=true`);
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const player = searchData.people?.[0];
    if (!player) return null;

    const year = new Date().getFullYear();
    const lastYear = year - 1;

    // Fetch current + last year stats + game log in parallel
    const [currentRes, lastYearRes, logRes] = await Promise.all([
      fetch(`${MLB_API}/people/${player.id}/stats?stats=season&season=${year}&group=pitching`),
      fetch(`${MLB_API}/people/${player.id}/stats?stats=season&season=${lastYear}&group=pitching`),
      fetch(`${MLB_API}/people/${player.id}/stats?stats=gameLog&season=${year}&group=pitching`),
    ]);

    const currentData = currentRes.ok ? await currentRes.json() : null;
    const lastYearData = lastYearRes.ok ? await lastYearRes.json() : null;
    const logData = logRes.ok ? await logRes.json() : null;

    // Use current year, fall back to last year
    const raw = currentData?.stats?.[0]?.splits?.[0]?.stat ?? lastYearData?.stats?.[0]?.splits?.[0]?.stat;
    if (!raw) return null;

    const ip = parseFloat(raw.inningsPitched) || 1;
    const totalK = parseInt(raw.strikeOuts) || 0;
    const gp = parseInt(raw.gamesPlayed || raw.gamesPitched) || 1;

    // Game log
    const splits = logData?.stats?.[0]?.splits ?? [];
    const last5 = splits.slice(-5).map((s: any) => ({
      opponent: s.opponent?.name ?? "Unknown",
      ip: parseFloat(s.stat?.inningsPitched) || 0,
      er: parseInt(s.stat?.earnedRuns) || 0,
      k: parseInt(s.stat?.strikeOuts) || 0,
    }));

    // vs opponent
    const vsOpp = splits.filter((s: any) =>
      s.opponent?.name?.toLowerCase().includes(opponentTeam.toLowerCase().split(" ").pop() ?? "")
    );
    const vsOppData = vsOpp.length > 0 ? {
      games: vsOpp.length,
      era: vsOpp.reduce((s: number, g: any) => s + (parseInt(g.stat?.earnedRuns) || 0), 0) /
           Math.max(vsOpp.reduce((s: number, g: any) => s + (parseFloat(g.stat?.inningsPitched) || 0), 0) / 9, 0.1),
      kPer9: vsOpp.reduce((s: number, g: any) => s + (parseInt(g.stat?.strikeOuts) || 0), 0) /
             Math.max(vsOpp.reduce((s: number, g: any) => s + (parseFloat(g.stat?.inningsPitched) || 0), 0) / 9, 0.1),
    } : null;

    // Fatigue: pitched in last 4 days?
    const recentDates = splits.slice(-3).map((s: any) => s.date).filter(Boolean);
    const now = Date.now();
    const fatigueRisk = recentDates.some((d: string) => (now - new Date(d).getTime()) < 4 * 24 * 60 * 60 * 1000);

    // Recency-weighted ERA: last 5 starts (60%) blended with season (40%)
    const seasonEra = parseFloat(raw.era) || 4.50;
    let recentEra = seasonEra;
    if (last5.length >= 3) {
      const recentIP = last5.reduce((s, g) => s + g.ip, 0);
      if (recentIP > 0) {
        const rawRecentEra = (last5.reduce((s, g) => s + g.er, 0) / recentIP) * 9;
        recentEra = Math.round((rawRecentEra * 0.6 + seasonEra * 0.4) * 100) / 100;
      }
    }

    return {
      name: pitcherName,
      era: seasonEra,
      recentEra,
      whip: parseFloat(raw.whip) || 0,
      k9: ip > 0 ? (totalK / ip) * 9 : 0,
      bb9: ip > 0 ? ((parseInt(raw.baseOnBalls) || 0) / ip) * 9 : 0,
      record: `${raw.wins ?? 0}-${raw.losses ?? 0}`,
      avgGameScore: gp > 0 ? totalK / gp : 0,
      vsOpponent: vsOppData,
      last5,
      fatigueRisk,
    };
  } catch {
    return null;
  }
}

// ══════════════════════════════════════════════════════════
// MODEL A: PITCHER MODEL
// The starter IS the game in baseball
// ══════════════════════════════════════════════════════════

function runPitcherModel(
  homePitcher: PitcherProfile | null,
  awayPitcher: PitcherProfile | null,
  homeTeam: string,
  awayTeam: string,
  weather: { hittingImpact: number; pitchingImpact: number; hasRoof: boolean; summary: string } | null,
  parkData: { games: number; homeWins: number; avgRuns: number } | null
): ModelPrediction {
  const factors: string[] = [];
  let homeEdge = 0;
  let totalAdjust = 0;

  if (!homePitcher && !awayPitcher) {
    return { homeWinProb: 0.52, totalProjection: 8.5, confidence: 10, factors: ["No pitcher data available — using baseline"] };
  }

  // ERA comparison — use recency-weighted ERA (60% last-5 + 40% season)
  const homeERA = homePitcher?.recentEra ?? homePitcher?.era ?? 4.5;
  const awayERA = awayPitcher?.recentEra ?? awayPitcher?.era ?? 4.5;
  const eraDiff = awayERA - homeERA;
  homeEdge += eraDiff * 3;
  if (Math.abs(eraDiff) > 1.0) {
    const homeLabel = homePitcher ? `${homePitcher.name} ${homeERA.toFixed(2)}` : `${homeTeam} 4.50`;
    const awayLabel = awayPitcher ? `${awayPitcher.name} ${awayERA.toFixed(2)}` : `${awayTeam} 4.50`;
    factors.push(`ERA edge (recent): ${homeLabel} vs ${awayLabel} (${eraDiff > 0 ? "home" : "away"} advantage)`);
  }

  // WHIP comparison
  const homeWHIP = homePitcher?.whip ?? 1.30;
  const awayWHIP = awayPitcher?.whip ?? 1.30;
  const whipDiff = awayWHIP - homeWHIP;
  homeEdge += whipDiff * 5;
  if (Math.abs(whipDiff) > 0.15) {
    factors.push(`WHIP: ${homePitcher?.name ?? "Home"} ${homeWHIP.toFixed(2)} vs ${awayPitcher?.name ?? "Away"} ${awayWHIP.toFixed(2)}`);
  }

  // K/9 — higher = more dominant
  const homeK9 = homePitcher?.k9 ?? 8.0;
  const awayK9 = awayPitcher?.k9 ?? 8.0;
  if (homeK9 > 10) { homeEdge += 3; factors.push(`${homePitcher?.name} is elite: ${homeK9.toFixed(1)} K/9`); }
  if (awayK9 > 10) { homeEdge -= 3; factors.push(`${awayPitcher?.name} is elite: ${awayK9.toFixed(1)} K/9`); }

  // vs Opponent history
  if (homePitcher?.vsOpponent && homePitcher.vsOpponent.games >= 2) {
    if (homePitcher.vsOpponent.era < 3.0) {
      homeEdge += 4;
      factors.push(`${homePitcher.name} dominates ${awayTeam}: ${homePitcher.vsOpponent.era.toFixed(2)} ERA in ${homePitcher.vsOpponent.games} starts`);
    } else if (homePitcher.vsOpponent.era > 5.0) {
      homeEdge -= 3;
      factors.push(`${homePitcher.name} struggles vs ${awayTeam}: ${homePitcher.vsOpponent.era.toFixed(2)} ERA`);
    }
  }
  if (awayPitcher?.vsOpponent && awayPitcher.vsOpponent.games >= 2) {
    if (awayPitcher.vsOpponent.era < 3.0) {
      homeEdge -= 4;
      factors.push(`${awayPitcher.name} dominates ${homeTeam}: ${awayPitcher.vsOpponent.era.toFixed(2)} ERA in ${awayPitcher.vsOpponent.games} starts`);
    }
  }

  // Recency trend signal: surface when recent form diverges significantly from season
  if (homePitcher?.recentEra !== undefined && Math.abs(homePitcher.recentEra - homePitcher.era) > 1.0) {
    const dir = homePitcher.recentEra < homePitcher.era ? "trending up" : "trending down";
    factors.push(`${homePitcher.name} ${dir}: ${homePitcher.recentEra.toFixed(2)} recent ERA vs ${homePitcher.era.toFixed(2)} season`);
  }
  if (awayPitcher?.recentEra !== undefined && Math.abs(awayPitcher.recentEra - awayPitcher.era) > 1.0) {
    const dir = awayPitcher.recentEra < awayPitcher.era ? "trending up" : "trending down";
    factors.push(`${awayPitcher.name} ${dir}: ${awayPitcher.recentEra.toFixed(2)} recent ERA vs ${awayPitcher.era.toFixed(2)} season`);
  }

  // Fatigue
  if (homePitcher?.fatigueRisk) { homeEdge -= 2; factors.push(`${homePitcher.name} fatigue risk — pitched recently`); }
  if (awayPitcher?.fatigueRisk) { homeEdge += 2; factors.push(`${awayPitcher.name} fatigue risk — pitched recently`); }

  // ── Weather impact (only if no roof) ──
  if (weather && !weather.hasRoof) {
    const netImpact = weather.hittingImpact - weather.pitchingImpact;
    if (Math.abs(netImpact) >= 2) {
      totalAdjust += netImpact * 0.25;
      if (netImpact > 0) homeEdge -= 0.5; // high-scoring game slightly less predictable
      factors.push(`Weather: ${weather.summary}`);
    }
  }

  // ── Park memory: historical home win rate at this venue ──
  if (parkData && parkData.games >= 10) {
    const parkRate = parkData.homeWins / parkData.games;
    const parkAdj = (parkRate - 0.52) * 20; // scale ±10pts
    homeEdge += parkAdj;
    if (Math.abs(parkAdj) > 1.5) {
      factors.push(`Park factor: home wins ${(parkRate * 100).toFixed(0)}% here (${parkData.games} games tracked)`);
    }
    // Park avg runs shifts total projection
    totalAdjust += (parkData.avgRuns - 8.5) * 0.3;
  }

  const baseProb = 0.52;
  const prob = Math.min(0.80, Math.max(0.20, baseProb + homeEdge / 100));
  const totalProjection = Math.max(5, 4.5 * (homeERA + awayERA) / 4.0 + totalAdjust);
  const confidence = Math.min(80, Math.abs(homeEdge) * 3 + (homePitcher && awayPitcher ? 20 : 5));

  return { homeWinProb: prob, totalProjection, confidence, factors };
}

// ══════════════════════════════════════════════════════════
// MODEL B: MARKET MODEL
// The sharpest book is closest to truth
// ══════════════════════════════════════════════════════════

function runMarketModel(oddsLines: any[]): ModelPrediction {
  const factors: string[] = [];

  if (oddsLines.length === 0) {
    return { homeWinProb: 0.50, totalProjection: 8.5, confidence: 5, factors: ["No market data"] };
  }

  // De-vig each book
  const homeProbs: number[] = [];
  const overProbs: number[] = [];
  const totals: number[] = [];

  for (const line of oddsLines) {
    if (line.homeML !== 0 && line.awayML !== 0) {
      const { prob1 } = devig(line.homeML, line.awayML);
      homeProbs.push(prob1);
    }
    if (line.overPrice !== 0 && line.underPrice !== 0 && line.total > 0) {
      const { prob1 } = devig(line.overPrice, line.underPrice);
      overProbs.push(prob1);
      totals.push(line.total);
    }
  }

  const avgHomeProb = homeProbs.length > 0 ? homeProbs.reduce((a, b) => a + b, 0) / homeProbs.length : 0.50;
  const avgTotal = totals.length > 0 ? totals.reduce((a, b) => a + b, 0) / totals.length : 8.5;

  factors.push(`Market consensus from ${homeProbs.length} books: ${(avgHomeProb * 100).toFixed(1)}% home`);

  // Check for book disagreements
  if (homeProbs.length >= 2) {
    const spread = Math.max(...homeProbs) - Math.min(...homeProbs);
    if (spread > 0.05) {
      factors.push(`Book disagreement: ${(spread * 100).toFixed(1)}% spread — possible value`);
    }
  }

  // Find the sharpest line (lowest vig = sharpest)
  let lowestVig = Infinity;
  let sharpestProb = avgHomeProb;
  for (const line of oddsLines) {
    if (line.homeML !== 0 && line.awayML !== 0) {
      const impHome = americanToImpliedProb(line.homeML);
      const impAway = americanToImpliedProb(line.awayML);
      const vig = impHome + impAway - 1;
      if (vig < lowestVig) {
        lowestVig = vig;
        sharpestProb = impHome / (impHome + impAway);
      }
    }
  }

  if (lowestVig < Infinity) {
    factors.push(`Sharpest book (${(lowestVig * 100).toFixed(1)}% vig): ${(sharpestProb * 100).toFixed(1)}% home`);
  }

  const confidence = Math.min(75, homeProbs.length * 20 + (homeProbs.length >= 2 ? 15 : 0));

  return { homeWinProb: sharpestProb, totalProjection: avgTotal, confidence, factors };
}

// ══════════════════════════════════════════════════════════
// MODEL C: ELO POWER MODEL
// Elo-driven power ratings as the primary predictive signal
// Formula: P(home wins) = 1 / (1 + 10^((awayElo - (homeElo + 50)) / 400))
// Ratings seeded from season win% when no historical Elo data available
// ══════════════════════════════════════════════════════════

async function runEloPowerModel(homeTeam: string, awayTeam: string): Promise<ModelPrediction> {
  const factors: string[] = [];
  let homeRating = 1500;
  let awayRating = 1500;

  // Helper: fuzzy team match (handles "Athletics" vs "Oakland Athletics" etc)
  function teamMatch(name: string, target: string): boolean {
    if (name === target) return true;
    const nLast = name.split(" ").pop()?.toLowerCase() ?? "";
    const tLast = target.split(" ").pop()?.toLowerCase() ?? "";
    return nLast === tLast && nLast.length > 3;
  }

  // Seed Elo ratings from current standings
  // Formula: rating = 1500 + (winPct − 0.5) × 400
  // → .600 team ≈ 1540, .500 team = 1500, .400 team ≈ 1460
  try {
    const res = await fetch(`${MLB_API}/standings?leagueId=103,104`, { next: { revalidate: 3600 } });
    if (res.ok) {
      const data = await res.json();
      for (const rec of data.records ?? []) {
        for (const team of rec.teamRecords ?? []) {
          const name = team.team?.name ?? "";
          const w = team.wins ?? 0;
          const l = team.losses ?? 0;
          if (w + l < 5) continue; // need enough games for meaningful ratings
          const pct = w / (w + l);
          const seedRating = Math.round(1500 + (pct - 0.5) * 400);
          if (teamMatch(name, homeTeam)) {
            homeRating = seedRating;
            factors.push(`${homeTeam.split(" ").pop()}: ${w}-${l} record → Elo ${seedRating}`);
          }
          if (teamMatch(name, awayTeam)) {
            awayRating = seedRating;
            factors.push(`${awayTeam.split(" ").pop()}: ${w}-${l} record → Elo ${seedRating}`);
          }
        }
      }
    }
  } catch {}

  // PRIMARY SIGNAL: Elo win probability with home advantage (+50 Elo pts)
  // Standard Elo formula: 1 / (1 + 10^((ratingB - ratingA) / 400))
  const HOME_ELO_ADV = 50;
  const eloHomeProb = 1 / (1 + Math.pow(10, (awayRating - (homeRating + HOME_ELO_ADV)) / 400));
  factors.push(`Elo power: ${(eloHomeProb * 100).toFixed(1)}% home win (${homeRating} vs ${awayRating}, +${HOME_ELO_ADV} home)`);

  let homeEdge = (eloHomeProb - 0.5) * 100;

  // SECONDARY: Head-to-head history from Brain memory (cloud — works server-side)
  try {
    const { loadBrainFromCloud } = await import("@/lib/bot/brain");
    const brain = await loadBrainFromCloud();
    if (brain.matchupMemory) {
      const mKey = `${awayTeam.toLowerCase()}::${homeTeam.toLowerCase()}`;
      const matchup = brain.matchupMemory[mKey];
      if (matchup && matchup.games >= 3) {
        const homeRate = matchup.homeWins / matchup.games;
        const h2hAdj = (homeRate - 0.5) * 10;
        homeEdge += h2hAdj;
        factors.push(`H2H: ${homeTeam.split(" ").pop()} ${matchup.homeWins}-${matchup.games - matchup.homeWins} at home (Brain memory)`);
      }
    }
  } catch {}

  const prob = Math.min(0.80, Math.max(0.20, 0.50 + homeEdge / 100));
  const ratingDiff = Math.abs(homeRating - awayRating);
  const confidence = Math.min(65, ratingDiff / 4 + 20);

  return { homeWinProb: prob, totalProjection: 8.5, confidence, factors };
}

// ══════════════════════════════════════════════════════════
// CONSENSUS ENGINE — combines 3 models
// ══════════════════════════════════════════════════════════

function buildConsensus(
  pitcher: ModelPrediction,
  market: ModelPrediction,
  trend: ModelPrediction
): GameAnalysis["consensus"] {
  // Weighted average: market gets most weight (it's real money), pitcher next, trend last
  const marketWeight = 0.40;
  const pitcherWeight = 0.35;
  const trendWeight = 0.25;

  const prob = pitcher.homeWinProb * pitcherWeight +
    market.homeWinProb * marketWeight +
    trend.homeWinProb * trendWeight;

  // Disagreement = standard deviation of the 3 predictions
  const probs = [pitcher.homeWinProb, market.homeWinProb, trend.homeWinProb];
  const mean = probs.reduce((a, b) => a + b, 0) / 3;
  const variance = probs.reduce((s, p) => s + Math.pow(p - mean, 2), 0) / 3;
  const disagreement = Math.sqrt(variance);

  // Confidence based on agreement
  let confidence: GameAnalysis["consensus"]["confidence"];
  const allSameSide = probs.every(p => p > 0.5) || probs.every(p => p < 0.5);

  if (allSameSide && disagreement < 0.05) confidence = "HIGH";
  else if (allSameSide && disagreement < 0.10) confidence = "MEDIUM";
  else if (!allSameSide || disagreement > 0.15) confidence = "NO_PLAY";
  else confidence = "LOW";

  return {
    homeWinProb: prob,
    confidence,
    modelsAgree: allSameSide,
    disagreementLevel: Math.round(disagreement * 100) / 100,
  };
}

// ══════════════════════════════════════════════════════════
// MAIN: Analyze all games
// ══════════════════════════════════════════════════════════

export async function analyzeAllGames(oddsData: any[], scores: any[]): Promise<GameAnalysis[]> {
  const now = Date.now();
  const analyses: GameAnalysis[] = [];

  // Load brain once for park memory (cloud — has trained data)
  let brainParkMemory: Record<string, { games: number; homeWins: number; avgRuns: number; nrfiRate: number }> = {};
  try {
    const { loadBrainFromCloud } = await import("@/lib/bot/brain");
    const brain = await loadBrainFromCloud();
    brainParkMemory = brain.parkMemory ?? {};
  } catch {}

  // Analyze all games passed in (pre-filtered by the API route)
  const futureGames = oddsData.filter(g => {
    if (!g.commenceTime) return true; // no time = include
    const start = new Date(g.commenceTime).getTime();
    return start > now - 4 * 60 * 60 * 1000; // same 4hr window
  });

  for (const game of futureGames.slice(0, 10)) {
    try {
      const homeTeam = game.homeTeam;
      const awayTeam = game.awayTeam;
      const oddsLines = game.oddsLines ?? [];

      // Find probable pitchers + home abbreviation from scores
      const scoreGame = scores.find((s: any) =>
        s.homeTeam === homeTeam || s.homeAbbrev === homeTeam?.split(" ").pop()?.slice(0, 3)
      );
      const homePitcherName = scoreGame?.homePitcher ?? "TBD";
      const awayPitcherName = scoreGame?.awayPitcher ?? "TBD";
      const homeAbbrev: string = scoreGame?.homeAbbrev ?? "";
      const venueName: string = scoreGame?.venue ?? "";

      // Fetch pitcher profiles + weather in parallel
      const [homePitcher, awayPitcher, weather] = await Promise.all([
        buildPitcherProfile(homePitcherName, awayTeam),
        buildPitcherProfile(awayPitcherName, homeTeam),
        homeAbbrev ? import("@/lib/mlb/weather-fatigue").then(m => m.getGameWeather(homeAbbrev)).catch(() => null) : Promise.resolve(null),
      ]);

      // Park memory: prefer venue name, fall back to stadium lookup by abbrev
      let parkData: { games: number; homeWins: number; avgRuns: number } | null = null;
      if (venueName && brainParkMemory[venueName]) {
        parkData = brainParkMemory[venueName];
      } else if (homeAbbrev) {
        // Try matching by stadium name from weather-fatigue STADIUMS map
        const stadiumEntry = Object.entries(brainParkMemory).find(([k]) =>
          k.toLowerCase().includes(homeAbbrev.toLowerCase())
        );
        if (stadiumEntry) parkData = stadiumEntry[1];
      }

      // Run 3 models
      const pitcherModel = runPitcherModel(homePitcher, awayPitcher, homeTeam, awayTeam, weather, parkData);
      const marketModel = runMarketModel(oddsLines);
      const trendModel = await runEloPowerModel(homeTeam, awayTeam);

      // Consensus
      const consensus = buildConsensus(pitcherModel, marketModel, trendModel);

      // Best odds
      let bestHomeML = -999, bestAwayML = -999, bestOver = -999, bestUnder = -999;
      let bestTotal = 0, bestHomeBook = "", bestAwayBook = "";
      for (const line of oddsLines) {
        if (line.homeML > bestHomeML) { bestHomeML = line.homeML; bestHomeBook = line.bookmaker; }
        if (line.awayML > bestAwayML) { bestAwayML = line.awayML; bestAwayBook = line.bookmaker; }
        if (line.overPrice > bestOver) bestOver = line.overPrice;
        if (line.underPrice > bestUnder) bestUnder = line.underPrice;
        if (line.total > 0) bestTotal = line.total;
      }

      // Generate picks
      const picks: GamePick[] = [];
      const gameName = `${awayTeam} @ ${homeTeam}`;

      // ML pick
      if (consensus.confidence !== "NO_PLAY" && bestHomeML !== -999) {
        const isHome = consensus.homeWinProb > 0.50;
        const pickTeam = isHome ? homeTeam : awayTeam;
        const pickOdds = isHome ? bestHomeML : bestAwayML;
        const pickBook = isHome ? bestHomeBook : bestAwayBook;
        const fairProb = isHome ? consensus.homeWinProb : 1 - consensus.homeWinProb;
        const impliedProb = americanToImpliedProb(pickOdds);
        const ev = ((fairProb - impliedProb) / Math.max(impliedProb, 0.01)) * 100;

        picks.push({
          pick: `${pickTeam} ML`,
          market: "moneyline",
          odds: pickOdds,
          bookmaker: pickBook,
          evPercentage: Math.round(ev * 100) / 100,
          fairProb: Math.round(fairProb * 1000) / 10,
          kellyStake: ev > 0 ? kellyStake(fairProb, americanToDecimal(pickOdds), 5000, 0.25) : 0,
          confidence: consensus.confidence === "HIGH" ? "HIGH" : consensus.confidence === "MEDIUM" ? "MEDIUM" : "LOW",
          reasoning: [
            ...pitcherModel.factors.slice(0, 2),
            ...marketModel.factors.slice(0, 1),
            ...trendModel.factors.slice(0, 1),
            `Consensus: ${(consensus.homeWinProb * 100).toFixed(1)}% home | Agreement: ${consensus.modelsAgree ? "YES" : "SPLIT"}`,
          ],
          modelScores: {
            pitcher: Math.round(pitcherModel.homeWinProb * 100),
            market: Math.round(marketModel.homeWinProb * 100),
            trend: Math.round(trendModel.homeWinProb * 100),
          },
        });
      }

      // Total pick
      if (bestTotal > 0 && bestOver !== -999) {
        const avgTotalProj = (pitcherModel.totalProjection + marketModel.totalProjection + trendModel.totalProjection) / 3;
        const isOver = avgTotalProj > bestTotal;

        picks.push({
          pick: `${awayTeam}/${homeTeam} ${isOver ? "Over" : "Under"} ${bestTotal}`,
          market: "total",
          odds: isOver ? bestOver : bestUnder,
          bookmaker: oddsLines[0]?.bookmaker ?? "",
          evPercentage: 0,
          fairProb: 50,
          kellyStake: 0,
          confidence: "LOW",
          reasoning: [
            `Projected total: ${avgTotalProj.toFixed(1)} runs (line: ${bestTotal})`,
            `Pitcher model: ${pitcherModel.totalProjection.toFixed(1)} | Market: ${marketModel.totalProjection.toFixed(1)}`,
          ],
          modelScores: {
            pitcher: Math.round(pitcherModel.totalProjection * 10),
            market: Math.round(marketModel.totalProjection * 10),
            trend: Math.round(trendModel.totalProjection * 10),
          },
        });
      }

      analyses.push({
        gameId: game.id,
        homeTeam, awayTeam,
        commenceTime: game.commenceTime,
        bestHomeML, bestAwayML, bestOver, bestUnder, bestTotal,
        bestHomeBook, bestAwayBook,
        pitcherModel, marketModel, trendModel,
        consensus,
        picks,
        homePitcher, awayPitcher,
      });
    } catch (err) {
      // Skip game on error
    }
  }

  // Sort by consensus confidence
  const order = { HIGH: 0, MEDIUM: 1, LOW: 2, NO_PLAY: 3 };
  analyses.sort((a, b) => order[a.consensus.confidence] - order[b.consensus.confidence]);

  return analyses;
}
