// ──────────────────────────────────────────────────────────
// MLB MATCHUP CONTEXT
//
// The information a game log does NOT contain.
//
// The first projector (lib/mlb/prop-projector.ts) tied a naive
// "how often has this player cleared this line" baseline — Brier 0.2217 vs
// 0.2213 over 5,255 held-out predictions. The diagnosis was structural, not a
// tuning problem: a player's own game log says nothing about who he faces
// tonight. Bogaerts' last 100 games look identical whether tomorrow's starter
// is an ace or a bullpen game, but the market prices that difference, so a
// model blind to it can only ever re-derive the player's base rate.
//
// This module supplies the missing half, all from the free MLB Stats API:
//   - tonight's probable starter and his handedness
//   - the batter's platoon split (vs LHP / vs RHP)
//   - the pitcher's own split (vs LHB / vs RHB)
//   - lineup slot when posted, which drives plate-appearance volume
//
// Every figure is regressed toward a league or player baseline by sample size.
// Platoon splits are notoriously noisy — a half-season of vs-LHP data is ~100
// PA — so taking them at face value would trade one bias for a louder one.
// ──────────────────────────────────────────────────────────

const MLB_API = "https://statsapi.mlb.com/api/v1";

export type Hand = "L" | "R";

export interface SplitLine {
  plateAppearances: number;
  atBats: number;
  hits: number;
  totalBases: number;
  strikeOuts: number;
  ops: number;
  avg: number;
}

export interface PitcherContext {
  id: number;
  name: string;
  throws: Hand;
  /** Season rate stats, used to grade opposition quality. */
  battersFaced: number;
  kPerBF: number;
  era: number;
  whip: number;
  /** Split lines keyed by batter handedness the pitcher faced. */
  vsLHB?: SplitLine;
  vsRHB?: SplitLine;
}

export interface BatterContext {
  id: number;
  bats: Hand | "S";
  vsLHP?: SplitLine;
  vsRHP?: SplitLine;
  /** 1-9 when the lineup is posted, else null. */
  lineupSlot: number | null;
}

/** League baselines used as regression targets. Stable year to year. */
export const LEAGUE = {
  kPerBF: 0.222,
  ops: 0.715,
  avg: 0.248,
  paPerGame: 4.1,
};

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : fallback;
}

function toSplit(stat: any): SplitLine {
  return {
    plateAppearances: num(stat?.plateAppearances),
    atBats: num(stat?.atBats),
    hits: num(stat?.hits),
    totalBases: num(stat?.totalBases),
    strikeOuts: num(stat?.strikeOuts),
    ops: num(stat?.ops),
    avg: num(stat?.avg),
  };
}

async function j(url: string): Promise<any> {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`MLB API ${r.status}`);
  return r.json();
}

/**
 * Platoon splits for a player. `group` is "hitting" or "pitching".
 * Returns [vsLeft, vsRight] — for a hitter that's vs LHP/vs RHP; for a
 * pitcher, vs LHB/vs RHB.
 */
export async function fetchSplits(
  playerId: number,
  group: "hitting" | "pitching",
  season: number,
): Promise<{ vsL?: SplitLine; vsR?: SplitLine }> {
  try {
    const d = await j(
      `${MLB_API}/people/${playerId}/stats?stats=statSplits&sitCodes=vl,vr&season=${season}&group=${group}`,
    );
    const out: { vsL?: SplitLine; vsR?: SplitLine } = {};
    for (const s of d.stats ?? []) {
      for (const sp of s.splits ?? []) {
        const code = sp.split?.code;
        if (code === "vl") out.vsL = toSplit(sp.stat);
        else if (code === "vr") out.vsR = toSplit(sp.stat);
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Tonight's probable starters, keyed by team abbreviation, plus posted
 * lineup slots when available.
 */
export async function fetchSlateContext(dateISO: string): Promise<{
  pitcherByTeam: Map<string, PitcherContext>;
  /** Opposing team abbrev for each team. */
  opponentOf: Map<string, string>;
  /** playerId -> batting order slot (1-9), only when the lineup is posted. */
  slotByPlayer: Map<number, number>;
  /** Full club name ("Philadelphia Phillies") -> abbreviation ("PHI"). */
  abbrevByName: Map<string, string>;
}> {
  const pitcherByTeam = new Map<string, PitcherContext>();
  const opponentOf = new Map<string, string>();
  const slotByPlayer = new Map<number, number>();
  const abbrevByName = new Map<string, string>();

  const season = Number(dateISO.slice(0, 4));
  let games: any[] = [];
  try {
    const d = await j(
      `${MLB_API}/schedule?sportId=1&date=${dateISO}&hydrate=probablePitcher,lineups,team`,
    );
    games = d.dates?.[0]?.games ?? [];
  } catch {
    return { pitcherByTeam, opponentOf, slotByPlayer, abbrevByName };
  }

  const jobs: Promise<void>[] = [];

  for (const g of games) {
    const home = g.teams?.home?.team?.abbreviation;
    const away = g.teams?.away?.team?.abbreviation;
    if (home && away) {
      opponentOf.set(home, away);
      opponentOf.set(away, home);
    }
    // Props carry full club names; the slate keys everything by abbreviation.
    const homeName = g.teams?.home?.team?.name;
    const awayName = g.teams?.away?.team?.name;
    if (homeName && home) abbrevByName.set(homeName, home);
    if (awayName && away) abbrevByName.set(awayName, away);

    // Lineup slots — present only once a team posts, usually a few hours out.
    for (const [side, key] of [
      ["home", "homePlayers"],
      ["away", "awayPlayers"],
    ] as const) {
      const players = g.lineups?.[key] ?? [];
      players.forEach((p: any, i: number) => {
        if (p?.id) slotByPlayer.set(p.id, i + 1);
      });
      void side;
    }

    // A hitter is graded against the OPPOSING starter, so index each
    // pitcher under the team he pitches against.
    for (const [side, oppAbbrev] of [
      ["home", away],
      ["away", home],
    ] as const) {
      const pp = g.teams?.[side]?.probablePitcher;
      if (!pp?.id || !oppAbbrev) continue;
      jobs.push(
        (async () => {
          try {
            const d = await j(
              `${MLB_API}/people/${pp.id}?hydrate=stats(group=pitching,type=season,season=${season})`,
            );
            const person = d.people?.[0];
            const st = person?.stats?.[0]?.splits?.[0]?.stat ?? {};
            const bf = num(st.battersFaced);
            const splits = await fetchSplits(pp.id, "pitching", season);
            pitcherByTeam.set(oppAbbrev, {
              id: pp.id,
              name: person?.fullName ?? pp.fullName ?? "",
              throws: (person?.pitchHand?.code === "L" ? "L" : "R") as Hand,
              battersFaced: bf,
              kPerBF: bf > 0 ? num(st.strikeOuts) / bf : LEAGUE.kPerBF,
              era: num(st.era, 4.2),
              whip: num(st.whip, 1.3),
              vsLHB: splits.vsL,
              vsRHB: splits.vsR,
            });
          } catch {
            /* leave unset — caller treats a missing pitcher as neutral */
          }
        })(),
      );
    }
  }

  await Promise.all(jobs);
  return { pitcherByTeam, opponentOf, slotByPlayer, abbrevByName };
}

/**
 * Shrink a split-derived rate toward a baseline by sample size.
 * `k` is the PA/BF count at which the observed rate carries half the weight.
 */
export function regress(
  observed: number,
  baseline: number,
  sample: number,
  k: number,
): number {
  if (!Number.isFinite(observed) || sample <= 0) return baseline;
  const w = sample / (sample + k);
  return w * observed + (1 - w) * baseline;
}

/**
 * Multiplier on a batter's base rate for tonight's pitcher.
 * 1.0 = neutral. Combines three independently-regressed signals:
 *   - platoon: how this batter hits pitchers of this hand vs his overall
 *   - pitcher quality: how this pitcher suppresses hitters of this hand
 *   - lineup slot: PA volume relative to a typical starter
 *
 * Clamped hard. Even a genuine extreme matchup rarely moves a per-game rate
 * more than ~15%, and an unclamped product of three noisy ratios can swing
 * far past anything real.
 */
export function matchupMultiplier(
  batter: BatterContext,
  pitcher: PitcherContext | undefined,
  opts: { market: string } = { market: "batter_hits" },
): { mult: number; reasons: string[]; slotMult: number } {
  const reasons: string[] = [];
  if (!pitcher) return { mult: 1, reasons, slotMult: 1 };

  const facingLeft = pitcher.throws === "L";

  // ── 1. Batter platoon ──
  // Switch hitters bat opposite the pitcher, so they always hold the platoon
  // advantage — their split gap is real but much smaller.
  const bSplit = facingLeft ? batter.vsLHP : batter.vsRHP;
  const bOther = facingLeft ? batter.vsRHP : batter.vsLHP;
  let platoonMult = 1;
  if (bSplit && bOther) {
    const totalPA = bSplit.plateAppearances + bOther.plateAppearances;
    const overallOps =
      totalPA > 0
        ? (bSplit.ops * bSplit.plateAppearances +
            bOther.ops * bOther.plateAppearances) /
          totalPA
        : LEAGUE.ops;
    // Regress the split OPS toward the batter's own overall mark — k=200 PA
    // because half-season platoon samples are ~100 PA and famously noisy.
    const splitOps = regress(
      bSplit.ops,
      overallOps,
      bSplit.plateAppearances,
      200,
    );
    if (overallOps > 0) platoonMult = splitOps / overallOps;
    if (platoonMult >= 1.05)
      reasons.push(`favorable platoon vs ${pitcher.throws}HP`);
    else if (platoonMult <= 0.95)
      reasons.push(`tough platoon vs ${pitcher.throws}HP`);
  }

  // ── 2. Pitcher quality against this batter's hand ──
  const batsLeft = batter.bats === "L" || batter.bats === "S";
  const pSplit = batsLeft ? pitcher.vsLHB : pitcher.vsRHB;
  let pitcherMult = 1;
  if (pSplit && pSplit.plateAppearances > 0) {
    const oppOps = regress(
      pSplit.ops,
      LEAGUE.ops,
      pSplit.plateAppearances,
      250,
    );
    pitcherMult = oppOps / LEAGUE.ops;
  } else if (pitcher.battersFaced > 0) {
    // No split available — fall back to overall WHIP as a coarse proxy.
    pitcherMult = regress(pitcher.whip / 1.3, 1, pitcher.battersFaced, 300);
  }
  if (pitcherMult <= 0.94) reasons.push(`tough matchup vs ${pitcher.name}`);
  else if (pitcherMult >= 1.06)
    reasons.push(`hittable matchup vs ${pitcher.name}`);

  // Strikeout props invert: a high-K pitcher SUPPRESSES hits but RAISES his
  // own strikeout count, so the sign of the adjustment depends on the market.
  if (opts.market === "pitcher_strikeouts") {
    const kMult = regress(
      pitcher.kPerBF / LEAGUE.kPerBF,
      1,
      pitcher.battersFaced,
      300,
    );
    const clamped = Math.min(1.2, Math.max(0.85, kMult));
    if (clamped >= 1.08) reasons.push("high strikeout rate");
    else if (clamped <= 0.93) reasons.push("low strikeout rate");
    return { mult: clamped, reasons, slotMult: 1 };
  }

  // ── 3. Lineup slot → PA volume ──
  // Leadoff gets ~4.6 PA, ninth ~3.6. That's a ~12% swing in chances, which
  // matters more for over-0.5 props than any platoon edge.
  const SLOT_PA: Record<number, number> = {
    1: 4.65,
    2: 4.55,
    3: 4.45,
    4: 4.35,
    5: 4.25,
    6: 4.1,
    7: 4.0,
    8: 3.85,
    9: 3.7,
  };
  let slotMult = 1;
  if (batter.lineupSlot && SLOT_PA[batter.lineupSlot]) {
    slotMult = SLOT_PA[batter.lineupSlot] / LEAGUE.paPerGame;
    if (batter.lineupSlot <= 2)
      reasons.push(`bats ${batter.lineupSlot} (more PA)`);
    else if (batter.lineupSlot >= 8)
      reasons.push(`bats ${batter.lineupSlot} (fewer PA)`);
  }

  const raw = platoonMult * pitcherMult;
  const mult = Math.min(1.18, Math.max(0.85, raw));
  return { mult, reasons, slotMult };
}
