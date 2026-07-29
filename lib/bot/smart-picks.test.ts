import { describe, it, expect } from "vitest";
import { generateSmartPicks } from "./smart-picks";
import type { GameAnalysis, ModelPrediction } from "./three-models";

function model(homeWinProb: number): ModelPrediction {
  return {
    homeWinProb,
    totalProjection: 8.5,
    confidence: 60,
    factors: ["stub"],
  };
}

function makeGame(overrides: Partial<GameAnalysis> = {}): GameAnalysis {
  const base: GameAnalysis = {
    gameId: "game-1",
    homeTeam: "Home Team",
    awayTeam: "Away Team",
    commenceTime: "2026-07-29T23:00:00Z",
    bestHomeML: -150,
    bestAwayML: 130,
    bestOver: -110,
    bestUnder: -110,
    bestTotal: 8.5,
    bestHomeBook: "BookA",
    bestAwayBook: "BookA",
    pitcherModel: model(0.55),
    marketModel: model(0.55),
    trendModel: model(0.55),
    consensus: {
      homeWinProb: 0.55,
      confidence: "HIGH",
      modelsAgree: true,
      disagreementLevel: 0.1,
    },
    picks: [],
    homePitcher: null,
    awayPitcher: null,
  };
  return { ...base, ...overrides };
}

const BANKROLL = 5000;

// Guards against the "ranked purely on model confidence, ignored price" bug:
// a heavy favorite at bad odds (negative EV) must never produce a pick, even
// at HIGH model confidence.
describe("generateSmartPicks — EV gating", () => {
  it("does not produce a pick for negative-EV HIGH-confidence favorite", () => {
    // Home team is a big favorite (-400) with only a slightly-above-implied
    // fair prob -> negative EV.
    const game = makeGame({
      bestHomeML: -400,
      bestAwayML: 320,
      consensus: {
        homeWinProb: 0.78, // implied prob at -400 is ~80%, so this is negative EV
        confidence: "HIGH",
        modelsAgree: true,
        disagreementLevel: 0.05,
      },
    });
    const picks = generateSmartPicks([game], BANKROLL);
    // No real pick; since only 1 analysis and it fails the bar, the
    // "closest call" forced-pick fallback kicks in but is flagged as such.
    const realPicks = picks.filter((p) => !p.isForcedPick);
    expect(realPicks.length).toBe(0);
  });

  it("produces a pick with correct EV math for a positive-EV game", () => {
    const game = makeGame({
      bestHomeML: 150, // decimal 2.5, implied 40%
      bestAwayML: -170,
      consensus: {
        homeWinProb: 0.55, // fair 55% vs implied 40% -> big positive EV
        confidence: "HIGH",
        modelsAgree: true,
        disagreementLevel: 0.05,
      },
    });
    const picks = generateSmartPicks([game], BANKROLL);
    expect(picks.length).toBe(1);
    const pick = picks[0];
    expect(pick.isForcedPick).toBeFalsy();
    expect(pick.pick).toBe("Home Team ML");
    // EV% = (fairProb * decimalOdds - 1) * 100 = (0.55*2.5 - 1)*100 = 37.5
    expect(pick.evPercentage).toBeCloseTo(37.5, 1);
  });

  it("returns exactly one isForcedPick when no game clears the bar", () => {
    const game1 = makeGame({
      gameId: "g1",
      homeTeam: "Team A",
      awayTeam: "Team B",
      bestHomeML: -400,
      bestAwayML: 320,
      consensus: {
        homeWinProb: 0.78,
        confidence: "HIGH",
        modelsAgree: true,
        disagreementLevel: 0.05,
      },
    });
    const game2 = makeGame({
      gameId: "g2",
      homeTeam: "Team C",
      awayTeam: "Team D",
      bestHomeML: -300,
      bestAwayML: 250,
      consensus: {
        homeWinProb: 0.74,
        confidence: "HIGH",
        modelsAgree: true,
        disagreementLevel: 0.05,
      },
    });
    const picks = generateSmartPicks([game1, game2], BANKROLL);
    const forced = picks.filter((p) => p.isForcedPick === true);
    expect(forced.length).toBe(1);
    expect(picks.length).toBe(1);
    expect(forced[0].confidence).toBe("NO_PLAY");
  });

  it("is pure/deterministic — same input yields the same single pick, no accumulation", () => {
    // Guards against the "duplicate Reds ML" bug class at the unit level:
    // repeated calls with identical input must not accumulate picks or
    // produce different results.
    const game = makeGame({
      bestHomeML: 150,
      bestAwayML: -170,
      consensus: {
        homeWinProb: 0.55,
        confidence: "HIGH",
        modelsAgree: true,
        disagreementLevel: 0.05,
      },
    });
    const picksRun1 = generateSmartPicks([game], BANKROLL);
    const picksRun2 = generateSmartPicks([game], BANKROLL);
    expect(picksRun1.length).toBe(1);
    expect(picksRun2.length).toBe(1);
    expect(picksRun1[0].pick).toBe(picksRun2[0].pick);
    expect(picksRun1[0].odds).toBe(picksRun2[0].odds);
    expect(picksRun1[0].evPercentage).toBe(picksRun2[0].evPercentage);
    expect(picksRun1[0].stake).toBe(picksRun2[0].stake);
  });
});
