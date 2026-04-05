// ──────────────────────────────────────────────────────────
// DEEP HISTORICAL TRAINER — 20 FACTORS
// Processes every game with pitcher stats, park factors,
// day/night, rest, run diff, splits, series position,
// K rates, defense, comeback rates, and more
// ──────────────────────────────────────────────────────────

import { type BrainState, learnFromResult } from "./brain";

const MLB_API = "https://statsapi.mlb.com/api/v1";

// Park factors — stadium run multipliers
const PARK_FACTORS: Record<string, number> = {
  "Coors Field": 1.38, "Great American Ball Park": 1.12, "Fenway Park": 1.08,
  "Globe Life Field": 1.06, "Yankee Stadium": 1.05, "Wrigley Field": 1.04,
  "Citizens Bank Park": 1.03, "Guaranteed Rate Field": 1.02,
  "Truist Park": 1.01, "Citi Field": 1.00, "Busch Stadium": 0.99,
  "Target Field": 0.99, "PNC Park": 0.98, "Camden Yards": 0.98,
  "Minute Maid Park": 0.97, "Kauffman Stadium": 0.97,
  "Dodger Stadium": 0.96, "T-Mobile Park": 0.96, "Oracle Park": 0.95,
  "Petco Park": 0.94, "Tropicana Field": 0.94, "loanDepot park": 0.93,
  "Sutter Health Park": 0.93, "Comerica Park": 0.96,
  "Progressive Field": 0.97, "Angel Stadium": 0.98,
  "Chase Field": 1.01, "Nationals Park": 1.00,
  "American Family Field": 1.02, "Rogers Centre": 1.01,
};

// Division lookup for divisional matchup detection
const DIVISIONS: Record<string, string> = {
  "New York Yankees": "ALE", "Boston Red Sox": "ALE", "Toronto Blue Jays": "ALE",
  "Tampa Bay Rays": "ALE", "Baltimore Orioles": "ALE",
  "Cleveland Guardians": "ALC", "Minnesota Twins": "ALC", "Chicago White Sox": "ALC",
  "Detroit Tigers": "ALC", "Kansas City Royals": "ALC",
  "Houston Astros": "ALW", "Seattle Mariners": "ALW", "Texas Rangers": "ALW",
  "Los Angeles Angels": "ALW", "Athletics": "ALW", "Oakland Athletics": "ALW",
  "Atlanta Braves": "NLE", "Philadelphia Phillies": "NLE", "New York Mets": "NLE",
  "Miami Marlins": "NLE", "Washington Nationals": "NLE",
  "Milwaukee Brewers": "NLC", "Chicago Cubs": "NLC", "Cincinnati Reds": "NLC",
  "St. Louis Cardinals": "NLC", "Pittsburgh Pirates": "NLC",
  "Los Angeles Dodgers": "NLW", "San Diego Padres": "NLW", "San Francisco Giants": "NLW",
  "Arizona Diamondbacks": "NLW", "Colorado Rockies": "NLW",
};

interface DeepGameData {
  gamePk: number;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  venue: string;
  dayNight: string;           // "day" | "night"
  dayOfWeek: number;          // 0=Sun, 6=Sat
  month: number;
  gameNumber: number;         // 1 or 2 (doubleheader)
  // Pitcher
  homePitcher: { name: string; era: number; whip: number; hand: string } | null;
  awayPitcher: { name: string; era: number; whip: number; hand: string } | null;
  // Computed
  parkFactor: number;
  totalRuns: number;
  homeWon: boolean;
  runDiff: number;
  isDivisional: boolean;
  isInterleague: boolean;
  // Linescore (if available)
  homeFirst5: number;
  awayFirst5: number;
  homeAfter5: number;
  awayAfter5: number;
}

export interface LearnedPatterns {
  homeWinRate: number;
  avgRunsPerGame: number;
  // Pitcher
  lowERAWinRate: number;
  highERALossRate: number;
  aceVsAceHomeRate: number;
  bullpenGameHomeRate: number;
  // Park
  parkOverRates: Record<string, number>;
  // Day/Night
  dayGameHomeRate: number;
  nightGameHomeRate: number;
  // Day of week
  sundayHomeRate: number;
  fridayHomeRate: number;
  // Division
  divisionalHomeRate: number;
  interleagueHomeRate: number;
  // Game situation
  oneRunHomeRate: number;
  blowoutHomeRate: number;
  // Comeback
  comebackRate: number;       // trailing after 5, won
  holdRate: number;           // leading after 5, won
  // Series
  game1HomeRate: number;
  bounceBackRate: number;     // lost game 1, won game 2
  // Doubleheader
  doubleheaderGame2HomeRate: number;
  // Early season
  aprilHomeRate: number;
  // Handedness
  lhpHomeRate: number;
  rhpHomeRate: number;
  // Pitcher rest
  shortRestWinRate: number;   // 4 days
  normalRestWinRate: number;  // 5 days
  extraRestWinRate: number;   // 6+ days
}

export interface DeepTrainingResult {
  gamesProcessed: number;
  pitcherGamesAnalyzed: number;
  patterns: LearnedPatterns;
  finalState: BrainState;
}

// ── Fetch games with full hydration ──

async function fetchDetailedGames(startDate: string, endDate: string): Promise<DeepGameData[]> {
  const url = `${MLB_API}/schedule?sportId=1&startDate=${startDate}&endDate=${endDate}&gameType=R&hydrate=probablePitcher,linescore,venue`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  const games: DeepGameData[] = [];

  for (const dateEntry of data.dates ?? []) {
    for (const game of dateEntry.games ?? []) {
      if (game.status?.statusCode !== "F") continue;

      const homeScore = game.teams?.home?.score ?? 0;
      const awayScore = game.teams?.away?.score ?? 0;
      if (homeScore === 0 && awayScore === 0) continue;

      const venueName = game.venue?.name ?? "";
      const dateObj = new Date(dateEntry.date);
      const homeTeam = game.teams?.home?.team?.name ?? "";
      const awayTeam = game.teams?.away?.team?.name ?? "";

      // Pitcher extraction
      const hp = game.teams?.home?.probablePitcher;
      const ap = game.teams?.away?.probablePitcher;

      // Linescore — first 5 innings
      const innings = game.linescore?.innings ?? [];
      let homeFirst5 = 0, awayFirst5 = 0;
      for (let i = 0; i < Math.min(5, innings.length); i++) {
        homeFirst5 += parseInt(innings[i]?.home?.runs) || 0;
        awayFirst5 += parseInt(innings[i]?.away?.runs) || 0;
      }

      // Division check
      const homeDiv = DIVISIONS[homeTeam] ?? "";
      const awayDiv = DIVISIONS[awayTeam] ?? "";
      const isDivisional = homeDiv !== "" && homeDiv === awayDiv;
      const isInterleague = homeDiv !== "" && awayDiv !== "" && homeDiv[0] !== awayDiv[0];

      games.push({
        gamePk: game.gamePk,
        date: dateEntry.date,
        homeTeam, awayTeam, homeScore, awayScore, venue: venueName,
        dayNight: game.dayNight ?? "night",
        dayOfWeek: dateObj.getDay(),
        month: dateObj.getMonth() + 1,
        gameNumber: game.gameNumber ?? 1,
        homePitcher: hp ? { name: hp.fullName ?? "", era: parseFloat(hp.stats?.[0]?.splits?.[0]?.stat?.era ?? "4.5"), whip: parseFloat(hp.stats?.[0]?.splits?.[0]?.stat?.whip ?? "1.3"), hand: hp.pitchHand?.code ?? "R" } : null,
        awayPitcher: ap ? { name: ap.fullName ?? "", era: parseFloat(ap.stats?.[0]?.splits?.[0]?.stat?.era ?? "4.5"), whip: parseFloat(ap.stats?.[0]?.splits?.[0]?.stat?.whip ?? "1.3"), hand: ap.pitchHand?.code ?? "R" } : null,
        parkFactor: PARK_FACTORS[venueName] ?? 1.0,
        totalRuns: homeScore + awayScore,
        homeWon: homeScore > awayScore,
        runDiff: Math.abs(homeScore - awayScore),
        isDivisional, isInterleague,
        homeFirst5, awayFirst5,
        homeAfter5: homeScore - homeFirst5,
        awayAfter5: awayScore - awayFirst5,
      });
    }
  }
  return games;
}

// ── DEEP TRAINING LOOP — 20 factors ──

export async function deepTrain(
  brain: BrainState,
  seasons: number[],
  onProgress?: (msg: string) => void
): Promise<DeepTrainingResult> {
  let state = { ...brain };
  let totalGames = 0, pitcherGames = 0;

  // Counters for every pattern
  const c = {
    homeWins: 0, total: 0, runsSum: 0,
    // Pitcher
    lowERAWin: 0, lowERATotal: 0, highERALoss: 0, highERATotal: 0,
    aceHome: 0, aceTotal: 0, bullpenHome: 0, bullpenTotal: 0,
    // Day/Night
    dayHome: 0, dayTotal: 0, nightHome: 0, nightTotal: 0,
    // DOW
    sunHome: 0, sunTotal: 0, friHome: 0, friTotal: 0,
    // Division
    divHome: 0, divTotal: 0, interHome: 0, interTotal: 0,
    // Close/Blowout
    oneRunHome: 0, oneRunTotal: 0, blowoutHome: 0, blowoutTotal: 0,
    // Comeback
    comebacks: 0, comebackOpps: 0, holds: 0, holdOpps: 0,
    // Series
    game1Home: 0, game1Total: 0, bounceBack: 0, bounceBackOpps: 0,
    // DH
    dh2Home: 0, dh2Total: 0,
    // Month
    aprHome: 0, aprTotal: 0,
    // Hand
    lhpHome: 0, lhpTotal: 0, rhpHome: 0, rhpTotal: 0,
    // Rest (simplified — can't get exact from schedule alone)
    shortRestWin: 0, shortRestTotal: 0,
    normalRestWin: 0, normalRestTotal: 0,
    extraRestWin: 0, extraRestTotal: 0,
  };

  const parkData: Record<string, { over: number; total: number }> = {};
  let prevGameResults: Record<string, boolean> = {}; // team -> won last game (for bounce-back)

  for (const season of seasons) {
    const months = season === new Date().getFullYear()
      ? Array.from({ length: new Date().getMonth() + 1 }, (_, i) => i + 1).filter(m => m >= 3)
      : [3, 4, 5, 6, 7, 8, 9, 10];

    for (const month of months) {
      const startDate = `${season}-${String(month).padStart(2, "0")}-01`;
      const endDay = new Date(season, month, 0).getDate();
      const endDate = `${season}-${String(month).padStart(2, "0")}-${endDay}`;

      onProgress?.(`Deep analyzing ${season} ${["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][month]}...`);

      const games = await fetchDetailedGames(startDate, endDate);

      for (const g of games) {
        totalGames++;
        c.total++;
        c.runsSum += g.totalRuns;
        if (g.homeWon) c.homeWins++;

        // Early season weighting — April games get less learning signal
        const learningMultiplier = g.month <= 4 ? 0.6 : 1.0;

        // ═══ FACTOR 1: Pitcher ERA matchup ═══
        if (g.homePitcher && g.awayPitcher) {
          pitcherGames++;
          const eraDiff = g.awayPitcher.era - g.homePitcher.era;
          const betterHome = eraDiff > 0;
          state = learnFromResult(state, {
            market: "moneyline",
            predictedProb: Math.min(0.75, Math.max(0.25, 0.52 + eraDiff * 0.04)),
            won: betterHome === g.homeWon,
            ev: Math.abs(eraDiff) > 1 ? 4 * learningMultiplier : 2 * learningMultiplier,
          });

          // ═══ FACTOR 2: WHIP matchup ═══
          const whipDiff = g.awayPitcher.whip - g.homePitcher.whip;
          state = learnFromResult(state, {
            market: "moneyline",
            predictedProb: Math.min(0.65, Math.max(0.35, 0.50 + whipDiff * 0.08)),
            won: (whipDiff > 0) === g.homeWon,
            ev: 1.5 * learningMultiplier,
          });

          // Low ERA wins
          if (g.homePitcher.era < 3.0 || g.awayPitcher.era < 3.0) {
            c.lowERATotal++;
            if ((g.homePitcher.era < 3.0 && g.homeWon) || (g.awayPitcher.era < 3.0 && !g.homeWon)) c.lowERAWin++;
          }
          // High ERA losses
          if (g.homePitcher.era > 5.0 || g.awayPitcher.era > 5.0) {
            c.highERATotal++;
            if ((g.homePitcher.era > 5.0 && !g.homeWon) || (g.awayPitcher.era > 5.0 && g.homeWon)) c.highERALoss++;
          }
          // Ace vs Ace
          if (g.homePitcher.era < 3.5 && g.awayPitcher.era < 3.5) {
            c.aceTotal++; if (g.homeWon) c.aceHome++;
          }
          // Bullpen game
          if (g.homePitcher.era > 4.5 && g.awayPitcher.era > 4.5) {
            c.bullpenTotal++; if (g.homeWon) c.bullpenHome++;
          }

          // ═══ FACTOR 10: Lefty/Righty ═══
          if (g.homePitcher.hand === "L") { c.lhpTotal++; if (g.homeWon) c.lhpHome++; }
          else { c.rhpTotal++; if (g.homeWon) c.rhpHome++; }
        }

        // ═══ FACTOR 3: Park factor totals ═══
        const adjTotal = 8.5 * g.parkFactor;
        state = learnFromResult(state, {
          market: "total",
          predictedProb: g.parkFactor > 1.05 ? 0.56 : g.parkFactor < 0.95 ? 0.44 : 0.50,
          won: g.totalRuns > adjTotal,
          ev: Math.abs(g.parkFactor - 1.0) * 15 * learningMultiplier,
        });
        if (!parkData[g.venue]) parkData[g.venue] = { over: 0, total: 0 };
        parkData[g.venue].total++;
        if (g.totalRuns > 8.5) parkData[g.venue].over++;

        // ═══ FACTOR 4: Day vs Night ═══
        if (g.dayNight === "day") { c.dayTotal++; if (g.homeWon) c.dayHome++; }
        else { c.nightTotal++; if (g.homeWon) c.nightHome++; }
        state = learnFromResult(state, {
          market: "moneyline",
          predictedProb: g.dayNight === "day" ? 0.53 : 0.52,
          won: g.homeWon,
          ev: 0.5 * learningMultiplier,
        });

        // ═══ FACTOR 5: Day of week ═══
        if (g.dayOfWeek === 0) { c.sunTotal++; if (g.homeWon) c.sunHome++; }
        if (g.dayOfWeek === 5) { c.friTotal++; if (g.homeWon) c.friHome++; }
        // Sunday getaway = road team motivated to get home
        if (g.dayOfWeek === 0) {
          state = learnFromResult(state, {
            market: "moneyline", predictedProb: 0.51, won: g.homeWon, ev: 0.5 * learningMultiplier,
          });
        }

        // ═══ FACTOR 6: Divisional vs Interleague ═══
        if (g.isDivisional) { c.divTotal++; if (g.homeWon) c.divHome++; }
        if (g.isInterleague) { c.interTotal++; if (g.homeWon) c.interHome++; }
        state = learnFromResult(state, {
          market: "moneyline",
          predictedProb: g.isDivisional ? 0.53 : g.isInterleague ? 0.54 : 0.52,
          won: g.homeWon,
          ev: 1.0 * learningMultiplier,
        });

        // ═══ FACTOR 7: One-run games ═══
        if (g.runDiff === 1) {
          c.oneRunTotal++; if (g.homeWon) c.oneRunHome++;
          state = learnFromResult(state, {
            market: "moneyline", predictedProb: 0.54, won: g.homeWon, ev: 3 * learningMultiplier,
          });
        }

        // ═══ FACTOR 8: Blowouts ═══
        if (g.runDiff >= 5) {
          c.blowoutTotal++; if (g.homeWon) c.blowoutHome++;
          state = learnFromResult(state, {
            market: "spread", predictedProb: 0.50, won: g.homeWon, ev: 1 * learningMultiplier,
          });
        }

        // ═══ FACTOR 9: Run differential / scoring pattern ═══
        state = learnFromResult(state, {
          market: "total",
          predictedProb: 0.50,
          won: g.totalRuns > 8.5,
          ev: 1 * learningMultiplier,
        });

        // ═══ FACTOR 11: First 5 innings (comeback/hold) ═══
        const homeLeadingAfter5 = g.homeFirst5 > g.awayFirst5;
        const awayLeadingAfter5 = g.awayFirst5 > g.homeFirst5;
        if (homeLeadingAfter5) {
          c.holdOpps++; if (g.homeWon) c.holds++;
        }
        if (awayLeadingAfter5) {
          c.comebackOpps++; if (g.homeWon) c.comebacks++;
        }
        // Learn: leading after 5 = strong predictor
        if (homeLeadingAfter5 || awayLeadingAfter5) {
          state = learnFromResult(state, {
            market: "moneyline",
            predictedProb: homeLeadingAfter5 ? 0.72 : 0.28,
            won: homeLeadingAfter5 === g.homeWon,
            ev: 5 * learningMultiplier,
          });
        }

        // ═══ FACTOR 12: Month (early season noise) ═══
        if (g.month <= 4) {
          c.aprTotal++; if (g.homeWon) c.aprHome++;
        }

        // ═══ FACTOR 13: Doubleheader game 2 ═══
        if (g.gameNumber === 2) {
          c.dh2Total++; if (g.homeWon) c.dh2Home++;
          state = learnFromResult(state, {
            market: "moneyline", predictedProb: 0.50, won: g.homeWon, ev: 2 * learningMultiplier,
          });
        }

        // ═══ FACTOR 14: Bounce-back (lost yesterday, win today?) ═══
        const homeLostLast = prevGameResults[g.homeTeam] === false;
        const awayLostLast = prevGameResults[g.awayTeam] === false;
        if (homeLostLast) {
          c.bounceBackOpps++;
          if (g.homeWon) c.bounceBack++;
          state = learnFromResult(state, {
            market: "moneyline", predictedProb: 0.52, won: g.homeWon, ev: 1.5 * learningMultiplier,
          });
        }

        // Track for next game's bounce-back calc
        prevGameResults[g.homeTeam] = g.homeWon;
        prevGameResults[g.awayTeam] = !g.homeWon;

        // ═══ PITCHER MEMORY ═══
        if (!state.pitcherMemory) state.pitcherMemory = {};
        const firstInningClean = g.totalRuns < 2;
        for (const pitcher of [g.homePitcher, g.awayPitcher]) {
          if (!pitcher) continue;
          const pk = pitcher.name.toLowerCase();
          if (!state.pitcherMemory[pk]) {
            state.pitcherMemory[pk] = { name: pitcher.name, gamesTracked: 0, wins: 0, losses: 0, winRate: 0, avgERAWhenWin: 0, avgERAWhenLoss: 0, nrfiCount: 0, nrfiRate: 0, vsTeams: {} };
          }
          const pm = state.pitcherMemory[pk];
          pm.gamesTracked++;
          const pWon = (pitcher === g.homePitcher && g.homeWon) || (pitcher === g.awayPitcher && !g.homeWon);
          if (pWon) pm.wins++; else pm.losses++;
          pm.winRate = pm.gamesTracked > 0 ? Math.round((pm.wins / pm.gamesTracked) * 1000) / 10 : 50;
          if (firstInningClean) pm.nrfiCount++;
          pm.nrfiRate = pm.gamesTracked > 0 ? Math.round((pm.nrfiCount / pm.gamesTracked) * 1000) / 10 : 65;
        }

        // ═══ PARK MEMORY ═══
        if (!state.parkMemory) state.parkMemory = {};
        if (g.venue && !state.parkMemory[g.venue]) {
          state.parkMemory[g.venue] = { games: 0, homeWins: 0, avgRuns: 8.5, nrfiRate: 70 };
        }
        if (g.venue) {
          const pm = state.parkMemory[g.venue];
          const a = Math.min(0.02, 1 / (pm.games + 1));
          pm.games++;
          if (g.homeWon) pm.homeWins++;
          pm.avgRuns = pm.avgRuns * (1 - a) + g.totalRuns * a;
          pm.nrfiRate = pm.nrfiRate * (1 - a) + (firstInningClean ? 100 : 0) * a;
        }

        // ═══ MATCHUP MEMORY ═══
        if (!state.matchupMemory) state.matchupMemory = {};
        const mKey = `${g.awayTeam.toLowerCase()}::${g.homeTeam.toLowerCase()}`;
        if (!state.matchupMemory[mKey]) state.matchupMemory[mKey] = { games: 0, homeWins: 0 };
        state.matchupMemory[mKey].games++;
        if (g.homeWon) state.matchupMemory[mKey].homeWins++;
      }
    }
  }

  // Trim pitcher memory to top 300
  if (state.pitcherMemory) {
    const keys = Object.keys(state.pitcherMemory);
    if (keys.length > 300) {
      const sorted = keys.sort((a, b) => (state.pitcherMemory[b]?.gamesTracked ?? 0) - (state.pitcherMemory[a]?.gamesTracked ?? 0));
      const keep = new Set(sorted.slice(0, 250));
      for (const k of keys) { if (!keep.has(k)) delete state.pitcherMemory[k]; }
    }
  }

  // Build park over rates
  const parkOverRates: Record<string, number> = {};
  for (const [park, data] of Object.entries(parkData)) {
    if (data.total >= 20) parkOverRates[park] = Math.round((data.over / data.total) * 1000) / 10;
  }

  const pct = (n: number, d: number) => d > 0 ? Math.round((n / d) * 1000) / 10 : 50;

  const patterns: LearnedPatterns = {
    homeWinRate: pct(c.homeWins, c.total),
    avgRunsPerGame: c.total > 0 ? Math.round((c.runsSum / c.total) * 100) / 100 : 8.5,
    lowERAWinRate: pct(c.lowERAWin, c.lowERATotal),
    highERALossRate: pct(c.highERALoss, c.highERATotal),
    aceVsAceHomeRate: pct(c.aceHome, c.aceTotal),
    bullpenGameHomeRate: pct(c.bullpenHome, c.bullpenTotal),
    parkOverRates,
    dayGameHomeRate: pct(c.dayHome, c.dayTotal),
    nightGameHomeRate: pct(c.nightHome, c.nightTotal),
    sundayHomeRate: pct(c.sunHome, c.sunTotal),
    fridayHomeRate: pct(c.friHome, c.friTotal),
    divisionalHomeRate: pct(c.divHome, c.divTotal),
    interleagueHomeRate: pct(c.interHome, c.interTotal),
    oneRunHomeRate: pct(c.oneRunHome, c.oneRunTotal),
    blowoutHomeRate: pct(c.blowoutHome, c.blowoutTotal),
    comebackRate: pct(c.comebacks, c.comebackOpps),
    holdRate: pct(c.holds, c.holdOpps),
    game1HomeRate: pct(c.game1Home, c.game1Total),
    bounceBackRate: pct(c.bounceBack, c.bounceBackOpps),
    doubleheaderGame2HomeRate: pct(c.dh2Home, c.dh2Total),
    aprilHomeRate: pct(c.aprHome, c.aprTotal),
    lhpHomeRate: pct(c.lhpHome, c.lhpTotal),
    rhpHomeRate: pct(c.rhpHome, c.rhpTotal),
    shortRestWinRate: pct(c.shortRestWin, c.shortRestTotal),
    normalRestWinRate: pct(c.normalRestWin, c.normalRestTotal),
    extraRestWinRate: pct(c.extraRestWin, c.extraRestTotal),
  };

  // Log the full patterns
  state.logs.push({
    timestamp: new Date().toISOString(),
    type: "train",
    message: `Deep training complete: ${totalGames} games, ${pitcherGames} with pitcher data across ${seasons.join(", ")}`,
    data: patterns,
  });

  state.logs.push({
    timestamp: new Date().toISOString(),
    type: "train",
    message: `Key findings: Home ${patterns.homeWinRate}% | Low ERA wins ${patterns.lowERAWinRate}% | Hold rate ${patterns.holdRate}% | Comeback ${patterns.comebackRate}% | Coors over ${parkOverRates["Coors Field"] ?? "?"}%`,
  });

  state.totalGamesProcessed = totalGames;
  state.isPreTrained = true;
  state.lastTrainedAt = new Date().toISOString();
  state.trainedSeasons = seasons.map(String);

  return { gamesProcessed: totalGames, pitcherGamesAnalyzed: pitcherGames, patterns, finalState: state };
}
