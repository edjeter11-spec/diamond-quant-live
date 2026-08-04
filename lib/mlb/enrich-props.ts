// ──────────────────────────────────────────────────────────
// MLB PROP ENRICHMENT
//
// Attaches an INDEPENDENT probability to each MLB prop, so the board stops
// ranking the market against itself.
//
// Until now `fairProb` was de-vigged market consensus. Comparing that to the
// market's own price measures the vig by construction — every prop on
// 2026-07-30 priced negative (620 sides, best -0.3%). This replaces it with a
// projection built from the player's game log plus tonight's matchup.
//
// Validated walk-forward before wiring, on games the model never saw:
//   40 hitters / 4,295 predictions : Brier 0.2238 vs 0.2266 naive  (+1.24%)
//   20-hitter holdout / 2,115      : Brier 0.2217 vs 0.2232 naive  (+0.67%)
// Matchup context contributed ~+0.9% on its own in both halves. The earlier
// game-log-only projector tied the baseline (0.2217 vs 0.2213) and was
// deliberately left unwired; this is the version that earns its place.
//
// The bar was set in advance: beat the naive baseline on held-out data or
// don't ship. It does, by a real but modest margin — this is a small edge,
// not a license to print money.
// ──────────────────────────────────────────────────────────

import { projectProp, type GameLogRow } from "./prop-projector";
import {
  fetchSlateContext,
  fetchSplits,
  matchupMultiplier,
  type Hand,
  type PitcherContext,
  type SplitLine,
} from "./matchup";

const MLB_API = "https://statsapi.mlb.com/api/v1";

// Bounded so a cold cache can't blow the route's 30s budget.
const MAX_PLAYERS = 40;
const CONCURRENCY = 8;

interface PlayerBundle {
  id: number;
  bats: Hand | "S";
  logs: GameLogRow[];
  vsL?: SplitLine;
  vsR?: SplitLine;
  teamAbbrev: string;
}

const bundleCache = new Map<
  string,
  { at: number; data: PlayerBundle | null }
>();
const BUNDLE_TTL = 6 * 60 * 60 * 1000;

async function j(url: string, ms = 8000): Promise<any> {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`MLB ${r.status}`);
  return r.json();
}

function toLogRow(g: any): GameLogRow {
  const s = g.stat ?? {};
  return {
    date: g.date,
    atBats: Number(s.atBats ?? 0),
    hits: Number(s.hits ?? 0),
    totalBases: Number(s.totalBases ?? 0),
    homeRuns: Number(s.homeRuns ?? 0),
    rbi: Number(s.rbi ?? 0),
    runs: Number(s.runs ?? 0),
    strikeouts: Number(s.strikeOuts ?? 0),
    inningsPitched: Number(s.inningsPitched ?? 0),
    plateAppearances: Number(s.plateAppearances ?? 0),
  };
}

async function loadPlayer(
  name: string,
  isPitcherMarket: boolean,
  season: number,
): Promise<PlayerBundle | null> {
  const key = `${name}|${isPitcherMarket}`;
  const hit = bundleCache.get(key);
  if (hit && Date.now() - hit.at < BUNDLE_TTL) return hit.data;

  try {
    const s = await j(
      `${MLB_API}/people/search?names=${encodeURIComponent(name)}`,
    );
    const person = s?.people?.[0];
    if (!person?.id) {
      bundleCache.set(key, { at: Date.now(), data: null });
      return null;
    }

    const group = isPitcherMarket ? "pitching" : "hitting";
    const gl = await j(
      `${MLB_API}/people/${person.id}/stats?stats=gameLog&season=${season}&group=${group}`,
    );
    const logs = (gl?.stats?.[0]?.splits ?? []).map(toLogRow);

    const splits = isPitcherMarket
      ? {}
      : await fetchSplits(person.id, "hitting", season);

    const data: PlayerBundle = {
      id: person.id,
      bats:
        person?.batSide?.code === "L"
          ? "L"
          : person?.batSide?.code === "S"
            ? "S"
            : "R",
      logs,
      vsL: (splits as any).vsL,
      vsR: (splits as any).vsR,
      teamAbbrev: person?.currentTeam?.abbreviation ?? "",
    };
    bundleCache.set(key, { at: Date.now(), data });
    return data;
  } catch {
    // Do NOT cache a failure — a transient MLB API blip would otherwise
    // suppress this player's projection for six hours.
    return null;
  }
}

/** "Away Team @ Home Team" -> both club names. */
function resolveSides(team: unknown): string[] {
  if (typeof team !== "string" || !team.includes("@")) return [];
  return team
    .split("@")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * pitcherByTeam is keyed by the team a starter is pitching AGAINST, and it's
 * built from MLB abbreviations while props carry full club names. Match on
 * the name the slate reported for each side.
 */
function pickOpposing(
  sides: string[],
  byTeam: Map<string, PitcherContext>,
  nameToAbbrev?: Map<string, string>,
): PitcherContext | undefined {
  for (const side of sides) {
    const abbrev = nameToAbbrev?.get(side);
    if (abbrev) {
      const p = byTeam.get(abbrev);
      if (p) return p;
    }
  }
  return undefined;
}

/** Run `jobs` with bounded concurrency. */
async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        await fn(items[idx]);
      }
    }),
  );
}

/**
 * Mutates each prop in `grouped`, setting brainOverProb / brainUnderProb /
 * brainConfidence / brainProjectedValue when a projection is available.
 * Props we can't project are left untouched and fall back to market devig.
 */
export async function enrichMlbProps(
  grouped: any[],
  dateISO: string,
): Promise<{ projected: number; considered: number }> {
  if (!grouped.length) return { projected: 0, considered: 0 };

  const season = Number(dateISO.slice(0, 4));
  const targets = grouped.slice(0, MAX_PLAYERS);

  // Tonight's starters + posted lineup slots. One call for the whole slate.
  let slate: Awaited<ReturnType<typeof fetchSlateContext>>;
  try {
    slate = await fetchSlateContext(dateISO);
  } catch {
    slate = {
      pitcherByTeam: new Map(),
      opponentOf: new Map(),
      slotByPlayer: new Map(),
      abbrevByName: new Map(),
      parkByTeam: new Map(),
      isHomeByTeam: new Map(),
    };
  }

  let projected = 0;

  await pool(targets, CONCURRENCY, async (g: any) => {
    const isPitcherMarket =
      g.market === "pitcher_strikeouts" || g.market === "pitcher_outs";
    const bundle = await loadPlayer(g.playerName, isPitcherMarket, season);
    if (!bundle) return;

    g.playerId = g.playerId ?? bundle.id;

    // Which starter does this player face?
    //
    // /people/search does NOT return currentTeam, so bundle.teamAbbrev is
    // usually empty and looking the pitcher up by it silently missed every
    // time — projections ran, but with mult = 1, i.e. without the matchup
    // signal that is the entire reason this model beats the baseline.
    //
    // The prop itself carries "Away @ Home", and pitcherByTeam is keyed by
    // the team each starter is pitching AGAINST. So whichever of the two
    // sides has an entry naming a pitcher who isn't on this player's own
    // club is the right one; resolve by trying both and preferring the side
    // that produces a starter.
    const sides = resolveSides(g.team);
    const opposing: PitcherContext | undefined = isPitcherMarket
      ? undefined
      : (bundle.teamAbbrev && slate.pitcherByTeam.get(bundle.teamAbbrev)) ||
        pickOpposing(sides, slate.pitcherByTeam, slate.abbrevByName);

    let mult = 1;
    let slotMult = 1;
    let matchupReasons: string[] = [];

    if (isPitcherMarket) {
      // A starter's own K-rate context; matchupMultiplier handles the
      // market-specific inversion (high-K pitcher raises his own strikeouts).
      const self = slate.pitcherByTeam.get(
        slate.opponentOf.get(bundle.teamAbbrev) ?? "",
      );
      if (self) {
        const r = matchupMultiplier(
          { id: bundle.id, bats: "R", lineupSlot: null },
          self,
          { market: g.market },
        );
        mult = r.mult;
        matchupReasons = r.reasons;
      }
    } else if (opposing) {
      const r = matchupMultiplier(
        {
          id: bundle.id,
          bats: bundle.bats,
          vsLHP: bundle.vsL,
          vsRHP: bundle.vsR,
          lineupSlot: slate.slotByPlayer.get(bundle.id) ?? null,
        },
        opposing,
        { market: g.market },
      );
      mult = r.mult;
      slotMult = r.slotMult;
      matchupReasons = r.reasons;
    }

    // Which club is this player on, and therefore which park is he hitting in
    // tonight? bundle.teamAbbrev is usually empty (/people/search doesn't
    // return currentTeam), so fall back to matching the prop's "Away @ Home"
    // string against the slate. Whichever side has a starter indexed AGAINST
    // it is this player's own team — that's how pitcherByTeam is keyed.
    let ownAbbrev = bundle.teamAbbrev;
    if (!ownAbbrev) {
      for (const side of sides) {
        const ab = slate.abbrevByName.get(side);
        if (ab && slate.pitcherByTeam.has(ab)) {
          ownAbbrev = ab;
          break;
        }
      }
    }
    const parkAbbrev = ownAbbrev ? slate.parkByTeam.get(ownAbbrev) : undefined;
    const isHome = ownAbbrev ? slate.isHomeByTeam.get(ownAbbrev) : undefined;

    const proj = projectProp({
      market: g.market,
      // Park factor and home/away were already implemented in the projector
      // and simply never supplied — every prop was scored as if played in a
      // neutral park. Coors and Petco differ by ~25% on runs; that is not a
      // rounding error on a hits or total-bases line.
      parkAbbrev,
      isHome,
      line: g.line,
      logs: bundle.logs,
      rateMultiplier: mult * slotMult,
    });
    if (!proj) return;

    g.brainOverProb = Math.round(proj.overProb * 10) / 10;
    g.brainUnderProb = Math.round((100 - proj.overProb) * 10) / 10;
    g.brainSide = proj.overProb >= 50 ? "over" : "under";
    g.brainConfidence = proj.confidence;
    g.brainProjectedValue = proj.projectedValue;
    g.brainReasons = [...proj.reasons, ...matchupReasons];
    if (opposing) g.opposingPitcher = opposing.name;
    projected++;
  });

  return { projected, considered: targets.length };
}
