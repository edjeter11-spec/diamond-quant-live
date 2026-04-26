import { NextResponse } from "next/server";
import { fetchOdds, parseOddsLines, findBestLine } from "@/lib/odds/the-odds-api";
import { getApiKey } from "@/lib/odds/api-keys";
import { getCached, setCache } from "@/lib/odds/server-cache";
import { devig } from "@/lib/model/kelly";
import { runNetRatingModel, runFormModel, buildNBAConsensus } from "@/lib/bot/nba-engine";
import { getNBATeamAbbrev } from "@/lib/nba/stats-api";
import { getRestState, computeRestEdge } from "@/lib/nba/rest-fatigue";
import { getTeamInjuries } from "@/lib/nba/injuries";
import { projectGameTotal, getTeamRating } from "@/lib/nba/pace-ratings";
import { getNBALineup, computeNBALineupEdge } from "@/lib/nba/daily-lineup";

export const dynamic = "force-dynamic";

export async function GET() {
  const cached = getCached("nba_analysis", 600_000);
  if (cached) return NextResponse.json(cached);

  const apiKey = getApiKey();
  if (!apiKey) return NextResponse.json({ analyses: [], error: "No API key" });

  try {
    const rawGames = await fetchOdds(apiKey, "basketball_nba");
    const now = Date.now();

    // Filter to upcoming games only
    const futureGames = rawGames.filter(g => new Date(g.commence_time).getTime() > now - 30 * 60 * 1000);

    const analyses = await Promise.all(futureGames.slice(0, 12).map(async (game) => {
      const oddsLines = parseOddsLines(game);
      const homeTeam = game.home_team;
      const awayTeam = game.away_team;

      // Rest/B2B fatigue lookup (parallel — each cached for 2h)
      const homeAbbrev = getNBATeamAbbrev(homeTeam);
      const awayAbbrev = getNBATeamAbbrev(awayTeam);
      const [homeRest, awayRest, homeInjuries, awayInjuries, homeLineup, awayLineup] = await Promise.all([
        getRestState(homeAbbrev).catch(() => null),
        getRestState(awayAbbrev).catch(() => null),
        getTeamInjuries(homeAbbrev).catch(() => []),
        getTeamInjuries(awayAbbrev).catch(() => []),
        getNBALineup(game.id, homeAbbrev).catch(() => null),
        getNBALineup(game.id, awayAbbrev).catch(() => null),
      ]);
      const restEdge = homeRest && awayRest ? computeRestEdge(homeRest, awayRest) : { edge: 0, factors: [] };

      // ── Confirmed-lineup edge ────────────────────────────────────────
      // Surfaces the case where a 20+ ppg star is unexpectedly OUT/DNP
      // and books haven't moved. Edge is in projected points (home POV).
      let lineupEdge = 0;
      const lineupFactors: string[] = [];
      if (homeLineup && (homeLineup.confirmed || homeLineup.inactiveStars.length > 0)) {
        lineupEdge += computeNBALineupEdge(homeLineup);
        if (homeLineup.inactiveStars.length > 0) lineupFactors.push(homeLineup.summary);
      }
      if (awayLineup && (awayLineup.confirmed || awayLineup.inactiveStars.length > 0)) {
        // Inactives on AWAY help HOME — flip sign
        lineupEdge -= computeNBALineupEdge(awayLineup);
        if (awayLineup.inactiveStars.length > 0) lineupFactors.push(awayLineup.summary);
      }
      lineupEdge = Math.max(-12, Math.min(12, lineupEdge));

      // Star-out impact: each OUT player = -1.5 pts for their team;
      // DOUBTFUL = -1.0; QUESTIONABLE = -0.4 (partial impact factor)
      let injuryEdge = 0;
      const injuryFactors: string[] = [];
      for (const inj of (homeInjuries ?? [])) {
        if (inj.status === "Out") { injuryEdge -= 1.5; injuryFactors.push(`${homeAbbrev} OUT: ${inj.name}`); }
        else if (inj.status === "Doubtful") { injuryEdge -= 1.0; injuryFactors.push(`${homeAbbrev} DOUBTFUL: ${inj.name}`); }
        else if (inj.status === "Questionable") { injuryEdge -= 0.4; }
      }
      for (const inj of (awayInjuries ?? [])) {
        if (inj.status === "Out") { injuryEdge += 1.5; injuryFactors.push(`${awayAbbrev} OUT: ${inj.name}`); }
        else if (inj.status === "Doubtful") { injuryEdge += 1.0; injuryFactors.push(`${awayAbbrev} DOUBTFUL: ${inj.name}`); }
        else if (inj.status === "Questionable") { injuryEdge += 0.4; }
      }
      // Cap total injury swing so 8 benchwarmers out doesn't blow up the model
      injuryEdge = Math.max(-5, Math.min(5, injuryEdge));

      // Run 3 NBA models
      const netRatingModel = runNetRatingModel(homeTeam, awayTeam, oddsLines);

      // Market model from odds
      const homeProbs: number[] = [];
      for (const line of oddsLines) {
        if (line.homeML !== 0 && line.awayML !== 0) {
          const { prob1 } = devig(line.homeML, line.awayML);
          homeProbs.push(prob1);
        }
      }
      const marketProb = homeProbs.length > 0 ? homeProbs.reduce((a, b) => a + b, 0) / homeProbs.length : 0.5;
      const marketModel = {
        homeWinProb: marketProb,
        spreadProjection: 0,
        totalProjection: oddsLines[0]?.total || 224,
        confidence: Math.min(75, homeProbs.length * 20),
        factors: [`Market consensus from ${homeProbs.length} books: ${(marketProb * 100).toFixed(1)}% home`],
      };

      const formModel = runFormModel(homeTeam, awayTeam);

      // Inject rest edge into the form model (it's the closest home for schedule-based signal)
      if (restEdge.edge !== 0) {
        const probShift = restEdge.edge * 0.035; // ~3.5% win-prob per point of rest edge
        formModel.homeWinProb = Math.min(0.95, Math.max(0.05, formModel.homeWinProb + probShift));
        formModel.factors.push(...restEdge.factors);
        formModel.confidence = Math.min(80, formModel.confidence + 15);
      }

      // Inject injury edge into the netRating model (star absences hit team quality directly)
      if (injuryEdge !== 0) {
        const probShift = injuryEdge * 0.035;
        netRatingModel.homeWinProb = Math.min(0.95, Math.max(0.05, netRatingModel.homeWinProb + probShift));
        netRatingModel.factors.push(...injuryFactors.slice(0, 4));
        netRatingModel.confidence = Math.min(80, netRatingModel.confidence + Math.abs(injuryEdge) * 3);
      }

      // Confirmed-lineup edge: bigger nudge than season-IL because books haven't fully moved
      // Scale: ~3% home win-prob shift per net point; bumps confidence when a confirmed lineup
      // exposes a star DNP that the market is sleeping on.
      if (lineupEdge !== 0) {
        const probShift = lineupEdge * 0.03;
        netRatingModel.homeWinProb = Math.min(0.95, Math.max(0.05, netRatingModel.homeWinProb + probShift));
        netRatingModel.factors.push(...lineupFactors.slice(0, 2));
        netRatingModel.confidence = Math.min(85, netRatingModel.confidence + Math.abs(lineupEdge) * 2);
        // Also tilt the projected total — fewer stars means fewer points
        const totalDrop = Math.abs(lineupEdge) * 0.5;
        netRatingModel.totalProjection = Math.max(180, netRatingModel.totalProjection - totalDrop);
      }

      // Pace × ratings → projected total (replaces the old hard-coded 224 baseline)
      const paceProj = projectGameTotal(homeAbbrev, awayAbbrev);
      netRatingModel.totalProjection = paceProj.projectedTotal;
      formModel.totalProjection = paceProj.projectedTotal;
      // Tilt market model's total slightly toward the pace-based projection
      marketModel.totalProjection = (marketModel.totalProjection + paceProj.projectedTotal) / 2;
      if (paceProj.factors.length > 0) {
        netRatingModel.factors.push(...paceProj.factors.slice(0, 2));
      }
      // Apply net-rating gap as a win-probability nudge (sharper than the stubbed 0.58)
      const homeR = getTeamRating(homeAbbrev);
      const awayR = getTeamRating(awayAbbrev);
      const netGap = homeR.netRating - awayR.netRating;
      if (Math.abs(netGap) >= 1) {
        const ratingShift = Math.max(-0.25, Math.min(0.25, netGap * 0.018));
        netRatingModel.homeWinProb = Math.min(0.92, Math.max(0.08, netRatingModel.homeWinProb + ratingShift));
        netRatingModel.factors.push(`Net rating: ${homeAbbrev} ${homeR.netRating > 0 ? "+" : ""}${homeR.netRating} vs ${awayAbbrev} ${awayR.netRating > 0 ? "+" : ""}${awayR.netRating}`);
      }

      // Consensus
      const consensus = buildNBAConsensus(netRatingModel, marketModel, formModel);

      // Best odds
      const bestHomeML = findBestLine(oddsLines, "home", "ml");
      const bestAwayML = findBestLine(oddsLines, "away", "ml");
      const bestOver = findBestLine(oddsLines, "home", "total_over");

      // Generate picks
      const picks: any[] = [];
      if (consensus.confidence !== "NO_PLAY" && bestHomeML.odds !== -Infinity) {
        const isHome = consensus.homeWinProb > 0.5;
        const pickTeam = isHome ? homeTeam : awayTeam;
        const pickOdds = isHome ? bestHomeML.odds : bestAwayML.odds;
        const pickBook = isHome ? bestHomeML.bookmaker : bestAwayML.bookmaker;

        picks.push({
          pick: `${pickTeam} ML`,
          market: "moneyline",
          odds: pickOdds,
          bookmaker: pickBook,
          fairProb: Math.round((isHome ? consensus.homeWinProb : 1 - consensus.homeWinProb) * 1000) / 10,
          confidence: consensus.confidence,
          reasoning: [
            ...netRatingModel.factors.slice(0, 2),
            ...marketModel.factors.slice(0, 1),
            ...formModel.factors.slice(0, 1),
          ],
        });
      }

      // Spread pick
      if (oddsLines[0]?.homeSpread) {
        picks.push({
          pick: `${consensus.spreadProjection < 0 ? homeTeam : awayTeam} ${consensus.spreadProjection < 0 ? consensus.spreadProjection.toFixed(1) : "+" + (-consensus.spreadProjection).toFixed(1)}`,
          market: "spread",
          odds: oddsLines[0]?.spreadPrice ?? -110,
          bookmaker: oddsLines[0]?.bookmaker ?? "",
          fairProb: 50,
          confidence: "LOW",
          reasoning: ["Spread based on model consensus projection"],
        });
      }

      return {
        gameId: game.id,
        homeTeam,
        awayTeam,
        homeAbbrev: getNBATeamAbbrev(homeTeam),
        awayAbbrev: getNBATeamAbbrev(awayTeam),
        commenceTime: game.commence_time,
        pitcherModel: netRatingModel, // reusing the field name for component compatibility
        marketModel,
        trendModel: formModel,
        consensus: {
          homeWinProb: consensus.homeWinProb,
          confidence: consensus.confidence,
          modelsAgree: consensus.modelsAgree,
          disagreementLevel: 0,
        },
        picks,
        bestHomeML: bestHomeML.odds,
        bestAwayML: bestAwayML.odds,
        bestHomeBook: bestHomeML.bookmaker,
        bestAwayBook: bestAwayML.bookmaker,
        homePitcher: null, // N/A for NBA
        awayPitcher: null,
      };
    }));

    const response = {
      analyses,
      timestamp: new Date().toISOString(),
      gamesAnalyzed: analyses.length,
      highConfidence: analyses.filter(a => a.consensus.confidence === "HIGH").length,
      disagreements: analyses.filter(a => !a.consensus.modelsAgree).length,
    };

    setCache("nba_analysis", response);
    return NextResponse.json(response);
  } catch (error: any) {
    console.error("NBA analysis error:", error);
    return NextResponse.json({ analyses: [], error: error.message });
  }
}
