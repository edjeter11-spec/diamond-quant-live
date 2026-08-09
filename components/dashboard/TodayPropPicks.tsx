"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Users,
  ArrowUpRight,
  ArrowDownRight,
  Flame,
  ChevronRight,
  ChevronDown,
  Brain,
  Clock,
  Plus,
  Check,
  AlertTriangle,
  Zap,
} from "lucide-react";
import { americanToDecimal } from "@/lib/model/kelly";
import { useStore } from "@/lib/store";
import { usePremium } from "@/lib/hooks/usePremium";
import { fetchWithAuth } from "@/lib/supabase/fetch-with-auth";
import InfoTip from "@/components/ui/InfoTip";
import PlayerAvatar from "@/components/ui/PlayerAvatar";
import PropDetail from "@/components/dashboard/PropDetail";

interface RawProp {
  playerName: string;
  playerId?: number | string;
  team?: string;
  line: number;
  market: string;
  gameTime?: string;
  bestOver?: { price: number; bookmaker: string };
  bestUnder?: { price: number; bookmaker: string };
  fairOverProb: number; // 0-100 — market devig
  fairUnderProb: number; // 0-100 — market devig
  // Brain projection — only set for NBA when the brain has opinion
  brainOverProb?: number; // 0-100 from projectProp
  brainUnderProb?: number; // 0-100
  brainSide?: "over" | "under";
  brainConfidence?: number; // 0-100
  brainProjectedValue?: number;
  injuryStatus?:
    "Out" | "Doubtful" | "Questionable" | "Probable" | "Day-To-Day";
  // Best-EV alternate line from /api/players (null when main is optimal)
  bestAlt?: {
    line: number;
    side: "over" | "under";
    price: number;
    bookmaker: string;
    fairProb: number;
    edgePct: number;
  } | null;
  isSynthesized?: boolean;
}

interface PropPick {
  key: string;
  playerName: string;
  playerId?: number | string;
  team?: string;
  side: "over" | "under";
  line: number;
  market: string;
  odds: number;
  bookmaker: string;
  fairProb: number; // 0-100 — used for ranking (brain or market)
  evPercentage: number; // edge over implied (always vs market devig)
  score: number;
  label: string; // "Points", "Hits", etc.
  usesBrain?: boolean; // true when probability came from the brain, not devig
  projectedValue?: number; // brain's projected stat (NBA only)
  bestAlt?: RawProp["bestAlt"];
  isSynthesized?: boolean;
  gameTime?: string;
  /** Server-graded outcome joined in by /api/pinned-props from manual_picks.
   *  Authoritative once present — this is what posted to Discord and what the
   *  published record counts. Absent = not settled yet. */
  result?: "win" | "loss" | "push" | "void";
  profitUnits?: number | null;
}

const MARKET_LABEL: Record<string, string> = {
  player_points: "Points",
  player_rebounds: "Rebounds",
  player_assists: "Assists",
  pitcher_strikeouts: "Strikeouts",
  batter_hits: "Hits",
  batter_home_runs: "Home Runs",
  batter_total_bases: "Total Bases",
};

// Over-bias: users prefer Overs, so when probabilities are within 1.5%,
// we nudge the Over. Also add +1 to the ranking score to prioritize displayed Overs.
const OVER_BIAS_TIE_BREAK = 1.5;
const OVER_DISPLAY_BOOST = 1.0;

// Markets where "under" is a dead bet (e.g. home runs — line is 0.5,
// under = "won't hit a homer" which has no real analytical edge).
// We force Over side and never render an Under suggestion.
const OVER_ONLY_MARKETS = new Set(["batter_home_runs"]);

/** 15 -> "3pm", 10 -> "10am". Returns null for a missing/invalid hour so the
 *  caller can fall back to wording that doesn't quote a time. */
function formatHourET(h: number | undefined): string | null {
  if (typeof h !== "number" || !Number.isFinite(h)) return null;
  const hour = ((Math.trunc(h) % 24) + 24) % 24;
  const suffix = hour < 12 ? "am" : "pm";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}${suffix}`;
}

function americanImplied(odds: number): number {
  if (!odds) return 0.5;
  return odds > 0
    ? 100 / (odds + 100)
    : Math.abs(odds) / (Math.abs(odds) + 100);
}

function scoreProp(side: "over" | "under", prop: RawProp): PropPick | null {
  const best = side === "over" ? prop.bestOver : prop.bestUnder;
  if (!best?.price) return null;

  // Prefer brain probability when present (NBA only); fall back to market devig.
  const brainFair = side === "over" ? prop.brainOverProb : prop.brainUnderProb;
  const marketFair = side === "over" ? prop.fairOverProb : prop.fairUnderProb;
  const usesBrain = typeof brainFair === "number" && brainFair > 0;
  // Always have *some* probability signal — fall back to the implied book
  // probability if both brain and devig are missing, so the row still ranks.
  const impliedFallback = americanImplied(best.price) * 100;
  const fair = usesBrain
    ? brainFair!
    : marketFair && marketFair > 0
      ? marketFair
      : impliedFallback;

  // True EV = p * decimalPayout - 1, matching /api/pinned-props. The old
  // `fair - implied` was a probability-space gap that ignored payout, and the
  // old score let probability outweigh price ~8.5:1 — so this fallback ranked
  // by likelihood, not value, and could disagree with the pinned board it's
  // standing in for.
  const decPayout =
    best.price > 0 ? 1 + best.price / 100 : 1 + 100 / Math.abs(best.price);
  const ev = ((fair / 100) * decPayout - 1) * 100;

  const boost = side === "over" ? OVER_DISPLAY_BOOST : 0;
  // Slight score bonus when brain is behind the pick — brain picks go higher
  const brainBonus = usesBrain ? 0.5 : 0;
  const score = ev + (fair - 50) * 0.05 + boost + brainBonus;

  return {
    key: `${prop.market}-${prop.playerName}-${side}`,
    playerName: prop.playerName,
    playerId: prop.playerId,
    team: prop.team,
    side,
    line: prop.line,
    market: prop.market,
    odds: best.price,
    bookmaker: best.bookmaker,
    fairProb: Math.round(fair * 10) / 10,
    evPercentage: Math.round(ev * 10) / 10,
    score,
    label: MARKET_LABEL[prop.market] ?? prop.market,
    usesBrain,
    projectedValue: prop.brainProjectedValue,
    gameTime: prop.gameTime,
    bestAlt: prop.bestAlt ?? null,
  };
}

interface BrainPickFallback {
  playerName: string;
  team: string;
  propType: string;
  market: string;
  line: number;
  side: "over" | "under";
  probability: number;
  projectedValue: number;
  odds: number;
  bookmaker: string;
  gameTime: string;
  brainConfidence: number;
  tier?: "HIGH" | "MEDIUM" | "LEAN";
  seasonAvg?: number;
  last5Avg?: number;
}

export default function TodayPropPicks({
  sport,
  propsData,
  loading,
}: {
  sport: "mlb" | "nba";
  propsData: Record<string, RawProp[]>;
  loading: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const [openPick, setOpenPick] = useState<string | null>(null);
  const { addParlayLeg, parlayLegs } = useStore();
  const { isPremium } = usePremium();
  const [justAdded, setJustAdded] = useState<Record<string, boolean>>({});

  // Brain fallback: when live odds are empty for NBA, fetch the brain's
  // projected prop picks so the board never goes dark.
  const [brainPicks, setBrainPicks] = useState<BrainPickFallback[]>([]);
  useEffect(() => {
    if (sport !== "nba") {
      setBrainPicks([]);
      return;
    }
    const hasLive = Object.values(propsData).some(
      (arr) => (arr?.length ?? 0) > 0,
    );
    if (hasLive) return;
    let cancelled = false;
    fetch("/api/prop-picks-today")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && Array.isArray(d?.picks)) setBrainPicks(d.picks);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sport, propsData]);

  // Track when prop data was last refreshed — updates whenever a new
  // non-empty propsData payload arrives. Re-renders every 30s so the
  // "Updated Xm ago" label stays current without re-fetching.
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  useEffect(() => {
    const hasData = Object.values(propsData).some(
      (arr) => (arr?.length ?? 0) > 0,
    );
    if (hasData) setLastUpdated(Date.now());
  }, [propsData]);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const relativeTime = (ts: number | null): string => {
    if (!ts || !mounted) return "";
    // tick is read here so changes trigger recompute via the 30s interval
    void tick;
    const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (sec < 60) return "just now";
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    return `${hr}h ago`;
  };

  // Tip-off label — computed client-side only to avoid SSR/client locale mismatch.
  const [tipoffLabel, setTipoffLabel] = useState<string>("");
  useEffect(() => {
    const times = Object.values(propsData)
      .flat()
      .map((p: any) => p.gameTime)
      .filter(Boolean)
      .sort() as string[];
    if (!times[0]) {
      setTipoffLabel("");
      return;
    }
    setTipoffLabel(
      new Date(times[0]).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      }),
    );
  }, [propsData]);

  // Live grading: fetch box-score actuals and paint picks green/red when
  // their games are live or final. Refreshes every 60s in-game.
  const [resultsMap, setResultsMap] = useState<
    Record<
      string,
      Array<{ market: string; actual: number; gameStatus: string }>
    >
  >({});
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      const sportParam = sport === "nba" ? "basketball_nba" : "baseball_mlb";
      fetch(`/api/prop-results?sport=${sportParam}`)
        .then((r) => r.json())
        .then((d) => {
          if (!cancelled && d?.results) setResultsMap(d.results);
        })
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sport]);

  // ── Pinned board ──
  // The authoritative list comes from /api/pinned-props, which ranks once and
  // stores the result so every user sees the same picks. Ranking in the
  // browser (below, now a fallback) meant two people loading seconds apart
  // could get different boards, and a pick could disappear as lines moved.
  const [pinned, setPinned] = useState<PropPick[] | null>(null);
  const [pinnedFailed, setPinnedFailed] = useState(false);
  const [serverLocked, setServerLocked] = useState(0);
  // The board deliberately doesn't exist yet today — the server holds off
  // pinning until ~3h before the first game so picks are made on confirmed
  // lineups. That is NOT a failure, and must not be reported as one.
  const [notYet, setNotYet] = useState<{ buildsAtHourET?: number } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;

    // Drop the previous sport's board immediately on switch. Without this,
    // `pinned` held the OLD sport's picks while the new fetch was in flight —
    // and for a sport with no slate (NBA in August) the fetch returns an
    // empty board, so nothing ever replaced them: the NBA tab rendered MLB
    // moneylines and strikeout props indefinitely. Resetting the failure and
    // waiting flags too, so a stale banner can't carry over either.
    setPinned(null);
    setPinnedFailed(false);
    setNotYet(null);
    setServerLocked(0);

    // Retry before giving up. A single failed fetch used to drop straight to
    // the local ranking, which silently showed DIFFERENT picks on that device
    // — the phone-vs-desktop mismatch. One flaky request on mobile shouldn't
    // change what the board says.
    const load = async (attempt = 0): Promise<void> => {
      try {
        // Authed so the server can resolve premium status. Without the token
        // every request looks anonymous and the board comes back truncated.
        const r = await fetchWithAuth(`/api/pinned-props?sport=${sport}`, {
          cache: "no-store", // never let a stale SW copy win
          signal: AbortSignal.timeout(10000),
        });
        const d = await r.json();
        if (cancelled) return;
        // Pre-lineup window: an intentional empty board, not a failed fetch.
        // Retrying can't help (the server will keep returning this until the
        // build hour), and falling back to a locally-ranked board would show
        // exactly the lineup-blind picks the server is deliberately avoiding.
        if (d?.ok && d.notYet) {
          setNotYet({ buildsAtHourET: d.buildsAtHourET });
          setPinned([]);
          setPinnedFailed(false);
          return;
        }
        if (d?.ok && Array.isArray(d.picks) && d.picks.length) {
          setNotYet(null);
          setPinned(d.picks as PropPick[]);
          // How many the server withheld for this viewer. Authoritative —
          // the client can't compute it, because it never sees them.
          setServerLocked(typeof d.locked === "number" ? d.locked : 0);
          setPinnedFailed(false);
          return;
        }
        // A successful response with an empty board and nothing considered
        // means there is no slate for this sport today (NBA/NFL out of
        // season) — a real answer, not a failure. Retrying wastes three
        // round-trips and then shows a false error; worse, the fallback
        // board it produced was built from whatever propsData happened to
        // be loaded, which is how MLB picks ended up under the NBA tab.
        if (d?.ok && Array.isArray(d.picks) && d.considered === 0) {
          setNotYet(null);
          setPinned([]);
          setPinnedFailed(false);
          return;
        }
        throw new Error("empty pinned board");
      } catch {
        if (cancelled) return;
        if (attempt < 2) {
          setTimeout(() => load(attempt + 1), 1500 * (attempt + 1));
          return;
        }
        // Out of retries — fall back, but say so rather than quietly
        // presenting a different board as if it were the published one.
        setPinnedFailed(true);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [sport]);

  const localPicks = useMemo<PropPick[]>(() => {
    const build = (prop: RawProp, side: "over" | "under"): PropPick | null => {
      const best = side === "over" ? prop.bestOver : prop.bestUnder;
      if (!best?.price) return null;
      const marketFair =
        side === "over"
          ? (prop.fairOverProb ?? 50)
          : (prop.fairUnderProb ?? 50);
      const brainFair =
        side === "over" ? prop.brainOverProb : prop.brainUnderProb;
      const usesBrain = typeof brainFair === "number" && brainFair > 0;
      const fair = usesBrain ? brainFair! : marketFair;
      // Same true-EV math as scoreProp and /api/pinned-props.
      const decPayout =
        best.price > 0 ? 1 + best.price / 100 : 1 + 100 / Math.abs(best.price);
      const ev = ((fair / 100) * decPayout - 1) * 100;
      return {
        key: `${prop.market}-${prop.playerName}-${side}`,
        playerName: prop.playerName,
        playerId: prop.playerId,
        team: prop.team,
        side,
        line: prop.line,
        market: prop.market,
        odds: best.price,
        bookmaker: best.bookmaker,
        fairProb: Math.round(fair * 10) / 10,
        evPercentage: Math.round(ev * 10) / 10,
        score: ev + (fair - 50) * 0.05 + (usesBrain ? 0.5 : 0),
        label: MARKET_LABEL[prop.market] ?? prop.market,
        usesBrain,
        projectedValue: prop.brainProjectedValue,
        bestAlt: prop.bestAlt ?? null,
        isSynthesized: prop.isSynthesized,
      };
    };

    // Score each prop's strongest side, but split pools so we can enforce
    // an Over-majority board. Users want Overs; Unders only surface when
    // they're clearly the better pick.
    const overs: PropPick[] = [];
    const unders: PropPick[] = [];
    const seenPlayer = new Set<string>();
    for (const market of Object.keys(propsData)) {
      for (const prop of propsData[market] ?? []) {
        if (!prop.playerName) continue;
        if (prop.injuryStatus === "Out" || prop.injuryStatus === "Doubtful")
          continue;
        if (seenPlayer.has(prop.playerName)) continue;
        seenPlayer.add(prop.playerName);

        const forceOver = OVER_ONLY_MARKETS.has(prop.market);
        const tryOver = build(prop, "over");
        const tryUnder = forceOver ? null : build(prop, "under");

        // Decide which side this player's best edge is on. Over wins ties
        // within 3 points (stronger bias than before).
        const pickSide = forceOver
          ? "over"
          : tryOver && tryUnder
            ? tryOver.score >= tryUnder.score - 3
              ? "over"
              : "under"
            : tryOver
              ? "over"
              : "under";
        const winner = pickSide === "over" ? tryOver : tryUnder;
        if (!winner) continue;
        if (pickSide === "over") overs.push(winner);
        else unders.push(winner);
      }
    }

    overs.sort((a, b) => b.score - a.score);
    unders.sort((a, b) => b.score - a.score);

    // Build an 8-pick board weighted heavily Over: take up to 6 Overs, then
    // at most 2 Unders — but only the strongest Unders. If we have fewer
    // than 6 Overs, backfill with Unders so the board still fills.
    const TARGET = 8;
    const MAX_UNDERS = 2;
    const oversTaken = Math.min(overs.length, TARGET - MAX_UNDERS);
    const out: PropPick[] = [...overs.slice(0, oversTaken)];
    const underSlots = Math.max(0, TARGET - out.length);
    const undersTaken = Math.min(MAX_UNDERS, underSlots, unders.length);
    out.push(...unders.slice(0, undersTaken));
    // Backfill remaining from leftover Overs first (start past oversTaken), then Unders
    if (out.length < TARGET)
      out.push(...overs.slice(oversTaken, oversTaken + (TARGET - out.length)));
    if (out.length < TARGET)
      out.push(
        ...unders.slice(undersTaken, undersTaken + (TARGET - out.length)),
      );
    return out.slice(0, TARGET);
  }, [propsData]);

  // Prefer the pinned board; fall back to the local ranking only if the pinned
  // endpoint is unavailable, so the panel never goes dark.
  const picks = pinned ?? localPicks;

  if (loading) {
    return (
      <div
        className="glass rounded-xl overflow-hidden"
        aria-label="Loading player props"
        role="status"
      >
        <div className="px-3 sm:px-4 py-2.5 border-b border-purple/15 bg-purple/5 flex items-center gap-2">
          <Users className="w-4 h-4 text-purple" />
          <h2 className="text-xs sm:text-sm font-bold text-silver uppercase tracking-wider">
            Today&apos;s Player Props
          </h2>
        </div>
        <div className="divide-y divide-slate/10">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="px-3 sm:px-4 py-2 sm:py-2.5 min-h-[44px] sm:min-h-0 flex items-center gap-2.5 animate-pulse"
            >
              {/* Match real row sizing: 40px avatar mobile, 28px desktop */}
              <div className="w-10 h-10 sm:w-7 sm:h-7 rounded-full bg-slate/20 flex-shrink-0" />
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="h-3.5 w-2/3 bg-slate/20 rounded" />
                <div className="h-3 w-1/2 bg-slate/20 rounded" />
                <div className="h-2.5 w-1/3 bg-slate/15 rounded" />
              </div>
              <div className="flex flex-col sm:flex-row items-end sm:items-center gap-1.5 sm:gap-2 flex-shrink-0">
                <div className="h-4 w-10 bg-slate/20 rounded" />
                <div className="w-8 h-8 rounded-full bg-slate/15" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (picks.length === 0) {
    // Pre-lineup window. Checked BEFORE the brain/empty fallbacks below:
    // the server is deliberately withholding the board until lineups are
    // confirmed, so showing projected or locally-ranked picks here would
    // display exactly the lineup-blind numbers the gate exists to prevent.
    if (notYet) {
      return (
        <div className="glass rounded-xl overflow-hidden border border-purple/15">
          <div className="px-3 sm:px-4 py-2.5 border-b border-purple/15 bg-gradient-to-r from-purple/10 to-transparent flex items-center gap-2">
            <Users className="w-4 h-4 text-purple" />
            <div className="flex-1">
              <h2 className="text-xs sm:text-sm font-bold text-silver uppercase tracking-wider">
                Today&apos;s Player Props
              </h2>
              <p className="text-[9px] text-mercury/60 mt-0.5">
                Locks in around{" "}
                {formatHourET(notYet.buildsAtHourET) ?? "game time"} ET
              </p>
            </div>
            <Clock className="w-3.5 h-3.5 text-mercury/50" />
          </div>
          <div className="px-3 sm:px-4 py-6 text-center">
            <p className="text-xs text-mercury/70">
              Waiting on confirmed starting lineups.
            </p>
            <p className="text-[10px] text-mercury/50 mt-1.5 max-w-xs mx-auto leading-relaxed">
              Picks are made a few hours before first pitch, so they price real
              lineups instead of morning guesses. Check back around{" "}
              {formatHourET(notYet.buildsAtHourET) ?? "game time"} ET.
            </p>
          </div>
        </div>
      );
    }

    // NBA fallback: render brain-projected picks when no live odds posted yet
    if (sport === "nba" && brainPicks.length > 0) {
      return (
        <div className="glass rounded-xl overflow-hidden border border-purple/15">
          <div className="flex items-center gap-2 px-3 sm:px-4 py-1.5 bg-amber/10 border-b border-amber/25">
            <AlertTriangle className="w-3.5 h-3.5 text-amber flex-shrink-0" />
            <p className="text-[10px] sm:text-[11px] font-bold text-amber uppercase tracking-wide">
              Estimated lines — no live odds posted yet, not a confirmed market
              price
            </p>
          </div>
          <div className="px-3 sm:px-4 py-2.5 border-b border-purple/15 bg-gradient-to-r from-purple/10 to-transparent flex items-center gap-2">
            <Brain className="w-4 h-4 text-purple" />
            <div className="flex-1">
              <h2 className="text-xs sm:text-sm font-bold text-silver uppercase tracking-wider">
                Brain&apos;s Player Props
              </h2>
              <p className="text-[9px] text-mercury/60 mt-0.5">
                No live odds yet — showing brain projections for tonight
              </p>
            </div>
            <span className="text-[9px] font-mono text-purple bg-purple/10 px-2 py-0.5 rounded border border-purple/25">
              BRAIN
            </span>
          </div>
          <div className="divide-y divide-slate/10">
            {brainPicks.slice(0, 6).map((p, i) => {
              const tierColor =
                p.tier === "HIGH"
                  ? "text-neon"
                  : p.tier === "MEDIUM"
                    ? "text-amber"
                    : "text-electric";
              const sideColor = p.side === "over" ? "text-neon" : "text-danger";
              return (
                <div
                  key={`${p.playerName}-${p.market}-${i}`}
                  className="px-3 sm:px-4 py-2.5 flex items-center gap-3 hover:bg-gunmetal/20 transition-colors"
                >
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                      i === 0
                        ? "bg-gold/20 text-gold"
                        : "bg-purple/15 text-purple"
                    }`}
                  >
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-silver truncate">
                      {p.playerName}
                    </p>
                    <p className="text-[10px] text-mercury/60 truncate">
                      <span className={sideColor + " font-bold"}>
                        {p.side.toUpperCase()}
                      </span>{" "}
                      {p.line} {p.propType}
                      {p.seasonAvg ? ` · season avg ${p.seasonAvg}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-col items-end flex-shrink-0">
                    <span
                      className={`text-[10px] font-mono font-bold ${tierColor}`}
                    >
                      {p.brainConfidence}% conf
                    </span>
                    <span className="text-[9px] font-mono text-mercury/60">
                      {p.odds > 0 ? "+" : ""}
                      {p.odds} @ {p.bookmaker || "brain"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="px-3 py-2 text-center bg-gunmetal/20 border-t border-slate/10">
            <p className="text-[9px] text-mercury/50">
              Books usually post props 4–6 hours before tip-off — live odds
              appear here when available
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="glass rounded-xl overflow-hidden border border-purple/15">
        <div className="px-3 sm:px-4 py-2.5 border-b border-purple/15 bg-gradient-to-r from-purple/10 to-transparent flex items-center gap-2">
          <Users className="w-4 h-4 text-purple" />
          <div>
            <h2 className="text-xs sm:text-sm font-bold text-silver uppercase tracking-wider">
              Today&apos;s Player Props
            </h2>
            <p className="text-[9px] text-mercury/60 mt-0.5">
              Waiting for books to post lines
            </p>
          </div>
        </div>
        <div className="px-4 py-6 text-center">
          <p className="text-xs text-mercury/60">
            No {sport.toUpperCase()} player prop lines posted yet
          </p>
          <p className="text-[10px] text-mercury/40 mt-1">
            Books usually post props 4–6 hours before tip-off.
          </p>
          <p className="text-[10px] text-mercury/40 mt-0.5">
            {tipoffLabel
              ? `Next tip-off: ${tipoffLabel}`
              : "Check back closer to game time."}
          </p>
          <button
            onClick={() => {
              try {
                window.location.reload();
              } catch {}
            }}
            className="mt-3 inline-flex items-center justify-center gap-1 min-h-[36px] px-4 rounded-lg bg-purple/10 border border-purple/25 text-purple text-xs font-semibold hover:bg-purple/20 active:scale-95 transition-all"
          >
            Force refresh
          </button>
        </div>
      </div>
    );
  }

  // No client-side slicing. The server already withheld the locked picks and
  // reports how many in `locked` — slicing here would be theatre, since a free
  // user's response simply doesn't contain them. Falls back to the local
  // count for the live-ranking path, which never leaves the browser anyway.
  const visible = picks;
  const lockedCount = serverLocked;
  // Moneylines carry a dummy side:"over" (the PinnedProp shape requires a
  // side; a team ML has none), so counting them here reported "2 Overs" on a
  // board of one ML and one prop. Count props only, and report the ML count
  // separately so the header stops calling a team moneyline a player prop.
  const mlCount = picks.filter((p) => p.market === "moneyline").length;
  const propOnly = picks.filter((p) => p.market !== "moneyline");
  const overCount = propOnly.filter((p) => p.side === "over").length;

  // Running W/L tally across all visible picks — updates live as games grade.
  const tally = visible.reduce(
    (acc, p) => {
      const rows = resultsMap[p.playerName.toLowerCase()] ?? [];
      const row = rows.find((r) => r.market === p.market);
      if (!row) return acc;
      const isFinal = row.gameStatus === "final";
      const actual = row.actual;
      const hit =
        (p.side === "over" && actual > p.line) ||
        (p.side === "under" && actual < p.line);
      const push = actual === p.line;
      if (isFinal) {
        if (push) acc.pushes++;
        else if (hit) acc.wins++;
        else acc.losses++;
      } else if (row.gameStatus === "live") {
        acc.live++;
      }
      return acc;
    },
    { wins: 0, losses: 0, pushes: 0, live: 0 },
  );
  // Hide the win/loss/accuracy tally until there's a real sample — a 0W-1L
  // record reads as a meaningful stat when it's actually just noise from a
  // single day of grading. Reappears automatically once enough picks have
  // settled, no manual toggle needed. "Live" count is a real-time status,
  // not an accuracy claim, so it's shown independently of sample size.
  const MIN_GRADED_FOR_TALLY = 20;
  const showRecord = tally.wins + tally.losses >= MIN_GRADED_FOR_TALLY;
  const hasTally = showRecord || tally.live > 0;

  return (
    <div className="glass rounded-xl overflow-hidden border border-purple/15">
      {/* Header — div with button semantics (a real <button> here would nest
          the InfoTip/Link buttons inside it → invalid HTML + hydration error) */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((e) => !e)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((x) => !x);
          }
        }}
        className="w-full px-3 sm:px-4 py-2.5 border-b border-purple/15 bg-gradient-to-r from-purple/10 to-transparent flex items-center gap-2 hover:bg-purple/15 transition-colors text-left cursor-pointer select-none"
      >
        <Users className="w-4 h-4 text-purple" />
        <div className="flex-1">
          <h2 className="text-xs sm:text-sm font-bold text-silver uppercase tracking-wider flex items-center gap-1.5">
            {/* "Today's Board" when sharp moneylines are mixed in — calling a
                team ML a player prop is what made the board look broken. */}
            {mlCount > 0 && propOnly.length > 0
              ? "Today's Board"
              : mlCount > 0
                ? "Today's Sharp Moneylines"
                : "Today's Player Props"}
            <InfoTip term="EV" />
          </h2>
          <p className="text-[9px] text-mercury/60 mt-0.5">
            {/* Was "ranked by edge". The ranking is real (true EV, price
                included) but "edge" claims we're beating the market, and with
                fairProb coming from market devig we can't support that. State
                the count and leave it. */}
            {notYet ? (
              <span className="text-mercury/70">
                Board locks in around{" "}
                {formatHourET(notYet.buildsAtHourET) ?? "game time"} ET, once
                starting lineups are confirmed
              </span>
            ) : (
              <>
                {/* Moneylines are counted and named separately — the board
                    mixes them in deliberately, but a team ML is not a prop
                    and the header must not imply it is. */}
                {mlCount > 0 && (
                  <>
                    {mlCount} moneyline{mlCount !== 1 ? "s" : ""}
                    {propOnly.length > 0 ? " · " : ""}
                  </>
                )}
                {propOnly.length > 0 && (
                  <>
                    {propOnly.length} prop{propOnly.length !== 1 ? "s" : ""} ·{" "}
                    {overCount} Over{overCount !== 1 ? "s" : ""}
                  </>
                )}
              </>
            )}
            {pinnedFailed && (
              // Say it out loud. Silently swapping in a locally-ranked board
              // is what made the phone and desktop disagree in the first place.
              <span className="text-amber/80">
                {" "}
                · couldn&apos;t load today&apos;s locked board — showing live
                ranking, refresh to retry
              </span>
            )}
          </p>
          {hasTally && (
            <div className="flex items-center gap-2 mt-1 text-[10px] font-semibold">
              {showRecord && (
                <>
                  <span className="text-neon">{tally.wins}W</span>
                  <span className="text-danger">{tally.losses}L</span>
                  {tally.pushes > 0 && (
                    <span className="text-mercury/70">{tally.pushes}P</span>
                  )}
                  <span className="text-silver">
                    {Math.round(
                      (tally.wins / (tally.wins + tally.losses)) * 100,
                    )}
                    %
                  </span>
                </>
              )}
              {tally.live > 0 && (
                <span className="text-electric animate-pulse">
                  {tally.live} live
                </span>
              )}
            </div>
          )}
        </div>
        {lastUpdated && (
          <span
            className="hidden sm:flex items-center gap-1 text-[10px] text-mercury/50 font-mono flex-shrink-0"
            title={new Date(lastUpdated).toLocaleString()}
          >
            <Clock className="w-3 h-3" />
            Updated {relativeTime(lastUpdated)}
          </span>
        )}
        {sport === "nba" && (
          <Link
            href="/?tab=props"
            onClick={(e) => e.stopPropagation()}
            className="hidden sm:flex items-center gap-0.5 px-2 py-1 rounded bg-purple/10 border border-purple/25 text-purple/90 text-[10px] font-semibold hover:bg-purple/20 transition-colors"
          >
            All props <ChevronRight className="w-3 h-3" />
          </Link>
        )}
        <ChevronDown
          className={`w-4 h-4 text-mercury/50 transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </div>

      {/* Picks list */}
      {expanded && (
        <div className="divide-y divide-slate/10">
          {visible.map((p) => {
            const isOpen = openPick === p.key;
            // Grade this pick against box score actuals if available
            // Accent-insensitive lookup. resultsMap is keyed off the box
            // score's spelling ("jeremy peña") while the board carries the
            // plain-ASCII one ("jeremy pena") — a direct [] lookup missed
            // entirely, so an accented player's pick rendered with no result
            // at all. Same class of bug that made the grader void him server
            // side (see lib/mlb/prop-grader.ts stripAccents).
            const deaccent = (s: string) =>
              s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
            const wanted = deaccent(p.playerName);
            const boxRows =
              resultsMap[p.playerName.toLowerCase()] ??
              Object.entries(resultsMap).find(
                ([k]) => deaccent(k) === wanted,
              )?.[1] ??
              [];
            const boxRow = boxRows.find((r) => r.market === p.market);
            let result: "win" | "loss" | "push" | "live" | null = null;
            let actual: number | null = null;
            if (boxRow) {
              actual = boxRow.actual;
              const isFinal = boxRow.gameStatus === "final";
              const over = actual > p.line;
              const push = actual === p.line;
              if (push) result = "push";
              else if (
                (p.side === "over" && over) ||
                (p.side === "under" && !over)
              )
                result = isFinal ? "win" : "live";
              else result = isFinal ? "loss" : "live";
            }
            // The server-side graded result is authoritative once it exists —
            // it's what got posted to Discord and what the record counts.
            // The box-score path above stays as the LIVE in-progress view for
            // picks that haven't settled yet.
            if (
              p.result === "win" ||
              p.result === "loss" ||
              p.result === "push"
            )
              result = p.result;
            else if (p.result === "void") result = null;

            // Row tinting based on settled result
            const rowTint =
              result === "win"
                ? "bg-neon/5 border-l-2 border-neon/60"
                : result === "loss"
                  ? "bg-danger/5 border-l-2 border-danger/60"
                  : result === "push"
                    ? "bg-mercury/5 border-l-2 border-mercury/40"
                    : "";

            return (
              <div key={p.key}>
                <button
                  onClick={() => setOpenPick(isOpen ? null : p.key)}
                  className={`w-full px-3 sm:px-4 py-2 sm:py-2.5 min-h-[44px] sm:min-h-0 flex items-center gap-2.5 hover:bg-gunmetal/20 active:bg-slate/50 active:scale-[0.98] transition-all text-left touch-manipulation ${rowTint}`}
                >
                  {/* Player photo — 28px both breakpoints; the 40px mobile
                      variant was inflating every row's height */}
                  <div className="flex-shrink-0">
                    <PlayerAvatar
                      name={p.playerName}
                      playerId={p.playerId}
                      sport={sport}
                      size={28}
                    />
                  </div>
                  {/* Side icon — smaller, secondary on mobile. Moneylines
                      have no over/under, so they get a distinct sharp-edge
                      badge instead of an up/down arrow. */}
                  <div
                    className={`hidden sm:flex w-7 h-7 rounded-lg items-center justify-center flex-shrink-0 ${
                      p.market === "moneyline"
                        ? "bg-gold/10 text-gold"
                        : p.side === "over"
                          ? "bg-neon/10 text-neon"
                          : "bg-amber/10 text-amber"
                    }`}
                  >
                    {p.market === "moneyline" ? (
                      <Zap className="w-4 h-4" />
                    ) : p.side === "over" ? (
                      <ArrowUpRight className="w-4 h-4" />
                    ) : (
                      <ArrowDownRight className="w-4 h-4" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    {/* Player name — matches the type scale used everywhere
                        else in the board (Locks/Longshots etc use text-xs) */}
                    <p className="text-xs font-semibold text-silver leading-tight break-words">
                      {p.playerName}
                      {result === "win" && (
                        <span className="ml-1.5 text-[10px] font-bold text-neon">
                          ✓ WIN
                        </span>
                      )}
                      {result === "loss" && (
                        <span className="ml-1.5 text-[10px] font-bold text-danger">
                          ✗ LOSS
                        </span>
                      )}
                      {result === "push" && (
                        <span className="ml-1.5 text-[10px] font-bold text-mercury">
                          = PUSH
                        </span>
                      )}
                      {result === "live" &&
                        actual != null &&
                        p.market !== "moneyline" && (
                          <span className="ml-1.5 text-[10px] font-bold text-electric">
                            LIVE {actual}
                          </span>
                        )}
                    </p>
                    {/* Pick — bold, mobile gets inline side icon for hierarchy */}
                    <p
                      className={`text-xs font-bold leading-tight mt-0.5 flex items-center gap-1 ${p.market === "moneyline" ? "text-gold" : p.side === "over" ? "text-neon" : "text-amber"}`}
                    >
                      {p.market === "moneyline" ? (
                        <>
                          <Zap className="w-3.5 h-3.5 sm:hidden" />
                          Moneyline
                        </>
                      ) : (
                        <>
                          {p.side === "over" ? (
                            <ArrowUpRight className="w-3.5 h-3.5 sm:hidden" />
                          ) : (
                            <ArrowDownRight className="w-3.5 h-3.5 sm:hidden" />
                          )}
                          {p.side === "over" ? "OVER" : "UNDER"} {p.line}{" "}
                          {p.label}
                        </>
                      )}
                      {actual != null &&
                        boxRow?.gameStatus === "final" &&
                        p.market !== "moneyline" && (
                          <span className="ml-1 text-mercury/70 font-normal">
                            (final: {actual})
                          </span>
                        )}
                    </p>
                    {/* Inline-wrap on both breakpoints — the mobile flex-col
                        variant forced an extra stacked line per row, which
                        is most of what made these rows so tall. */}
                    <div className="flex flex-row items-center flex-wrap gap-x-1.5 gap-y-0.5 mt-0.5">
                      {/* Kept to a single line — the text column is only
                          ~174px on a 375px screen, so the old verbose version
                          ("Hard Rock Bet · 68.2% fair" + edge) wrapped to 3
                          lines and was the last thing making rows ~100px. */}
                      {/* Book + win probability only.
                          The EV% that used to sit here was measured against the
                          market's own de-vigged number, so it was negative on
                          essentially every prop and read as "we know this is a
                          bad bet" — not information anyone can act on. Show the
                          probability, which is a real stat, and let the odds in
                          the right rail speak for the price. */}
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-[10px] text-mercury/60 truncate">
                          {p.market === "moneyline"
                            ? `${p.bookmaker} · ${p.fairProb}% to win`
                            : `${p.bookmaker} · ${p.fairProb}% to hit`}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 flex-wrap">
                        {p.gameTime &&
                          (() => {
                            const gameDay = new Date(
                              p.gameTime,
                            ).toLocaleDateString("en-US", {
                              timeZone: "America/New_York",
                            });
                            const today = new Date().toLocaleDateString(
                              "en-US",
                              { timeZone: "America/New_York" },
                            );
                            return gameDay !== today ? (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber/15 border border-amber/30 text-amber text-[9px] font-bold">
                                TOMORROW
                              </span>
                            ) : null;
                          })()}
                        {p.usesBrain && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-purple/15 border border-purple/30 text-purple text-[9px] sm:text-[8px] font-bold">
                            <Brain className="w-2.5 h-2.5" />
                            BRAIN
                          </span>
                        )}
                        {p.isSynthesized && (
                          <span
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber/15 border border-amber/30 text-amber text-[9px] sm:text-[8px] font-bold"
                            title="Projected pick — books haven't posted lines yet. Estimated from season stats + brain, not a live market price."
                          >
                            PROJECTED — ESTIMATED
                          </span>
                        )}
                        {p.fairProb >= 60 && (
                          <Flame className="w-3 h-3 text-danger" />
                        )}
                        {p.bestAlt && p.bestAlt.edgePct >= 3 && (
                          <span
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber/15 border border-amber/30 text-amber text-[9px] sm:text-[8px] font-bold"
                            title={`Alt ${p.bestAlt.side} ${p.bestAlt.line} @ ${p.bestAlt.price > 0 ? "+" : ""}${p.bestAlt.price} (${p.bestAlt.bookmaker})`}
                          >
                            ALT {p.bestAlt.side === "over" ? "O" : "U"}
                            {p.bestAlt.line} +{p.bestAlt.edgePct}%
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* Right rail — odds and Parlay side-by-side. Stacking them
                      vertically on mobile made this rail 88px tall, which was
                      the real driver of the ~104px row height (the text column
                      is only ~49px). Horizontal keeps the 44px tap target
                      without inflating every row. */}
                  <div className="flex flex-row items-center gap-2 flex-shrink-0">
                    <span className="text-xs sm:text-sm font-mono font-bold text-silver leading-none">
                      {p.odds > 0 ? "+" : ""}
                      {p.odds}
                    </span>
                    {(() => {
                      const pickLabel = `${p.playerName} ${p.side === "over" ? "Over" : "Under"} ${p.line} ${p.label}`;
                      const inParlay = parlayLegs.some(
                        (l) =>
                          l.pick === pickLabel &&
                          l.bookmaker === (p.bookmaker ?? "") &&
                          l.odds === p.odds,
                      );
                      const showCheck = !!justAdded[p.key];
                      const handleAdd = () => {
                        if (inParlay) return;
                        addParlayLeg({
                          game: p.playerName,
                          market: "player_prop" as any,
                          pick: pickLabel,
                          odds: p.odds,
                          fairProb: p.fairProb / 100,
                          bookmaker: p.bookmaker ?? "",
                        });
                        setJustAdded((m) => ({ ...m, [p.key]: true }));
                        setTimeout(() => {
                          setJustAdded((m) => {
                            const { [p.key]: _gone, ...rest } = m;
                            return rest;
                          });
                        }, 1500);
                      };
                      return (
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label={
                            inParlay ? "Already in parlay" : "Add to parlay"
                          }
                          aria-pressed={inParlay || showCheck}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAdd();
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              handleAdd();
                            }
                          }}
                          className={`w-11 h-11 sm:w-8 sm:h-8 inline-flex items-center justify-center rounded-full border transition-all touch-manipulation cursor-pointer select-none active:scale-90 ${
                            showCheck
                              ? "bg-neon/30 border-neon/60 text-neon"
                              : inParlay
                                ? "bg-neon/20 border-neon/50 text-neon"
                                : "bg-neon/10 border-neon/25 text-neon hover:bg-neon/20 active:bg-neon/30"
                          }`}
                          title={inParlay ? "In parlay" : "Add to parlay"}
                        >
                          {showCheck || inParlay ? (
                            <Check className="w-4 h-4" />
                          ) : (
                            <Plus className="w-4 h-4" />
                          )}
                        </span>
                      );
                    })()}
                    <ChevronDown
                      className={`w-5 h-5 sm:w-3.5 sm:h-3.5 text-mercury/60 sm:text-mercury/50 transition-transform ${isOpen ? "rotate-180" : ""}`}
                    />
                  </div>
                </button>
                {isOpen && (
                  <PropDetail
                    sport={sport}
                    playerName={p.playerName}
                    market={p.market}
                    line={p.line}
                    side={p.side}
                  />
                )}
              </div>
            );
          })}
          {lockedCount > 0 && !isPremium && (
            <Link
              href="/pricing"
              className="block px-4 py-3 text-center bg-gradient-to-br from-neon/10 to-electric/5 hover:from-neon/20 transition-colors group"
            >
              <p className="text-xs font-bold text-neon">
                +{lockedCount} more prop pick{lockedCount !== 1 ? "s" : ""}{" "}
                locked
              </p>
              <p className="text-[10px] text-mercury/70 mt-0.5">
                Upgrade to Pro · $15/mo ·{" "}
                <span className="text-electric group-hover:underline">
                  Start 7-day free trial →
                </span>
              </p>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
