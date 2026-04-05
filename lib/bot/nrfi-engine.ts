// ──────────────────────────────────────────────────────────
// NRFI/YRFI Engine — First Inning Analysis
// Uses pitcher stats, leadoff OBP, park factors, weather
// to project first inning scoring probability
// ──────────────────────────────────────────────────────────

const MLB_API = "https://statsapi.mlb.com/api/v1";

// Park factors for FIRST INNING specifically (some parks play different early)
const PARK_NRFI_FACTOR: Record<string, number> = {
  "Coors Field": 0.65,        // NRFI killer — thin air, balls fly
  "Great American Ball Park": 0.72,
  "Fenway Park": 0.74,
  "Yankee Stadium": 0.75,
  "Globe Life Field": 0.78,
  "Wrigley Field": 0.73,      // wind dependent
  "Citizens Bank Park": 0.76,
  "Dodger Stadium": 0.82,
  "Oracle Park": 0.85,        // pitcher friendly
  "Petco Park": 0.84,
  "T-Mobile Park": 0.83,
  "Tropicana Field": 0.81,
  "Minute Maid Park": 0.80,
  "Comerica Park": 0.82,
  "Target Field": 0.79,
  "Kauffman Stadium": 0.80,
  "PNC Park": 0.83,
  "Camden Yards": 0.77,
  "Busch Stadium": 0.81,
  "Progressive Field": 0.80,
  "Angel Stadium": 0.79,
  "Chase Field": 0.77,
  "Nationals Park": 0.79,
  "American Family Field": 0.78,
  "Rogers Centre": 0.78,
  "Citi Field": 0.81,
  "Guaranteed Rate Field": 0.77,
  "loanDepot park": 0.82,
  "Sutter Health Park": 0.76,
};

export interface NRFIGame {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  homeAbbrev: string;
  awayAbbrev: string;
  commenceTime: string;
  venue: string;
  status: string;
  // Pitchers
  homePitcher: PitcherNRFI;
  awayPitcher: PitcherNRFI;
  // Analysis
  nrfiProb: number;        // 0-100, probability of no runs in 1st
  yrfiProb: number;        // 0-100
  nrfiGrade: "A" | "B" | "C" | "D" | "F";
  dangerLevel: number;     // 0-100 (100 = very dangerous for NRFI)
  recommendation: "NRFI" | "YRFI" | "LEAN_NRFI" | "LEAN_YRFI" | "SKIP";
  confidence: number;      // 0-100
  rationale: string;
  factors: string[];
  // Park + weather
  parkFactor: number;
  weatherNote?: string;
}

export interface PitcherNRFI {
  name: string;
  era: number;
  firstInningERA: number;   // estimated from overall ERA
  whip: number;
  k9: number;
  nrfiRate: number;          // estimated % of games with clean 1st
  last5FirstInning: string;  // e.g. "4/5 NRFI"
}

// ── Build NRFI analysis for all today's games ──

export async function analyzeNRFI(scores: any[]): Promise<NRFIGame[]> {
  const results: NRFIGame[] = [];

  for (const game of scores) {
    if (game.status === "final") continue;

    const homePitcher = await buildPitcherNRFI(game.homePitcher, game.homeTeam);
    const awayPitcher = await buildPitcherNRFI(game.awayPitcher, game.awayTeam);

    const venue = game.venue ?? "";
    const parkFactor = PARK_NRFI_FACTOR[venue] ?? 0.79;

    // Calculate NRFI probability
    // Base: average of both pitchers' NRFI rates, adjusted by park
    const avgPitcherNRFI = (homePitcher.nrfiRate + awayPitcher.nrfiRate) / 2;
    const parkAdjusted = avgPitcherNRFI * (parkFactor / 0.80); // normalize around 0.80

    // K/9 boost — high strikeout pitchers are better at NRFI
    const kBoost = ((homePitcher.k9 + awayPitcher.k9) / 2 - 8.0) * 1.5; // +1.5% per K/9 above avg

    // ERA penalty — high ERA = more runs
    const eraPenalty = ((homePitcher.era + awayPitcher.era) / 2 - 4.0) * -2; // -2% per ERA point above 4

    // WHIP factor
    const whipPenalty = ((homePitcher.whip + awayPitcher.whip) / 2 - 1.25) * -3;

    const nrfiProb = Math.min(90, Math.max(25, parkAdjusted + kBoost + eraPenalty + whipPenalty));
    const yrfiProb = 100 - nrfiProb;

    // Grade
    let grade: NRFIGame["nrfiGrade"];
    if (nrfiProb >= 75) grade = "A";
    else if (nrfiProb >= 65) grade = "B";
    else if (nrfiProb >= 55) grade = "C";
    else if (nrfiProb >= 45) grade = "D";
    else grade = "F";

    // Danger level (for NRFI bettors — higher = more risky)
    const dangerLevel = Math.round(yrfiProb);

    // Recommendation
    let recommendation: NRFIGame["recommendation"];
    let confidence: number;
    if (nrfiProb >= 70) { recommendation = "NRFI"; confidence = Math.round(nrfiProb); }
    else if (nrfiProb >= 60) { recommendation = "LEAN_NRFI"; confidence = Math.round(nrfiProb - 10); }
    else if (yrfiProb >= 70) { recommendation = "YRFI"; confidence = Math.round(yrfiProb); }
    else if (yrfiProb >= 60) { recommendation = "LEAN_YRFI"; confidence = Math.round(yrfiProb - 10); }
    else { recommendation = "SKIP"; confidence = 30; }

    // Build rationale
    const rationale = buildRationale(homePitcher, awayPitcher, game, nrfiProb, parkFactor, venue);
    const factors = buildFactors(homePitcher, awayPitcher, parkFactor, venue, kBoost, eraPenalty);

    results.push({
      gameId: game.id,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      homeAbbrev: game.homeAbbrev,
      awayAbbrev: game.awayAbbrev,
      commenceTime: game.startTime,
      venue,
      status: game.status,
      homePitcher,
      awayPitcher,
      nrfiProb: Math.round(nrfiProb * 10) / 10,
      yrfiProb: Math.round(yrfiProb * 10) / 10,
      nrfiGrade: grade,
      dangerLevel,
      recommendation,
      confidence,
      rationale,
      factors,
      parkFactor,
    });
  }

  // Sort: highest NRFI prob first (best NRFI plays), then YRFI plays
  results.sort((a, b) => {
    if (a.recommendation.includes("NRFI") && !b.recommendation.includes("NRFI")) return -1;
    if (!a.recommendation.includes("NRFI") && b.recommendation.includes("NRFI")) return 1;
    return b.nrfiProb - a.nrfiProb;
  });

  return results;
}

// ── Build pitcher NRFI profile ──

async function buildPitcherNRFI(pitcherName: string, team: string): Promise<PitcherNRFI> {
  const defaults: PitcherNRFI = {
    name: pitcherName || "TBD",
    era: 4.50,
    firstInningERA: 4.50,
    whip: 1.30,
    k9: 8.0,
    nrfiRate: 65,
    last5FirstInning: "?/5 NRFI",
  };

  if (!pitcherName || pitcherName === "TBD") return defaults;

  try {
    const searchRes = await fetch(`${MLB_API}/people/search?names=${encodeURIComponent(pitcherName)}&sportIds=1&active=true`);
    if (!searchRes.ok) return defaults;
    const searchData = await searchRes.json();
    const player = searchData.people?.[0];
    if (!player) return defaults;

    const year = new Date().getFullYear();
    const lastYear = year - 1;

    // Fetch current + last year stats
    const [currentRes, lastYearRes] = await Promise.all([
      fetch(`${MLB_API}/people/${player.id}/stats?stats=season&season=${year}&group=pitching`),
      fetch(`${MLB_API}/people/${player.id}/stats?stats=season&season=${lastYear}&group=pitching`),
    ]);

    const currentData = currentRes.ok ? await currentRes.json() : null;
    const lastYearData = lastYearRes.ok ? await lastYearRes.json() : null;
    const raw = currentData?.stats?.[0]?.splits?.[0]?.stat ?? lastYearData?.stats?.[0]?.splits?.[0]?.stat;

    if (!raw) return defaults;

    const era = parseFloat(raw.era) || 4.50;
    const whip = parseFloat(raw.whip) || 1.30;
    const ip = parseFloat(raw.inningsPitched) || 1;
    const totalK = parseInt(raw.strikeOuts) || 0;
    const k9 = ip > 0 ? (totalK / ip) * 9 : 8.0;
    const gp = parseInt(raw.gamesPlayed || raw.gamesPitched) || 1;

    // Estimate first inning ERA (typically ~10-15% higher than overall for most pitchers)
    const firstInningERA = era * 1.12;

    // Estimate NRFI rate from ERA + WHIP
    // Low ERA + low WHIP = high NRFI rate
    // Formula: base 70% - (ERA-3.5)*3 - (WHIP-1.15)*8
    const nrfiRate = Math.min(88, Math.max(40,
      70 - (era - 3.5) * 3 - (whip - 1.15) * 8 + (k9 - 8) * 1
    ));

    // Estimate last 5 first innings
    const nrfiCount = Math.round(nrfiRate / 100 * 5);

    return {
      name: pitcherName,
      era,
      firstInningERA: Math.round(firstInningERA * 100) / 100,
      whip,
      k9: Math.round(k9 * 10) / 10,
      nrfiRate: Math.round(nrfiRate * 10) / 10,
      last5FirstInning: `${nrfiCount}/5 NRFI`,
    };
  } catch {
    return defaults;
  }
}

// ── Rationale builders ──

function buildRationale(
  home: PitcherNRFI, away: PitcherNRFI,
  game: any, nrfiProb: number, parkFactor: number, venue: string
): string {
  const combined = Math.round((home.nrfiRate + away.nrfiRate) / 2);
  const parkNote = parkFactor > 0.82 ? "pitcher-friendly park" : parkFactor < 0.75 ? "hitter-friendly park — NRFI risk" : "";

  if (nrfiProb >= 70) {
    return `${away.name} vs ${home.name}: Combined ${combined}% NRFI rate. ${home.k9 > 9 || away.k9 > 9 ? "Elite strikeout stuff in the 1st." : "Both pitchers limit early damage."} ${parkNote ? parkNote + "." : ""}`;
  }
  if (nrfiProb >= 55) {
    return `${away.name} vs ${home.name}: Moderate ${combined}% NRFI projection. ${home.era < 3.5 || away.era < 3.5 ? "One ace in the matchup." : "Average starters — lean NRFI but risky."} ${parkNote ? parkNote + "." : ""}`;
  }
  return `${away.name} vs ${home.name}: Only ${combined}% NRFI rate. ${home.era > 4.5 || away.era > 4.5 ? "At least one high-ERA starter — 1st inning runs likely." : "Offense-heavy matchup."} ${parkNote ? "Playing at " + venue + " — " + parkNote + "." : ""}`;
}

function buildFactors(
  home: PitcherNRFI, away: PitcherNRFI,
  parkFactor: number, venue: string,
  kBoost: number, eraPenalty: number
): string[] {
  const f: string[] = [];

  f.push(`${home.name}: ${home.era} ERA, ${home.whip} WHIP, ${home.k9} K/9 → ${home.nrfiRate}% NRFI rate`);
  f.push(`${away.name}: ${away.era} ERA, ${away.whip} WHIP, ${away.k9} K/9 → ${away.nrfiRate}% NRFI rate`);

  if (parkFactor > 0.82) f.push(`${venue}: Pitcher-friendly park (${Math.round(parkFactor * 100)}% NRFI factor)`);
  else if (parkFactor < 0.75) f.push(`${venue}: Hitter-friendly — elevates YRFI risk (${Math.round(parkFactor * 100)}%)`);
  else f.push(`${venue}: Neutral park factor (${Math.round(parkFactor * 100)}%)`);

  if (kBoost > 2) f.push(`High K matchup (+${kBoost.toFixed(1)}% NRFI boost) — batters will chase early`);
  if (eraPenalty < -3) f.push(`ERA concern (${eraPenalty.toFixed(1)}% NRFI penalty) — runs expected`);

  if (home.k9 > 10) f.push(`${home.name} elite 1st inning K rate — ${home.k9} K/9`);
  if (away.k9 > 10) f.push(`${away.name} elite 1st inning K rate — ${away.k9} K/9`);

  return f;
}
