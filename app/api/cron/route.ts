import { NextResponse } from "next/server";
import {
  fetchTodayGames,
  getGameStatus,
  getTeamAbbrev,
} from "@/lib/mlb/stats-api";
import {
  loadNbaPropBrainFromCloud,
  saveNbaPropBrainToCloud,
} from "@/lib/bot/nba-prop-brain";
import { auditCompletedGames } from "@/lib/bot/nba-prop-audit";
import { commitPropProjections } from "@/lib/bot/nba-prop-ghost";
import { buildAndSendRecap } from "@/lib/bot/daily-recap";
import { sendDailyRecapToAll } from "@/lib/email/daily-recap";
import { generateSmartPicks } from "@/lib/bot/smart-picks";
import { cloudGet, cloudSet } from "@/lib/supabase/client";
import {
  logDailyPicks,
  settlePendingPicks,
  voidCancelledPicks,
  etDateString,
  type LoggedPick,
} from "@/lib/bot/track-record";

// This endpoint is called by Vercel Cron every 15 min (see vercel.json)
// It checks for finished games and logs results
// The actual Brain learning happens client-side when users open the app
// This just ensures we have fresh score data cached

export const dynamic = "force-dynamic";
// 300s, up from 120. This handler does a lot — scores, odds, pick
// generation, settlement, prop grading for four sports, plus the publish and
// recap fan-outs. At 120s it was being killed mid-flight, and the symptom was
// not a clean error: the in-flight fetch received Vercel's HTML error page
// and failed with `Unexpected token '<', "<!DOCTYPE"`, which is why the
// 2026-08-06 board silently never posted to Discord.
export const maxDuration = 300;

export async function GET(req: Request) {
  // Lock down: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`; internal/manual
  // callers use `x-cron-secret`. Grades bets + writes shared cloud state — must not be open.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    const headerSecret = req.headers.get("x-cron-secret");
    if (authHeader !== `Bearer ${cronSecret}` && headerSecret !== cronSecret) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    }
  }
  const url = new URL(req.url);
  const forceTrain = url.searchParams.get("forceTrain") === "true";
  const forceEvolve = url.searchParams.get("forceEvolve") === "true";

  // Base URL for every internal fetch this handler makes.
  //
  // NOT `new URL(req.url).origin`. When Vercel's scheduler invokes this
  // route, req.url carries the internal per-deployment host
  // (diamond-quant-live-<hash>.vercel.app), which sits behind Vercel's
  // deployment protection — so internal fetches to it came back as an HTML
  // LOGIN PAGE. That is the `Unexpected token '<', "<!DOCTYPE"` that
  // silently stopped the Discord board from ever auto-publishing, and it's
  // why it only ever worked when triggered by hand (a manual call arrives on
  // the public domain, so the origin was right).
  const selfOrigin =
    process.env.NODE_ENV === "development"
      ? url.origin
      : "https://diamond-quant-live.vercel.app";

  try {
    const games = await fetchTodayGames();

    const live = games.filter((g: any) => getGameStatus(g) === "live").length;
    const final = games.filter((g: any) => getGameStatus(g) === "final").length;
    const pre = games.filter((g: any) => getGameStatus(g) === "pre").length;

    // Log completed games for the Brain to process
    const completedGames = games
      .filter((g: any) => getGameStatus(g) === "final")
      .map((g: any) => ({
        id: String(g.gamePk),
        status: "final",
        homeTeam: g.teams?.home?.team?.name,
        awayTeam: g.teams?.away?.team?.name,
        homeAbbrev: g.teams?.home?.team?.abbreviation ?? "",
        awayAbbrev: g.teams?.away?.team?.abbreviation ?? "",
        homeScore: g.teams?.home?.score ?? 0,
        awayScore: g.teams?.away?.score ?? 0,
        homePitcher: g.teams?.home?.probablePitcher?.fullName ?? "TBD",
        awayPitcher: g.teams?.away?.probablePitcher?.fullName ?? "TBD",
      }));

    // Postponed/cancelled games never reach "final" — without voiding their
    // picks separately, they sat "pending" in daily_picks_log forever (see
    // voidCancelledPicks doc comment).
    const cancelledGames = games
      .filter((g: any) => getGameStatus(g) === "cancelled")
      .map((g: any) => ({
        homeTeam: g.teams?.home?.team?.name,
        awayTeam: g.teams?.away?.team?.name,
        homeAbbrev: g.teams?.home?.team?.abbreviation ?? "",
        awayAbbrev: g.teams?.away?.team?.abbreviation ?? "",
        homeScore: 0,
        awayScore: 0,
      }));

    // ── NBA Prop Brain: Post-Game Audit ──
    let nbaAudit = { graded: 0, hits: 0, misses: 0 };
    let nbaGhostCommitted = 0;
    try {
      const nbaBrain = await loadNbaPropBrainFromCloud();

      // 1. Audit completed games
      const { updatedBrain, graded, hits, misses } =
        await auditCompletedGames(nbaBrain);
      if (graded > 0) {
        await saveNbaPropBrainToCloud(updatedBrain);
        nbaAudit = { graded, hits, misses };
      }

      // 2. Commit ghost prop projections for upcoming NBA games (all 3 markets)
      try {
        const baseUrl = `https://diamond-quant-live.vercel.app`;
        const allProps: any[] = [];
        for (const market of [
          "player_points",
          "player_rebounds",
          "player_assists",
        ]) {
          try {
            const oddsRes = await fetch(
              `${baseUrl}/api/players?sport=basketball_nba&market=${market}`,
            );
            if (oddsRes.ok) {
              const oddsData = await oddsRes.json();
              for (const p of oddsData.props ?? []) {
                allProps.push({
                  playerName: p.playerName,
                  team: p.team,
                  gameId: p.gameTime ?? "",
                  propType: market,
                  line: p.line,
                  bestOverOdds: p.bestOver?.price ?? -110,
                  bestUnderOdds: p.bestUnder?.price ?? -110,
                  isHome: false,
                });
              }
            }
          } catch {}
        }
        if (allProps.length > 0) {
          const brain = graded > 0 ? updatedBrain : nbaBrain;
          const { committed } = await commitPropProjections(
            brain,
            allProps,
            {},
          );
          nbaGhostCommitted = committed;
        }
      } catch {}
    } catch {}

    // ── Commit MLB prop projections (sport=mlb, simple seasonAvg projector) ──
    let mlbGhostCommitted = 0;
    try {
      const baseUrl = `https://diamond-quant-live.vercel.app`;
      const today = etDateString();
      const allMlbProps: any[] = [];
      const { MLB_MARKETS, commitMLBPropProjections } =
        await import("@/lib/bot/mlb-prop-pipeline");
      for (const market of MLB_MARKETS) {
        try {
          const res = await fetch(
            `${baseUrl}/api/players?sport=baseball_mlb&market=${market}`,
            { signal: AbortSignal.timeout(10000) },
          );
          if (!res.ok) continue;
          const data = await res.json();
          for (const p of data.props ?? []) {
            allMlbProps.push({
              playerName: p.playerName,
              team: p.team ?? "",
              gameId: p.gameTime ?? "",
              market,
              line: p.line,
              bestOverOdds: p.bestOver?.price ?? -110,
              bestUnderOdds: p.bestUnder?.price ?? -110,
            });
          }
        } catch {}
      }
      if (allMlbProps.length > 0) {
        const { committed } = await commitMLBPropProjections(
          allMlbProps,
          today,
        );
        mlbGhostCommitted = committed;
      }
    } catch (e) {
      console.error("mlb prop commit error:", e);
    }

    // ── Commit NRFI/YRFI predictions (MLB) ──
    let nrfiCommitted = 0;
    try {
      const today = etDateString();
      const { commitNRFIProjections } = await import("@/lib/bot/nrfi-pipeline");
      // Normalize all MLB games (pre + live + final) into engine-expected shape
      const normalizedForNRFI = games.map((g: any) => ({
        id: String(g.gamePk),
        homeTeam: g.teams?.home?.team?.name ?? "",
        awayTeam: g.teams?.away?.team?.name ?? "",
        homeAbbrev: getTeamAbbrev(g.teams?.home?.team?.name ?? ""),
        awayAbbrev: getTeamAbbrev(g.teams?.away?.team?.name ?? ""),
        homePitcher: g.teams?.home?.probablePitcher?.fullName ?? "TBD",
        awayPitcher: g.teams?.away?.probablePitcher?.fullName ?? "TBD",
        status: getGameStatus(g),
        startTime: g.gameDate ?? "",
        venue: g.venue?.name ?? "",
      }));
      const result = await commitNRFIProjections(normalizedForNRFI, today);
      nrfiCommitted = result.committed;
    } catch (e) {
      console.error("nrfi commit error:", e);
    }

    // ── NFL prop commit + grade ──
    let nflCommitted = 0;
    let nflGraded = 0;
    let nflCompletedGames: Array<{ id: string }> = [];
    try {
      const { fetchTodayNFLGames, getNFLGameStatus } =
        await import("@/lib/nfl/stats-api");
      const events = await fetchTodayNFLGames();
      if (events.length > 0) {
        const today = etDateString();
        // Normalize for commit
        const normalized = events
          .filter((ev: any) => getNFLGameStatus(ev) === "pre")
          .map((ev: any) => {
            const comp = ev.competitions?.[0];
            const home = comp?.competitors?.find(
              (c: any) => c.homeAway === "home",
            );
            const away = comp?.competitors?.find(
              (c: any) => c.homeAway === "away",
            );
            return {
              gameId: String(ev.id),
              homeAbbrev: home?.team?.abbreviation ?? "",
              awayAbbrev: away?.team?.abbreviation ?? "",
              gameDate: today,
            };
          })
          .filter((g: any) => g.homeAbbrev && g.awayAbbrev);

        if (normalized.length > 0) {
          const { commitNFLPropProjections } =
            await import("@/lib/bot/nfl-prop-pipeline");
          const result = await commitNFLPropProjections(normalized, today);
          nflCommitted = result.committed;
        }

        // Collect completed for grading
        nflCompletedGames = events
          .filter((ev: any) => getNFLGameStatus(ev) === "final")
          .map((ev: any) => ({ id: String(ev.id) }));

        if (nflCompletedGames.length > 0) {
          const { gradeNFLPropPredictions } =
            await import("@/lib/bot/nfl-prop-pipeline");
          const result = await gradeNFLPropPredictions(nflCompletedGames);
          nflGraded = result.graded;
          if (result.newlyGraded.length > 0) {
            const histKey = "prop_pick_history_nfl";
            const existing = (await cloudGet<any[]>(histKey, [])) ?? [];
            const seenKey = (p: any) =>
              `${(p.playerName ?? "").toLowerCase()}::${p.propType ?? p.market ?? ""}::${p.date ?? ""}`;
            const seen = new Set(existing.map(seenKey));
            const fresh = result.newlyGraded.filter(
              (p: any) => !seen.has(seenKey(p)),
            );
            if (fresh.length > 0) {
              const merged = [...fresh, ...existing].slice(0, 500);
              await cloudSet(histKey, merged);
            }
          }
        }
      }
    } catch (e) {
      console.error("nfl pipeline error:", e);
    }

    // ── NHL prop commit + grade ──
    let nhlCommitted = 0;
    let nhlGraded = 0;
    try {
      const { fetchTodayNHLGames, getNHLGameStatus } =
        await import("@/lib/nhl/stats-api");
      const events = await fetchTodayNHLGames();
      if (events.length > 0) {
        const today = etDateString();
        const normalized = events
          .filter((g: any) => getNHLGameStatus(g) === "pre")
          .map((g: any) => ({
            gameId: String(g.id),
            homeAbbrev: g.homeTeam?.abbrev ?? "",
            awayAbbrev: g.awayTeam?.abbrev ?? "",
            gameDate: today,
          }))
          .filter((g: any) => g.homeAbbrev && g.awayAbbrev);

        if (normalized.length > 0) {
          const { commitNHLPropProjections } =
            await import("@/lib/bot/nhl-prop-pipeline");
          const result = await commitNHLPropProjections(normalized, today);
          nhlCommitted = result.committed;
        }

        const completed = events
          .filter((g: any) => getNHLGameStatus(g) === "final")
          .map((g: any) => ({ id: String(g.id) }));

        if (completed.length > 0) {
          const { gradeNHLPropPredictions } =
            await import("@/lib/bot/nhl-prop-pipeline");
          const result = await gradeNHLPropPredictions(completed);
          nhlGraded = result.graded;
          if (result.newlyGraded.length > 0) {
            const histKey = "prop_pick_history_nhl";
            const existing = (await cloudGet<any[]>(histKey, [])) ?? [];
            const seenKey = (p: any) =>
              `${(p.playerName ?? "").toLowerCase()}::${p.propType ?? p.market ?? ""}::${p.date ?? ""}`;
            const seen = new Set(existing.map(seenKey));
            const fresh = result.newlyGraded.filter(
              (p: any) => !seen.has(seenKey(p)),
            );
            if (fresh.length > 0) {
              const merged = [...fresh, ...existing].slice(0, 500);
              await cloudSet(histKey, merged);
            }
          }
        }
      }
    } catch (e) {
      console.error("nhl pipeline error:", e);
    }

    // ── Track Record: settle yesterday's logged picks ──
    let trackSettled = 0;
    const settleGames = completedGames.map((g) => ({
      homeTeam: g.homeTeam ?? "",
      awayTeam: g.awayTeam ?? "",
      homeAbbrev: g.homeAbbrev ?? "",
      awayAbbrev: g.awayAbbrev ?? "",
      homeScore: g.homeScore ?? 0,
      awayScore: g.awayScore ?? 0,
    }));
    try {
      const { settled } = await settlePendingPicks(settleGames);
      trackSettled = settled;
    } catch (e) {
      console.error("track settle error:", e);
    }

    // ── Track Record: void picks on postponed/cancelled games ──
    let trackVoided = 0;
    try {
      const { voided } = await voidCancelledPicks(cancelledGames);
      trackVoided = voided;
    } catch (e) {
      console.error("track void error:", e);
    }

    // ── User Bets: auto-settle every user's pending bets ──
    // Runs whenever there are completed games + gated by env flag for safety
    let userBetsSettled = { users: 0, bets: 0 };
    if (
      process.env.BET_AUTOSETTLE_ENABLED === "1" &&
      completedGames.length > 0
    ) {
      try {
        const { supabaseAdmin } = await import("@/lib/supabase/server-auth");
        const { gradeBet } = await import("@/lib/bot/bet-grader");
        if (supabaseAdmin) {
          const { data: userRows } = await supabaseAdmin
            .from("user_state")
            .select("user_id,value")
            .eq("key", "betHistory");

          for (const row of userRows ?? []) {
            const bets: any[] = Array.isArray(row.value) ? row.value : [];
            const pending = bets.filter((b) => b.result === "pending");
            if (pending.length === 0) continue;

            let changed = 0;
            for (const bet of bets) {
              if (bet.result !== "pending") continue;
              const outcome = gradeBet(bet, settleGames);
              if (outcome.result === "pending") continue;
              bet.result = outcome.result;
              bet.payout = outcome.payout;
              bet.settledAt = outcome.settledAt;
              bet.settleReason = outcome.reason;
              changed++;
            }
            if (changed === 0) continue;

            // Recompute bankroll totals off the full bet history
            const { data: bankrollRow } = await supabaseAdmin
              .from("user_state")
              .select("value")
              .eq("user_id", row.user_id)
              .eq("key", "bankroll")
              .single();
            const br: any = bankrollRow?.value ?? {
              bankroll: 5000,
              startingBankroll: 5000,
            };
            const starting = Number(br.startingBankroll ?? br.bankroll ?? 5000);
            const wins = bets.filter((b) => b.result === "win").length;
            const losses = bets.filter((b) => b.result === "loss").length;
            const pushes = bets.filter((b) => b.result === "push").length;
            const totalStaked = bets.reduce(
              (s, b) => s + (Number(b.stake) || 0),
              0,
            );
            const totalReturns = bets.reduce(
              (s, b) => s + (Number(b.payout) || 0),
              0,
            );
            const currentBankroll = starting + totalReturns - totalStaked;
            const newBankroll = {
              ...br,
              startingBankroll: starting,
              currentBankroll: Math.round(currentBankroll * 100) / 100,
              totalBets: bets.length,
              totalStaked: Math.round(totalStaked * 100) / 100,
              totalReturns: Math.round(totalReturns * 100) / 100,
              wins,
              losses,
              pushes,
              roi:
                totalStaked > 0
                  ? Math.round(
                      ((currentBankroll - starting) / totalStaked) * 10000,
                    ) / 100
                  : 0,
            };

            await supabaseAdmin.from("user_state").upsert({
              user_id: row.user_id,
              key: "betHistory",
              value: bets,
            });
            await supabaseAdmin.from("user_state").upsert({
              user_id: row.user_id,
              key: "bankroll",
              value: newBankroll,
            });

            userBetsSettled.users++;
            userBetsSettled.bets += changed;
          }
        }
      } catch (e) {
        console.error("user bet settle error:", e);
      }
    }

    // ── Auto-generate today's smart picks for all users ──
    // Runs in the morning hours (7-11 AM ET = 11-15 UTC) so picks are ready for the day.
    // pickGen surfaces success/failure in the cron JSON response instead of a
    // silent try/catch — lets us tell "cron ran but produced 0 picks" apart
    // from "cron never got this far" from the Vercel cron log/response alone.
    const pickGen: {
      mlb:
        | "generated"
        | "already-cached"
        | "no-picks"
        | "fetch-failed"
        | "skipped-window"
        | "error";
      nba:
        | "generated"
        | "already-cached"
        | "no-picks"
        | "fetch-failed"
        | "skipped-window"
        | "error";
      error?: string;
    } = { mlb: "skipped-window", nba: "skipped-window" };
    // Generate any time today's picks are still missing — not just in a fixed
    // morning window. The old `utcHour >= 11 && <= 15` gate meant that if cron
    // failed during those 4 hours (e.g. the DB was down), picks never
    // generated for the rest of the day and the Bot tab stayed empty with no
    // recovery path. The `already-cached` check below makes re-running cheap,
    // so there's no reason to refuse outside the morning. Still skipped
    // overnight (0-10 UTC = 8pm-6am ET) when there's no fresh slate to price.
    const utcHour = new Date().getUTCHours();
    if (utcHour >= 11) {
      try {
        const today = etDateString();

        // MLB picks
        const mlbTodayKey = `smart_bot_today_mlb_${today}`;
        const existingMlb = await cloudGet(mlbTodayKey, null);
        if (existingMlb) {
          pickGen.mlb = "already-cached";
        } else {
          const baseUrl = "https://diamond-quant-live.vercel.app"; // public alias — VERCEL_URL sits behind Vercel deployment protection and returns an HTML auth page instead of JSON
          const mlbRes = await fetch(`${baseUrl}/api/bot-analysis`);
          if (mlbRes.ok) {
            const mlbData = await mlbRes.json();
            const mlbPicks = generateSmartPicks(mlbData.analyses ?? [], 5000);
            pickGen.mlb = mlbPicks.length > 0 ? "generated" : "no-picks";
            if (mlbPicks.length > 0) {
              await cloudSet(mlbTodayKey, {
                picks: mlbPicks,
                generatedAt: new Date().toISOString(),
              });
              // Also update the persistent smart bot state
              const botState = (await cloudGet("smart_bot", {
                bankroll: 5000,
                picks: [],
                dailyPnL: {},
              })) as any;
              const existingToday = (botState.picks ?? []).filter(
                (p: any) => p.date === today,
              );
              if (existingToday.length === 0) {
                await cloudSet("smart_bot", {
                  ...botState,
                  picks: [...(botState.picks ?? []), ...mlbPicks],
                });
              }

              // ── Persist to the verifiable ledger ──
              // The cloudSet above writes a blob only this cron reads, and the
              // UI's bankroll still lives in each visitor's localStorage — so
              // there has never been a checkable record. bot_picks is one row
              // per pick, service-role write, public read, graded against
              // final scores. That's what makes a 62% backtest into something
              // anyone can audit.
              try {
                const { supabaseAdmin } =
                  await import("@/lib/supabase/server-auth");
                if (supabaseAdmin) {
                  const rows = mlbPicks.map((p: any) => ({
                    id: p.id,
                    sport: "mlb",
                    slate_date: etDateString(),
                    game_id: p.gameId ?? null,
                    game: p.game,
                    pick: p.pick,
                    market: p.market ?? "moneyline",
                    odds: p.odds,
                    bookmaker: p.bookmaker ?? null,
                    stake: p.stake,
                    model_prob: (p.consensusProb ?? 50) / 100,
                    ev_percentage: p.evPercentage ?? null,
                    pitcher_score: p.pitcherScore ?? null,
                    market_score: p.marketScore ?? null,
                    trend_score: p.trendScore ?? null,
                    confidence: p.confidence ?? null,
                  }));
                  // ignoreDuplicates, not overwrite: a re-run must never
                  // rewrite a pick that has already been graded.
                  const { error: bpErr } = await supabaseAdmin
                    .from("bot_picks")
                    .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
                  (pickGen as any).mlbLedger = bpErr
                    ? `error: ${bpErr.message}`
                    : rows.length;
                }
              } catch (e) {
                (pickGen as any).mlbLedger = `error: ${String(e)}`;
              }

              // ── Log to public track record ──
              // Forced picks (no game cleared the confidence+EV bar today —
              // shown for visibility only, explicitly not a recommendation)
              // don't count toward the public track record.
              const etDate = etDateString();
              const logged: LoggedPick[] = mlbPicks
                .filter((p: any) => !p.isForcedPick)
                .slice(0, 5)
                .map((p: any, idx: number) => ({
                  sport: "mlb" as const,
                  pickDate: etDate,
                  category:
                    idx === 0 ? "lock" : p.odds > 150 ? "longshot" : "lock",
                  pickText: p.pick,
                  game: p.game,
                  market: p.market,
                  odds: p.odds,
                  bookmaker: p.bookmaker,
                  evPercentage: p.evPercentage,
                  fairProb: p.fairProb,
                  confidence: p.confidence,
                }));
              await logDailyPicks(logged);

              // Fire a push to subscribed users for the sharpest pick
              try {
                const top: any = mlbPicks[0];
                const ev = Number(
                  top?.evPercentage ?? logged[0]?.evPercentage ?? 0,
                );
                if (top && ev >= 5) {
                  const { sendPushToAll } = await import("@/lib/push/send");
                  await sendPushToAll({
                    title: `MLB +${ev.toFixed(1)}% EV`,
                    body: `${top.pick} @ ${top.odds > 0 ? "+" : ""}${top.odds} (${top.bookmaker})`,
                    url: "/",
                    tag: `mlb-${today}`,
                  });
                }
              } catch {}
            }
          } else {
            pickGen.mlb = "fetch-failed";
          }
        }

        // NBA picks
        const nbaTodayKey = `smart_bot_today_nba_${today}`;
        const existingNba = await cloudGet(nbaTodayKey, null);
        if (existingNba) {
          pickGen.nba = "already-cached";
        } else {
          const baseUrl = "https://diamond-quant-live.vercel.app"; // public alias — VERCEL_URL sits behind Vercel deployment protection and returns an HTML auth page instead of JSON
          const nbaRes = await fetch(`${baseUrl}/api/nba-analysis`);
          if (nbaRes.ok) {
            const nbaData = await nbaRes.json();
            const nbaPicks = generateSmartPicks(nbaData.analyses ?? [], 5000);
            pickGen.nba = nbaPicks.length > 0 ? "generated" : "no-picks";
            if (nbaPicks.length > 0) {
              await cloudSet(nbaTodayKey, {
                picks: nbaPicks,
                generatedAt: new Date().toISOString(),
              });
              const nbaBotState = (await cloudGet("smart_bot_nba", {
                bankroll: 5000,
                picks: [],
                dailyPnL: {},
              })) as any;
              const existingNbaToday = (nbaBotState.picks ?? []).filter(
                (p: any) => p.date === today,
              );
              if (existingNbaToday.length === 0) {
                await cloudSet("smart_bot_nba", {
                  ...nbaBotState,
                  picks: [...(nbaBotState.picks ?? []), ...nbaPicks],
                });
              }

              // ── Log to public track record ──
              const etDate = etDateString();
              const logged: LoggedPick[] = nbaPicks
                .slice(0, 5)
                .map((p: any, idx: number) => ({
                  sport: "nba" as const,
                  pickDate: etDate,
                  category:
                    idx === 0 ? "lock" : p.odds > 150 ? "longshot" : "lock",
                  pickText: p.pick,
                  game: p.game,
                  market: p.market,
                  odds: p.odds,
                  bookmaker: p.bookmaker,
                  evPercentage: p.evPercentage,
                  fairProb: p.fairProb,
                  confidence: p.confidence,
                }));
              await logDailyPicks(logged);

              try {
                const top: any = nbaPicks[0];
                const ev = Number(
                  top?.evPercentage ?? logged[0]?.evPercentage ?? 0,
                );
                if (top && ev >= 5) {
                  const { sendPushToAll } = await import("@/lib/push/send");
                  await sendPushToAll({
                    title: `NBA +${ev.toFixed(1)}% EV`,
                    body: `${top.pick} @ ${top.odds > 0 ? "+" : ""}${top.odds} (${top.bookmaker})`,
                    url: "/",
                    tag: `nba-${today}`,
                  });
                }
              } catch {}
            }
          } else {
            pickGen.nba = "fetch-failed";
          }
        }
        // ── High-confidence picks push (sent once per day, all sports combined) ──
        try {
          const pushSentKey = `push_sent_today_${today}`;
          const alreadySent = await cloudGet(pushSentKey, null);
          if (!alreadySent) {
            // Collect all picks generated this run from cache
            const mlbCache = (await cloudGet(mlbTodayKey, null)) as any;
            const nbaCache = (await cloudGet(nbaTodayKey, null)) as any;
            const allPicks: any[] = [
              ...(mlbCache?.picks ?? []),
              ...(nbaCache?.picks ?? []),
            ];
            const highConf = allPicks.filter(
              (p: any) => p.confidence === "HIGH",
            );
            if (highConf.length >= 3) {
              const sports = [
                ...new Set(
                  highConf.map((p: any) => p.sport ?? "").filter(Boolean),
                ),
              ];
              const sportLabel =
                sports.length > 0 ? sports.join("/").toUpperCase() : "MLB/NBA";
              const { sendPushToAll } = await import("@/lib/push/send");
              await sendPushToAll({
                title: `🔥 ${highConf.length} high-confidence picks today — ${sportLabel}`,
                body: `Quant Betting has locked in ${highConf.length} HIGH confidence plays for today.`,
                url: "/",
                tag: `high-conf-${today}`,
              });
              await cloudSet(pushSentKey, {
                sentAt: new Date().toISOString(),
                count: highConf.length,
              });
            }
          }
        } catch {}
      } catch (e: any) {
        console.error("pick gen/log error:", e);
        pickGen.error = e?.message ?? String(e);
        if (pickGen.mlb === "skipped-window") pickGen.mlb = "error";
        if (pickGen.nba === "skipped-window") pickGen.nba = "error";
      }
    }

    // ── Daily Discord Recap (send once when games are finishing) ──
    //
    // This is the LEGACY per-user webhook recap (user_preferences.discord_webhook),
    // separate from the main channel recap that /api/post-results posts.
    //
    // The gate used to be `final > 0`, where `final` counts MLB finals only —
    // but the block sent an NBA recap too. Out of baseball season that meant
    // `final` is 0 every night, so NBA subscribers got nothing; and NFL was
    // never sent at all. Each sport now gates on its OWN finals.
    //
    // NBA is absent here because nbaCompletedGames is computed further down
    // this handler; rather than reorder the pipeline, NBA gates on the same
    // late-night ET window and lets buildAndSendRecap no-op when it finds
    // nothing graded — the same way it already behaves for an empty slate.
    const hour = new Date().getUTCHours(); // UTC
    if (hour >= 3 && hour <= 7) {
      // ~11PM-3AM ET = games finishing
      const recapSports = [
        ...(final > 0 ? ["mlb"] : []),
        "nba",
        ...(nflCompletedGames.length > 0 ? ["nfl"] : []),
      ];
      try {
        // Check user preferences for Discord webhooks
        const { supabase: sb } = await import("@/lib/supabase/client");
        if (sb && recapSports.length > 0) {
          const { data: prefs } = await sb
            .from("user_preferences")
            .select("discord_webhook")
            .neq("discord_webhook", "")
            .limit(500);
          // Parallelize webhook sends so cron doesn't serialize O(n) network calls
          await Promise.all(
            (prefs ?? []).flatMap((pref: any) =>
              pref.discord_webhook
                ? recapSports.map((s) =>
                    buildAndSendRecap(pref.discord_webhook, s).catch(() => {}),
                  )
                : [],
            ),
          );
        }
      } catch (e) {
        console.error(
          "Discord recap error:",
          e instanceof Error ? e.message : e,
        );
      }
    }

    // ── Daily Email Recap (8am ET = 12-13 UTC) ──
    // No-op when RESEND_API_KEY is not configured.
    let emailRecap = { sent: 0, skipped: 0 };
    if (utcHour >= 12 && utcHour <= 13) {
      try {
        const baseUrl = "https://diamond-quant-live.vercel.app"; // public alias — VERCEL_URL sits behind Vercel deployment protection and returns an HTML auth page instead of JSON
        emailRecap = await sendDailyRecapToAll(baseUrl);
      } catch (e) {
        console.error("email recap error:", e);
      }
    }

    // ── NBA final games from ESPN scoreboard (MLB already in `completedGames`) ──
    // Fetch every date that has a pending NBA pick so none stay un-graded.
    const nbaCompletedGames: any[] = [];
    try {
      const yyyymmdd = (offset: number) => {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() + offset);
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, "0");
        const day = String(d.getUTCDate()).padStart(2, "0");
        return `${y}${m}${day}`;
      };
      // Always pull today + yesterday (late games). Plus any dates referenced
      // by pending NBA picks so we can clean up the backlog.
      const dateSet = new Set<string>([yyyymmdd(0), yyyymmdd(-1)]);
      try {
        const nbaState = (await cloudGet("smart_bot_nba", {
          picks: [],
        })) as any;
        for (const p of nbaState.picks ?? []) {
          if (p.result !== "pending" || !p.date) continue;
          dateSet.add(p.date.replace(/-/g, "")); // YYYY-MM-DD → YYYYMMDD
        }
      } catch {}
      for (const d of Array.from(dateSet)) {
        const sbRes = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${d}`,
          { next: { revalidate: 60 } },
        );
        if (!sbRes.ok) continue;
        const sb = await sbRes.json();
        for (const ev of sb.events ?? []) {
          const comp = ev.competitions?.[0];
          if (comp?.status?.type?.name !== "STATUS_FINAL") continue;
          const home = comp.competitors?.find(
            (c: any) => c.homeAway === "home",
          );
          const away = comp.competitors?.find(
            (c: any) => c.homeAway === "away",
          );
          if (!home || !away) continue;
          nbaCompletedGames.push({
            id: String(ev.id),
            status: "final",
            homeTeam: home.team?.displayName ?? "",
            awayTeam: away.team?.displayName ?? "",
            homeAbbrev: home.team?.abbreviation ?? "",
            awayAbbrev: away.team?.abbreviation ?? "",
            homeScore: Number(home.score ?? 0),
            awayScore: Number(away.score ?? 0),
          });
        }
      }
    } catch (e) {
      console.error("nba scoreboard error:", e);
    }

    // ── MLB + NBA Bot Settlement ──
    const botSettle = {
      mlb: 0,
      nba: 0,
      nbaFeed: nbaCompletedGames.length,
      mlbFeed: completedGames.length,
    };
    try {
      const { settleAndLearn } = await import("@/lib/bot/smart-picks");

      for (const { key, sport, feed } of [
        { key: "smart_bot", sport: "mlb", feed: completedGames },
        { key: "smart_bot_nba", sport: "nba", feed: nbaCompletedGames },
      ]) {
        if (feed.length === 0) continue;
        const state = (await cloudGet(key, {
          bankroll: 5000,
          picks: [],
          dailyPnL: {},
        })) as any;
        const pending = (state.picks ?? []).filter(
          (p: any) => p.result === "pending",
        );
        if (pending.length === 0) continue;
        const { botState: settled } = settleAndLearn(state, feed, sport);
        const newlySettled = settled.picks.filter(
          (p: any, i: number) =>
            state.picks[i]?.result === "pending" && p.result !== "pending",
        ).length;
        if (newlySettled > 0) {
          await cloudSet(key, settled);
          if (sport === "mlb") botSettle.mlb = newlySettled;
          else botSettle.nba = newlySettled;

          // Mirror the outcome into bot_picks. settleAndLearn only updates the
          // cloud blob, which nobody can audit; the ledger is the public,
          // per-row record. Written here rather than re-derived later so a
          // pick's grade always matches the one the bot actually acted on.
          try {
            const { supabaseAdmin } =
              await import("@/lib/supabase/server-auth");
            if (supabaseAdmin) {
              for (const p of settled.picks as any[]) {
                if (p.result === "pending") continue;
                const stake = Number(p.stake ?? 0);
                const profit =
                  p.result === "win"
                    ? Number(p.payout ?? 0) - stake
                    : p.result === "push"
                      ? 0
                      : -stake;
                await supabaseAdmin
                  .from("bot_picks")
                  .update({
                    result: p.result,
                    payout: Number(p.payout ?? 0),
                    profit_units: Math.round(profit * 100) / 100,
                    final_score: p.finalScore ?? null,
                    settled_at: new Date().toISOString(),
                  })
                  .eq("id", p.id)
                  .eq("result", "pending"); // never re-grade a settled row
              }
            }
          } catch (e) {
            console.error("bot_picks settle mirror failed:", e);
          }
        }
      }
    } catch (e) {
      console.error("bot settle error:", e);
    }

    // ── Grade today's NBA prop picks against box scores ──
    let propsGraded = 0;
    if (nbaCompletedGames.length > 0) {
      try {
        const { gradePropPick } = await import("@/lib/bot/prop-grader");
        const today = etDateString();
        const propCacheKey = `prop_picks_today_nba_${today}`;
        const propData = await cloudGet<any>(propCacheKey, null);
        if (propData?.picks?.length > 0) {
          let changed = false;
          const newlyGraded: any[] = [];
          for (const pick of propData.picks) {
            if (pick.result) continue; // already graded
            for (const game of nbaCompletedGames) {
              try {
                const boxRes = await fetch(
                  `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${game.id}`,
                  { next: { revalidate: 300 } },
                );
                if (!boxRes.ok) continue;
                const boxData = await boxRes.json();
                const players: Array<{
                  playerName: string;
                  pts: number;
                  reb: number;
                  ast: number;
                  minutes: number;
                }> = [];
                for (const team of boxData.boxscore?.players ?? []) {
                  for (const stat of team.statistics ?? []) {
                    const labels: string[] = stat.labels ?? [];
                    const minIdx = labels.indexOf("MIN");
                    const ptsIdx = labels.indexOf("PTS");
                    const rebIdx = labels.indexOf("REB");
                    const astIdx = labels.indexOf("AST");
                    for (const athlete of stat.athletes ?? []) {
                      const stats: string[] = athlete.stats ?? [];
                      const mins =
                        minIdx >= 0 ? parseInt(stats[minIdx] ?? "0") : 0;
                      const pts =
                        ptsIdx >= 0 ? parseInt(stats[ptsIdx] ?? "0") : 0;
                      const reb =
                        rebIdx >= 0 ? parseInt(stats[rebIdx] ?? "0") : 0;
                      const ast =
                        astIdx >= 0 ? parseInt(stats[astIdx] ?? "0") : 0;
                      players.push({
                        playerName: athlete.athlete?.displayName ?? "",
                        pts,
                        reb,
                        ast,
                        minutes: mins,
                      });
                    }
                  }
                }
                const grade = gradePropPick(pick, players);
                if (grade) {
                  pick.result = grade.result;
                  pick.actualValue = grade.actualValue;
                  pick.gradedAt = new Date().toISOString();
                  newlyGraded.push({ ...pick, date: today, sport: "nba" });
                  propsGraded++;
                  changed = true;
                  break;
                }
              } catch {}
            }
          }
          if (changed) {
            await cloudSet(propCacheKey, {
              ...propData,
              gradedAt: new Date().toISOString(),
            });
            // Append to cumulative history (cap at 500 most recent). Dedupe by
            // playerName::propType::date so re-grading the same cache (e.g.
            // when prop-picks-today is force-regenerated) doesn't duplicate.
            if (newlyGraded.length > 0) {
              const histKey = "prop_pick_history_nba";
              const existing = (await cloudGet<any[]>(histKey, [])) ?? [];
              const seenKey = (p: any) =>
                `${(p.playerName ?? "").toLowerCase()}::${p.propType ?? p.market ?? ""}::${p.date ?? ""}`;
              const seen = new Set(existing.map(seenKey));
              const fresh = newlyGraded.filter((p) => !seen.has(seenKey(p)));
              if (fresh.length > 0) {
                const merged = [...fresh, ...existing].slice(0, 500);
                await cloudSet(histKey, merged);
              }
            }
          }
        }
      } catch (e) {
        console.error("prop grading error:", e);
      }
    }

    // ── Grade MLB prop predictions against box scores ──
    let mlbPropsGraded = 0;
    if (completedGames.length > 0) {
      try {
        const { gradeMLBPropPick, parseMLBBoxScore } =
          await import("@/lib/bot/prop-grader");
        const {
          loadMLBPropBrainFromCloud,
          saveMLBPropBrainToCloud,
          learnFromMLBResult,
        } = await import("@/lib/bot/mlb-prop-brain");
        let mlbBrain = await loadMLBPropBrainFromCloud();
        let brainUpdated = false;
        const { supabase: sb } = await import("@/lib/supabase/client");
        if (sb) {
          const today = etDateString();
          const { data: pendingMlb } = await sb
            .from("prop_predictions")
            .select("*")
            .eq("status", "pending")
            .eq("sport", "mlb")
            .lte("game_date", today)
            .limit(200);

          if (pendingMlb && pendingMlb.length > 0) {
            const newlyGradedMlb: any[] = [];
            for (const game of completedGames) {
              try {
                const bxRes = await fetch(
                  `https://statsapi.mlb.com/api/v1/game/${game.id}/boxscore`,
                  { next: { revalidate: 300 } },
                );
                if (!bxRes.ok) continue;
                const boxData = await bxRes.json();
                const players = parseMLBBoxScore(boxData);
                if (players.length === 0) continue;
                for (const pred of pendingMlb) {
                  if (pred.status !== "pending") continue;
                  const grade = gradeMLBPropPick(
                    {
                      playerName: pred.player_name,
                      market: pred.prop_type,
                      line: pred.line,
                      side: pred.predicted_side,
                    },
                    players,
                  );
                  if (!grade) continue;
                  const brierScore = Math.pow(
                    (pred.predicted_prob ?? 0.5) -
                      (grade.result === "win" ? 1 : 0),
                    2,
                  );
                  await sb
                    .from("prop_predictions")
                    .update({
                      actual_value: grade.actualValue,
                      hit: grade.result === "win",
                      // Push-safe grade (migration 008). `hit` is a plain
                      // boolean so a push would otherwise be recorded as a
                      // loss and drag down accuracy.
                      result: grade.result,
                      brier_score: Math.round(brierScore * 10000) / 10000,
                      status: "graded",
                      graded_at: new Date().toISOString(),
                    })
                    .eq("id", pred.id)
                    // In-DB guard, not just the in-memory `pred.status` flag
                    // below. That flag only dedups WITHIN one run — two
                    // overlapping cron invocations each load their own
                    // `pendingMlb` and would both grade the same row and both
                    // call learnFromMLBResult, skewing brain weights off one
                    // real outcome counted twice.
                    .eq("status", "pending");
                  pred.status = "graded"; // dedup within this run
                  newlyGradedMlb.push({
                    ...pred,
                    actualValue: grade.actualValue,
                    result: grade.result,
                    date: pred.game_date,
                    sport: "mlb",
                    playerName: pred.player_name,
                    propType: pred.prop_type,
                    line: pred.line,
                    side: pred.predicted_side,
                    odds: pred.odds_at_pick,
                  });
                  mlbPropsGraded++;

                  // Feed result into the MLB brain so it learns over time.
                  // Skip pushes — the actual landed exactly on the line, which
                  // says nothing about whether the projection leaned the right
                  // way. Training a push as `hit: false` taught it a false loss.
                  if (grade.result !== "push") {
                    try {
                      mlbBrain = learnFromMLBResult(mlbBrain, {
                        playerName: pred.player_name,
                        team: pred.team ?? "",
                        propType: pred.prop_type,
                        predictedProb: pred.predicted_prob ?? 0.5,
                        predictedSide: pred.predicted_side,
                        line: pred.line,
                        actualValue: grade.actualValue,
                        hit: grade.result === "win",
                        factors: Array.isArray(pred.factors)
                          ? pred.factors
                          : [],
                      });
                      brainUpdated = true;
                    } catch {}
                  }
                }
              } catch {}
            }
            if (newlyGradedMlb.length > 0) {
              const histKey = "prop_pick_history_mlb";
              const existing = (await cloudGet<any[]>(histKey, [])) ?? [];
              const seenKey = (p: any) =>
                `${(p.playerName ?? p.player_name ?? "").toLowerCase()}::${p.propType ?? p.prop_type ?? ""}::${p.date ?? ""}`;
              const seen = new Set(existing.map(seenKey));
              const fresh = newlyGradedMlb.filter((p) => !seen.has(seenKey(p)));
              if (fresh.length > 0) {
                const merged = [...fresh, ...existing].slice(0, 500);
                await cloudSet(histKey, merged);
              }
            }
            if (brainUpdated) {
              mlbBrain.lastTrainedAt = new Date().toISOString();
              await saveMLBPropBrainToCloud(mlbBrain);
            }
          }
        }
      } catch (e) {
        console.error("mlb prop grading error:", e);
      }
    }

    // ── Grade NRFI/YRFI predictions against MLB linescores ──
    let nrfiGraded = 0;
    if (completedGames.length > 0) {
      try {
        const { gradeNRFIPredictions } =
          await import("@/lib/bot/nrfi-pipeline");
        const result = await gradeNRFIPredictions(
          completedGames.map((g) => ({ id: g.id })),
        );
        nrfiGraded = result.graded;
        // Push to history (same dedup pattern as other MLB grading)
        if (result.newlyGraded.length > 0) {
          const histKey = "prop_pick_history_mlb";
          const existing = (await cloudGet<any[]>(histKey, [])) ?? [];
          const seenKey = (p: any) =>
            `${(p.playerName ?? "").toLowerCase()}::${p.propType ?? p.market ?? ""}::${p.date ?? ""}`;
          const seen = new Set(existing.map(seenKey));
          const fresh = result.newlyGraded.filter((p) => !seen.has(seenKey(p)));
          if (fresh.length > 0) {
            const merged = [...fresh, ...existing].slice(0, 500);
            await cloudSet(histKey, merged);
          }
        }
      } catch (e) {
        console.error("nrfi grading error:", e);
      }
    }

    // ── Clean stale pending bot picks (>7 days old) ──
    let stalePruned = { mlb: 0, nba: 0 };
    try {
      const cutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
      for (const { key, sport } of [
        { key: "smart_bot", sport: "mlb" as const },
        { key: "smart_bot_nba", sport: "nba" as const },
      ]) {
        const state = (await cloudGet(key, {
          bankroll: 5000,
          picks: [],
          dailyPnL: {},
        })) as any;
        const before = state.picks?.length ?? 0;
        if (before === 0) continue;
        // Drop picks that are pending AND older than 7 days
        state.picks = (state.picks ?? []).filter((p: any) => {
          if (p.result !== "pending") return true;
          const pickMs = new Date(p.date ?? 0).getTime();
          return pickMs > cutoffMs;
        });
        const removed = before - state.picks.length;
        if (removed > 0) {
          await cloudSet(key, state);
          stalePruned[sport] = removed;
        }
      }
    } catch (e) {
      console.error("stale prune error:", e);
    }
    // Make these visible in the response
    (botSettle as any).propsGraded = propsGraded;
    (botSettle as any).mlbGhostCommitted = mlbGhostCommitted;
    (botSettle as any).mlbPropsGraded = mlbPropsGraded;
    (botSettle as any).nrfiCommitted = nrfiCommitted;
    (botSettle as any).nrfiGraded = nrfiGraded;
    (botSettle as any).nflCommitted = nflCommitted;
    (botSettle as any).nflGraded = nflGraded;
    (botSettle as any).nhlCommitted = nhlCommitted;
    (botSettle as any).nhlGraded = nhlGraded;
    (botSettle as any).stalePruned = stalePruned;

    // ── Daily Supabase Snapshot Cleanup (3-4 UTC = 11 PM-12 AM ET) ──
    // Removes dated snapshot rows older than 5 days to keep Supabase lean.
    let snapsPruned = 0;
    if (utcHour >= 3 && utcHour <= 4) {
      try {
        const { supabase } = await import("@/lib/supabase/client");
        if (supabase) {
          const cutoff = new Date(
            Date.now() - 5 * 24 * 60 * 60 * 1000,
          ).toISOString();
          const prefixes = [
            "line_snap_",
            "props_snap_",
            "prop_picks_today_",
            "prop_results_",
            "parlay_today_",
          ];
          for (const prefix of prefixes) {
            const { data: stale } = await supabase
              .from("app_state")
              .select("key")
              .like("key", `${prefix}%`)
              .lt("updated_at", cutoff)
              .limit(100);
            if (stale && stale.length > 0) {
              const keys = stale.map((r: any) => r.key);
              await supabase.from("app_state").delete().in("key", keys);
              snapsPruned += keys.length;
            }
          }
        }
      } catch (e) {
        console.error("snap prune error:", e);
      }
    }
    (botSettle as any).snapsPruned = snapsPruned;

    // ── Daily Prop History Rehydration (4-5 UTC = 12-1 AM ET) ──
    // Rebuild prop_pick_history_{sport} from prop_predictions table so the
    // cumulative array can never get truncated/lost. Idempotent.
    let rehydrated: Record<string, number> = { nba: 0, mlb: 0, nfl: 0, nhl: 0 };
    if (utcHour >= 4 && utcHour <= 5) {
      try {
        const { supabase: sb } = await import("@/lib/supabase/client");
        if (sb) {
          const MARKET_NBA: Record<string, string> = {
            player_points: "Points",
            player_rebounds: "Rebounds",
            player_assists: "Assists",
          };
          const MARKET_MLB: Record<string, string> = {
            pitcher_strikeouts: "Strikeouts",
            pitcher_outs: "Outs",
            batter_hits: "Hits",
            batter_home_runs: "Home Runs",
            batter_total_bases: "Total Bases",
            batter_rbis: "RBIs",
            batter_runs_scored: "Runs",
            nrfi: "NRFI",
            yrfi: "YRFI",
          };
          const MARKET_NFL: Record<string, string> = {
            player_pass_yds: "Pass Yds",
            player_pass_tds: "Pass TDs",
            player_pass_attempts: "Pass Att",
            player_rush_yds: "Rush Yds",
            player_rush_attempts: "Carries",
            player_receptions: "Receptions",
            player_reception_yds: "Rec Yds",
            player_anytime_td: "Anytime TD",
          };
          const MARKET_NHL: Record<string, string> = {
            player_points: "Points",
            player_goals: "Goals",
            player_assists: "Assists",
            player_shots_on_goal: "Shots",
            player_total_saves: "Saves",
          };
          for (const sport of ["nba", "mlb", "nfl", "nhl"] as const) {
            const { data: rows } = await sb
              .from("prop_predictions")
              .select(
                "player_name, prop_type, line, predicted_side, hit, actual_value, game_date, odds_at_pick",
              )
              .eq("sport", sport)
              .eq("status", "graded")
              .order("game_date", { ascending: false })
              .limit(500);
            if (!rows || rows.length === 0) continue;
            const LABELS =
              sport === "nba"
                ? MARKET_NBA
                : sport === "mlb"
                  ? MARKET_MLB
                  : sport === "nfl"
                    ? MARKET_NFL
                    : MARKET_NHL;
            const history = rows.map((r: any) => ({
              playerName: r.player_name,
              propType: LABELS[r.prop_type] ?? r.prop_type,
              market: r.prop_type,
              line: r.line,
              side: r.predicted_side,
              result: r.hit ? "win" : "loss",
              actualValue: r.actual_value,
              date: r.game_date,
              odds: r.odds_at_pick,
              sport,
            }));
            await cloudSet(`prop_pick_history_${sport}`, history);
            rehydrated[sport] = history.length;
          }
        }
      } catch (e) {
        console.error("rehydrate error:", e);
      }
    }
    (botSettle as any).rehydrated = rehydrated;

    // ── Weekly Calibration (Sunday 2-3 UTC = Sat 10-11 PM ET) ──
    // Recompute the "predicted prob vs actual hit rate" curve.
    let calibrationSample = 0;
    const dayOfWeek = new Date().getUTCDay(); // 0 = Sunday
    if (dayOfWeek === 0 && utcHour >= 2 && utcHour <= 3) {
      try {
        const { computeCalibration, saveCalibration } =
          await import("@/lib/bot/calibration");
        const curve = await computeCalibration();
        if (curve) {
          await saveCalibration(curve);
          calibrationSample = curve.sample;
        }
      } catch (e) {
        console.error("calibration error:", e);
      }
    }

    // ── Daily Brain Training (auto-trigger when stale) ──
    // Fires once per day in the 4-5 UTC window (12-1 AM ET, after games settle).
    // Re-trains if brain has never been trained OR last training is >7 days old.
    if (forceTrain || (utcHour >= 4 && utcHour <= 5)) {
      try {
        const lastTrainKey = "nba_brain_last_trained";
        const lastTrained = await cloudGet<string | null>(lastTrainKey, null);
        const brain = await loadNbaPropBrainFromCloud();
        const neverTrained =
          !brain.isPreTrained || brain.totalGamesProcessed === 0;
        const daysSinceTrain = lastTrained
          ? (Date.now() - new Date(lastTrained).getTime()) /
            (1000 * 60 * 60 * 24)
          : 999;

        if (neverTrained || daysSinceTrain >= 7) {
          // Fire-and-forget — training takes ~5 min, cron has 120s
          const baseUrl = "https://diamond-quant-live.vercel.app"; // public alias — VERCEL_URL sits behind Vercel deployment protection and returns an HTML auth page instead of JSON
          fetch(
            `${baseUrl}/api/nba-prop-train?seasons=2022,2023,2024${neverTrained ? "&reset=true" : ""}`,
            {
              headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" },
            },
          ).catch(() => {});
          await cloudSet(lastTrainKey, new Date().toISOString());
        }
      } catch {}
    }

    // ── Weekly Brain Evolution (Sunday midnight UTC = Sunday 8PM ET) ──
    // Uses dayOfWeek from calibration block above.
    if (forceEvolve || (dayOfWeek === 0 && utcHour >= 0 && utcHour <= 2)) {
      try {
        const lastEvolvedKey = "nba_brain_last_evolved";
        const lastEvolved = await cloudGet<string | null>(lastEvolvedKey, null);
        const daysSince = lastEvolved
          ? (Date.now() - new Date(lastEvolved).getTime()) /
            (1000 * 60 * 60 * 24)
          : 999;

        if (daysSince >= 6) {
          // Trigger evolution in background (don't await — cron has time limit)
          const baseUrl = "https://diamond-quant-live.vercel.app"; // public alias — VERCEL_URL sits behind Vercel deployment protection and returns an HTML auth page instead of JSON
          fetch(`${baseUrl}/api/nba-prop-evolve?generations=2`, {
            headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" },
          }).catch(() => {});
          await cloudSet(lastEvolvedKey, new Date().toISOString());
        }
      } catch {}
    }

    // ── Odds history snapshot ──
    // Feeds the Line Movement panel. Nothing was calling this, so
    // odds_history stayed empty and the panel sat on "Collecting odds
    // data…" forever. Cheap: reuses the already-cached odds fetch.
    let oddsSnapshot: any = null;
    try {
      const snapRes = await fetch(`${selfOrigin}/api/sharp-money`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Sharp-money POST now requires the cron secret — without this
          // the auth guard I added returns 401 and no snapshot is recorded.
          "x-cron-secret": process.env.CRON_SECRET ?? "",
        },
        body: JSON.stringify({ sport: "baseball_mlb" }),
        signal: AbortSignal.timeout(25000),
      });
      oddsSnapshot = await snapRes.json();
    } catch (e) {
      oddsSnapshot = { ok: false, error: String(e) };
    }

    // ── Daily Discord board + results recap ──
    // Both are self-gating: publish-daily no-ops if today's board already
    // went out, and post-results holds until every pick on the slate is
    // graded. That's what makes them safe on a 30-minute cron.
    //
    // Looped over every sport with a real grader, not just MLB. The NBA/NFL
    // graders (lib/nba/prop-grader.ts, lib/nfl/prop-grader.ts) were built and
    // wired into post-results' GRADERS dispatch table, but nothing ever
    // called either endpoint with sport=nba/nfl — so a published NBA or NFL
    // pick had no automated path to ever get graded or recapped. Both routes
    // already self-gate on "nothing to publish"/"nothing to grade", so
    // looping is safe even on a slate with zero games for that sport.
    let discordDaily: any = { published: null, recap: null };
    const discordDailyBySport: Record<string, any> = {};
    if (process.env.BOT_API_URL) {
      const origin = selfOrigin;
      const headers = { "x-cron-secret": process.env.CRON_SECRET ?? "" };

      // ── Results recap FIRST, then today's board ──
      //
      // Order matters in Discord: whatever posts last sits at the bottom of
      // the channel, which is what readers see first. Publishing the board
      // before the recap buried today's picks under yesterday's results.
      // Recap, then publish, so the newest props are the newest message.
      //
      // Grade BOTH today's slate and yesterday's, every sport, every tick.
      // post-results defaults to previousSlate() (yesterday ET), but the ET
      // sports day doesn't roll until 4am — so a slate whose games all
      // finished by ~11pm ET would otherwise wait 5+ hours for its recap.
      // Adding today's slate lets the recap post the SAME NIGHT, as soon as
      // its last game is final. This is safe: post-results holds a batch
      // until every pick in it is graded (so an in-progress today never posts
      // early), and the atomic app_state claim means grading the same slate
      // from two ticks can't double-post.
      // Sweep TODAY plus the previous 4 slates, not just today+yesterday.
      // A pick that misses grading inside a 2-day window (transient box-score
      // fetch failure, or the findPlayer bug fixed 2026-08-17) was stranded
      // FOREVER, and a stranded pick holds its whole batch's recap — that's
      // how 4 picks blocked 3 nights of recaps on 08-13..08-15. Sweeping 5
      // days is idempotent and near-free: post-results exits per batch on the
      // already-posted marker, so a settled slate costs one app_state read.
      const et = etDateString();
      const priorSlates = [1, 2, 3, 4].map((d) => {
        const t = new Date(Date.now() - d * 24 * 3600 * 1000);
        return etDateString(t);
      });
      const recapTargets = ["mlb", "nba", "nfl"].flatMap((s) => [
        { s, slate: et }, // today — posts as soon as its games finish
        ...priorSlates.map((slate) => ({ s, slate })),
      ]);
      const recapRaw = await Promise.all(
        recapTargets.map(async ({ s, slate }) => {
          try {
            const url = slate
              ? `${origin}/api/post-results?sport=${s}&slate=${slate}`
              : `${origin}/api/post-results?sport=${s}`;
            const r = await fetch(url, {
              method: "POST",
              headers,
              signal: AbortSignal.timeout(30000),
            });
            return [s, await r.json()] as const;
          } catch (e) {
            return [s, { ok: false, error: String(e) }] as const;
          }
        }),
      );
      // Collapse the two slates per sport into one recap summary. Prefer the
      // one that actually did something (posted a recap) over one that found
      // nothing to grade, so the heartbeat reflects real activity.
      const recapBySport: Record<string, any[]> = {};
      for (const [s, recap] of recapRaw) (recapBySport[s] ??= []).push(recap);
      for (const [s, recaps] of Object.entries(recapBySport)) {
        const posted = recaps.find((r) =>
          r?.batches?.some((b: any) => b?.posted),
        );
        discordDailyBySport[s] = {
          ...discordDailyBySport[s],
          recap: posted ?? recaps[0],
        };
      }
      discordDaily.recap = discordDailyBySport.mlb?.recap ?? null;

      // Publish today's board LAST so it's the newest message in the channel
      // (see the ordering note above the recap loop). Parallel across sports
      // to keep the whole group at roughly one call's latency.
      const pubResults = await Promise.all(
        ["mlb", "nba", "nfl"].map(async (s) => {
          try {
            const r = await fetch(`${origin}/api/publish-daily?sport=${s}`, {
              method: "POST",
              headers,
              signal: AbortSignal.timeout(30000),
            });
            return [s, { published: await r.json() }] as const;
          } catch (e) {
            return [s, { published: { ok: false, error: String(e) } }] as const;
          }
        }),
      );
      // MERGE, don't overwrite — the recap loop above already populated
      // discordDailyBySport[s].recap, and a bare assignment here would
      // silently drop it now that publish runs second.
      for (const [s, v] of pubResults)
        discordDailyBySport[s] = { ...discordDailyBySport[s], ...v };
      // MLB keeps its own top-level key too — everything below this point
      // (line alerts, edge scan, lineup watch, etc.) is MLB-specific and
      // reads discordDaily directly.
      discordDaily.published = discordDailyBySport.mlb?.published ?? null;
      discordDaily.bySport = discordDailyBySport;

      // ── Off-market line alerts ──
      // Only fires when DK/FD actually disagree with the market, and only
      // once per (game, book, market, line) per day — an off-market line
      // persists across many cron runs, so without the dedupe key this would
      // re-alert on every 15-minute tick until the book corrected.
      try {
        const sm = await fetch(`${origin}/api/sharp-money?sport=baseball_mlb`, {
          signal: AbortSignal.timeout(20000),
        });
        const smData = await sm.json();
        const items: any[] = Array.isArray(smData?.outliers)
          ? smData.outliers
          : [];
        if (items.length > 0) {
          const alertKey = `line_alerts_${etDateString()}`;
          const seen = await cloudGet<string[]>(alertKey, []);
          const seenSet = new Set(seen ?? []);
          const fresh = items.filter(
            (i) =>
              !seenSet.has(
                `${i.game_id}|${i.bookmaker}|${i.market}|${i.ourLine}`,
              ),
          );
          if (fresh.length > 0) {
            const r = await fetch(`${process.env.BOT_API_URL}/alert`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                // x-bot-secret, matching the bot's auth middleware and every
                // other caller (post-results, publish-daily). This was
                // x-api-secret, which the bot rejects with 401 — the alert
                // would have silently never posted in production.
                "x-bot-secret": process.env.BOT_API_SECRET ?? "",
              },
              body: JSON.stringify({ sport: "mlb", items: fresh }),
              signal: AbortSignal.timeout(15000),
            });
            discordDaily.lineAlerts = {
              sent: r.ok,
              count: fresh.length,
            };
            // Record only after a successful post, so a failed send retries
            // next run instead of being silently marked as delivered.
            if (r.ok) {
              await cloudSet(alertKey, [
                ...seenSet,
                ...fresh.map(
                  (i) => `${i.game_id}|${i.bookmaker}|${i.market}|${i.ourLine}`,
                ),
              ]);
            }
          }
        }
      } catch (e) {
        discordDaily.lineAlerts = { ok: false, error: String(e) };
      }

      // ── Sharp-anchor edges (Pinnacle vs US books) ──
      // The highest-conviction alert we have: a US book beating Pinnacle's
      // de-vigged fair price is +EV by definition, no model involved. Costs 2
      // Odds API credits per cron tick. Threshold 2% — below that, the edge
      // is usually gone by the time anyone taps the notification. Deduped per
      // (game, side, book) per day like the line alerts above.
      try {
        // Sports to scan. MLB every tick as before. NFL added for the season
        // (2026-08-24) but ONLY on days the NFL actually has games — the scan
        // costs 2 Odds API credits per sport per tick, and burning ~192
        // credits on an empty NFL Tuesday helps nobody. Game-day detection
        // reuses the lineup gate's cached first-pitch lookup (ESPN, 1h TTL),
        // so this adds no extra upstream calls on quiet days.
        const scanSports: Array<"mlb" | "nfl"> = ["mlb"];
        try {
          const { getFirstPitchHourET } = await import("@/lib/lineup-gate");
          if ((await getFirstPitchHourET("nfl")) !== null)
            scanSports.push("nfl");
        } catch {}

        // all=1 → every game's current Pinnacle fair prob rides along, which
        // the CLV tracker below uses to snapshot closers. Anchors from every
        // scanned sport pool into one list — Odds API game ids are globally
        // unique, so the CLV matcher below can't cross-wire sports.
        const anchors: any[] = [];
        const edgeAlertStatus: Record<string, unknown> = {};
        for (const scanSport of scanSports) {
          const es = await fetch(
            `${origin}/api/edge-scan?minEv=2&all=1&sport=${scanSport}`,
            { signal: AbortSignal.timeout(20000) },
          );
          const esData = await es.json();
          const edges: any[] = Array.isArray(esData?.edges) ? esData.edges : [];
          if (Array.isArray(esData?.anchors)) anchors.push(...esData.anchors);
          if (edges.length === 0) {
            edgeAlertStatus[scanSport] = { count: 0 };
            continue;
          }
          // MLB keeps its historical key shape (continuity with the existing
          // dedupe sets); other sports get a sport-scoped key.
          const edgeKey =
            scanSport === "mlb"
              ? `edge_alerts_${etDateString()}`
              : `edge_alerts_${scanSport}_${etDateString()}`;
          const seenE = new Set((await cloudGet<string[]>(edgeKey, [])) ?? []);
          const freshE = edges.filter(
            (e) => !seenE.has(`${e.gameId}|${e.side}|${e.book}`),
          );
          if (freshE.length === 0) {
            edgeAlertStatus[scanSport] = { count: 0 };
            continue;
          }
          const r = await fetch(`${process.env.BOT_API_URL}/alert`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-bot-secret": process.env.BOT_API_SECRET ?? "",
            },
            body: JSON.stringify({
              sport: scanSport,
              // Send the RAW numbers and let the bot format them. The bot
              // owns presentation (book display names, plain-English
              // phrasing); duplicating that here meant Discord showed
              // "williamhill_us h2h" and "de-vigged fair price", which is
              // jargon to everyone who isn't us.
              items: freshE.map((e) => ({
                game_id: e.gameId,
                kind: "edge",
                bookmaker: e.book,
                market: "moneyline",
                game: e.game,
                side: e.side,
                price: e.price,
                sharpPrice: e.pinnaclePrice,
                evPct: e.evPct,
                fairProb: e.fairProb,
                commence: e.commence,
                // Kept for older bot builds that render `ourLine`/`note`.
                ourLine: `${e.side} ${e.price > 0 ? "+" : ""}${e.price}`,
                note: `+${e.evPct}% EV vs sharp price`,
              })),
            }),
            signal: AbortSignal.timeout(15000),
          });
          edgeAlertStatus[scanSport] = { sent: r.ok, count: freshE.length };
          if (r.ok) {
            await cloudSet(edgeKey, [
              ...seenE,
              ...freshE.map((e) => `${e.gameId}|${e.side}|${e.book}`),
            ]);
            // Log every SENT alert for CLV grading below. The alert price
            // is the entry price; the last Pinnacle fair before first pitch
            // is the closer. Sport-agnostic: NFL alerts get the same CLV
            // scoreboard treatment as MLB.
            const log = (await cloudGet<any[]>("edge_clv_log", [])) ?? [];
            for (const e of freshE)
              log.push({
                id: `${e.gameId}|${e.side}|${e.book}`,
                at: new Date().toISOString(),
                commence: e.commence,
                game: e.game,
                side: e.side,
                book: e.book,
                price: e.decimalPrice,
                alertEv: e.evPct,
                alertFair: e.fairProb,
              });
            await cloudSet("edge_clv_log", log.slice(-300));
          }
        }
        discordDaily.edgeAlerts = edgeAlertStatus;

        // ── CLV capture ──
        // The scoreboard that tells us within ~50 alerts whether the scanner
        // has a real edge, instead of waiting 1,000 bets for win/loss to
        // converge. For every logged alert whose game starts within the next
        // 40 minutes (i.e. this is the final scan before first pitch), record
        // Pinnacle's CURRENT fair prob as the closer and re-price the alert:
        //   closeEv = closingFair × alertPrice − 1
        // closeEv > 0 = we beat the close = the alert was real. A game that
        // already started with no capture is marked missed, not dropped —
        // silently losing the failures would bias the scoreboard upward.
        try {
          const log = (await cloudGet<any[]>("edge_clv_log", [])) ?? [];
          const now = Date.now();
          let dirty = false;
          const anchorById = new Map(anchors.map((a: any) => [a.gameId, a]));
          for (const entry of log) {
            if (entry.close || entry.missed) continue;
            const start = Date.parse(entry.commence);
            if (!Number.isFinite(start)) continue;
            if (start - now > 40 * 60 * 1000) continue; // not closing yet
            const anchor = anchorById.get(entry.id.split("|")[0]);
            const fair = anchor?.fair?.[entry.side];
            if (typeof fair === "number") {
              entry.close = {
                fair,
                ev:
                  Math.round((fair / 100) * entry.price * 10000 - 10000) / 100,
                at: new Date().toISOString(),
              };
              dirty = true;
            } else if (now > start) {
              entry.missed = true; // started before we caught a closer
              dirty = true;
            }
          }
          if (dirty) await cloudSet("edge_clv_log", log);
        } catch {
          // CLV is bookkeeping — never let it break the alert path.
        }
      } catch (e) {
        discordDaily.edgeAlerts = { ok: false, error: String(e) };
      }

      // ── Star-sitting lineup alerts ──
      // Confirmed lineups drop 2-4h before first pitch; a top-of-the-order
      // regular missing is the news soft books lag on. Deduped per
      // (game, player) per day — a sitting star stays sat all afternoon.
      try {
        const lw = await fetch(`${origin}/api/lineup-watch`, {
          signal: AbortSignal.timeout(30000),
        });
        const lwData = await lw.json();
        const sits: any[] = Array.isArray(lwData?.alerts) ? lwData.alerts : [];
        if (sits.length > 0) {
          const sitKey = `lineup_alerts_${etDateString()}`;
          const seenS = new Set((await cloudGet<string[]>(sitKey, [])) ?? []);
          const freshS = sits.filter(
            (s) => !seenS.has(`${s.gamePk}|${s.playerId}`),
          );
          if (freshS.length > 0) {
            const r = await fetch(`${process.env.BOT_API_URL}/alert`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-bot-secret": process.env.BOT_API_SECRET ?? "",
              },
              body: JSON.stringify({
                sport: "mlb",
                items: freshS.map((s) => ({
                  game_id: String(s.gamePk),
                  kind: "lineup",
                  game: s.game,
                  player: s.player,
                  team: s.team,
                  usualSlot: s.usualSlot,
                  commence: s.commence,
                  // Kept for older bot builds.
                  ourLine: `${s.player} SITTING`,
                  note: s.note,
                })),
              }),
              signal: AbortSignal.timeout(15000),
            });
            discordDaily.lineupAlerts = { sent: r.ok, count: freshS.length };
            if (r.ok) {
              await cloudSet(sitKey, [
                ...seenS,
                ...freshS.map((s) => `${s.gamePk}|${s.playerId}`),
              ]);
            }
          }
        }
      } catch (e) {
        discordDaily.lineupAlerts = { ok: false, error: String(e) };
      }

      // ── Props CLV capture ──
      // Mirrors the moneyline CLV block above. For every logged pick whose
      // game starts within the next 40 minutes, fetch that market fresh and
      // record the CURRENT consensus fair prob as the closer. Missed (game
      // already started, never captured) is recorded rather than dropped —
      // silently excluding failures would flatter the average.
      try {
        const log = (await cloudGet<any[]>("props_clv_log", [])) ?? [];
        const now = Date.now();

        // Age out entries that can never resolve. The closer is found by
        // re-fetching the entry's market and matching player+line; once that
        // prop stops being offered (game played, line pulled) no future tick
        // can ever match it. Without this cutoff those entries stayed open
        // forever and every tick re-fetched their whole market on their
        // behalf — pure wasted Odds API credits, growing without bound.
        // 36h comfortably covers same-day close capture plus any cron gap.
        const MAX_OPEN_MS = 36 * 60 * 60 * 1000;
        let agedOut = 0;
        for (const e of log) {
          if (e.close || e.missed) continue;
          const posted = e.postedAt ? Date.parse(e.postedAt) : NaN;
          if (Number.isFinite(posted) && now - posted > MAX_OPEN_MS) {
            e.missed = true;
            agedOut++;
          }
        }

        const dueSoon = log.filter((e) => !e.close && !e.missed);
        let dirty = agedOut > 0;

        if (dueSoon.length > 0) {
          const marketsNeeded = [
            ...new Set(dueSoon.map((e) => e.market as string)),
          ];
          const freshByMarket = new Map<string, any[]>();
          for (const m of marketsNeeded) {
            const r = await fetch(
              `${origin}/api/players?sport=baseball_mlb&market=${m}`,
              { signal: AbortSignal.timeout(20000) },
            );
            const d = await r.json().catch(() => null);
            freshByMarket.set(m, Array.isArray(d?.props) ? d.props : []);
          }

          for (const entry of log) {
            if (entry.close || entry.missed) continue;
            const props = freshByMarket.get(entry.market) ?? [];
            const match = props.find(
              (p: any) =>
                String(p.playerName).toLowerCase() ===
                  String(entry.playerName).toLowerCase() &&
                Number(p.line) === Number(entry.line),
            );
            if (!match) continue; // not found this pass — try again next tick
            const start = match.gameTime ? Date.parse(match.gameTime) : NaN;
            const closeFair =
              entry.side === "over" ? match.fairOverProb : match.fairUnderProb;
            if (Number.isFinite(start) && start - now <= 40 * 60 * 1000) {
              if (typeof closeFair === "number") {
                entry.closeFairProb = closeFair;
                entry.close = { at: new Date().toISOString() };
                dirty = true;
              } else if (now > start) {
                entry.missed = true;
                dirty = true;
              }
            } else if (Number.isFinite(start) && now > start) {
              entry.missed = true; // game started, never caught a closer
              dirty = true;
            }
          }
        }

        // Outside the dueSoon branch: age-outs must persist even on a tick
        // where nothing was due, or they'd be recomputed forever. slice(-500)
        // mirrors the writer in pinned-props — without it this path could
        // grow the blob back past the cap the writer enforces.
        if (dirty) await cloudSet("props_clv_log", log.slice(-500));
      } catch (e) {
        discordDaily.propsClv = { ok: false, error: String(e) };
      }
    }

    // ── Stuck-prediction void sweep ──
    //
    // Every sport's prop_predictions grading loop above only resolves a
    // 'pending' row by matching it against THAT DAY's live "completed games"
    // fetch. A game that never reappears there — postponed, rained out, or
    // simply a day the grading loop didn't run for that sport — leaves its
    // predictions 'pending' forever, with nothing that will ever revisit
    // them. scripts/audit-stuck-picks.mts found 1,069 rows exactly like this
    // (MLB/NFL/NHL back to June; NBA had zero, confirming its ESPN-CDN path
    // doesn't have this gap).
    //
    // Rather than rework each sport's dense per-block grading logic (risky
    // this close to already-shipped changes), this is a separate, narrow
    // safety net: anything still 'pending' after STALE_DAYS is voided —
    // excluded from accuracy/brier stats, same treatment a sportsbook gives
    // a cancelled game — rather than silently rotting as fake "still open"
    // data forever.
    //
    // manual_picks is DELIBERATELY EXCLUDED from this sweep. Voiding a
    // published pick destroys a real result: the first run of this sweep
    // voided four 2026-07-30 picks (+2.22u of genuine WINS) whose only
    // problem was that cron had never called post-results for them — the
    // games were long final and perfectly gradeable. manual_picks IS the
    // published record, so a wrong void there is worse than a row left
    // pending. post-results now runs for every sport on every tick and will
    // grade those legitimately; anything it genuinely can't resolve is
    // caught by scripts/audit-stuck-picks.mts for a human to look at.
    //
    // The remaining two sweeps are guarded on OUTCOME, not just age. An
    // earlier version of this comment claimed prop_predictions was "internal
    // brain-learning data where a stale row is just noise" — that was wrong:
    // lib/bot/track-record.ts folds graded prop_predictions rows into the
    // PUBLIC win/loss/profit totals on /results. So a row that already has a
    // determined `result` must never be overwritten with a void, even if its
    // `status` somehow lagged. Same for bot_picks: `push` is unrecoverable
    // there (the .eq("result","pending") guard means it can never be
    // re-graded), so it may only apply to rows with no outcome at all.
    try {
      const STALE_DAYS = 3;
      const staleCutoff = new Date(Date.now() - STALE_DAYS * 86400_000)
        .toISOString()
        .slice(0, 10);
      const { supabase: sbVoid } = await import("@/lib/supabase/client");
      if (sbVoid) {
        const [propsVoid, botVoid] = await Promise.all([
          sbVoid
            .from("prop_predictions")
            .update({ status: "void", graded_at: new Date().toISOString() })
            .eq("status", "pending")
            // Never stamp a void over a row that already has an outcome —
            // these feed the public record via track-record.ts.
            .is("result", null)
            .is("hit", null)
            .lt("game_date", staleCutoff)
            .select("id"),
          sbVoid
            .from("bot_picks")
            .update({ result: "push", settled_at: new Date().toISOString() })
            .eq("result", "pending")
            // A settled score means it was gradeable — leave it for the
            // settle path rather than laundering a real win into a 0u push.
            .is("final_score", null)
            .lt("slate_date", staleCutoff)
            .select("id"),
        ]);
        const voided = {
          propPredictions: propsVoid.data?.length ?? 0,
          // bot_picks' CHECK constraint doesn't allow 'void' — 'push' is the
          // closest neutral result (0 stake impact) it accepts.
          botPicks: botVoid.data?.length ?? 0,
        };
        if (voided.propPredictions + voided.botPicks > 0) {
          discordDaily.staleVoidSweep = voided;
        }
      }
    } catch (e) {
      discordDaily.staleVoidSweep = { ok: false, error: String(e) };
    }

    // ── Heartbeat ──
    // Last thing before returning, so it only records a run that got all the
    // way through. On 2026-08-04 the cron stopped for ~24h because Vercel
    // suspends scheduled functions on an overdue account — the site kept
    // serving, every endpoint worked when called by hand, and the only symptom
    // was a Discord post that never arrived. Nothing surfaced it. This does.
    try {
      await cloudSet("cron_heartbeat", {
        at: new Date().toISOString(),
        // `!!discordDaily.published` was true for ANY response, including
        // {ok:false} — so the heartbeat reported publishedToday:true on
        // 2026-08-05 while nothing reached Discord at all. Report the two
        // states that actually differ: did it post, or was it already done.
        publishedToday:
          discordDaily.published?.props?.posted === true ||
          discordDaily.published?.parlay?.posted === true ||
          discordDaily.published?.alreadyPublished === true,
        publishDetail: discordDaily.published ?? null,
      });
    } catch {}

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      mlb: {
        total: games.length,
        live,
        final,
        pre,
        completedToday: completedGames.length,
      },
      nbaProps: { ...nbaAudit, ghostCommitted: nbaGhostCommitted },
      trackRecord: { settled: trackSettled, voided: trackVoided },
      userBets: userBetsSettled,
      botSettle,
      pickGen,
      discordDaily,
      oddsSnapshot,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }
}
