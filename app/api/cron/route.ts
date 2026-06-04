import { NextResponse } from "next/server";
import { fetchTodayGames, getGameStatus, getTeamAbbrev } from "@/lib/mlb/stats-api";
import { loadNbaPropBrainFromCloud, saveNbaPropBrainToCloud } from "@/lib/bot/nba-prop-brain";
import { auditCompletedGames } from "@/lib/bot/nba-prop-audit";
import { commitPropProjections } from "@/lib/bot/nba-prop-ghost";
import { buildAndSendRecap } from "@/lib/bot/daily-recap";
import { sendDailyRecapToAll } from "@/lib/email/daily-recap";
import { generateSmartPicks } from "@/lib/bot/smart-picks";
import { cloudGet, cloudSet } from "@/lib/supabase/client";
import { logDailyPicks, settlePendingPicks, etDateString, type LoggedPick } from "@/lib/bot/track-record";

// This endpoint is called by Vercel Cron every 30 min
// It checks for finished games and logs results
// The actual Brain learning happens client-side when users open the app
// This just ensures we have fresh score data cached

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  // Verify cron secret (optional security)
  const authHeader = req.headers.get("authorization");
  const url = new URL(req.url);
  const forceTrain = url.searchParams.get("forceTrain") === "true";
  const forceEvolve = url.searchParams.get("forceEvolve") === "true";

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

    // ── NBA Prop Brain: Post-Game Audit ──
    let nbaAudit = { graded: 0, hits: 0, misses: 0 };
    let nbaGhostCommitted = 0;
    try {
      const nbaBrain = await loadNbaPropBrainFromCloud();

      // 1. Audit completed games
      const { updatedBrain, graded, hits, misses } = await auditCompletedGames(nbaBrain);
      if (graded > 0) {
        await saveNbaPropBrainToCloud(updatedBrain);
        nbaAudit = { graded, hits, misses };
      }

      // 2. Commit ghost prop projections for upcoming NBA games (all 3 markets)
      try {
        const baseUrl = `https://diamond-quant-live.vercel.app`;
        const allProps: any[] = [];
        for (const market of ["player_points", "player_rebounds", "player_assists"]) {
          try {
            const oddsRes = await fetch(`${baseUrl}/api/players?sport=basketball_nba&market=${market}`);
            if (oddsRes.ok) {
              const oddsData = await oddsRes.json();
              for (const p of (oddsData.props ?? [])) {
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
          const { committed } = await commitPropProjections(brain, allProps, {});
          nbaGhostCommitted = committed;
        }
      } catch {}
    } catch {}

    // ── Commit MLB prop projections (sport=mlb, simple seasonAvg projector) ──
    let mlbGhostCommitted = 0;
    try {
      const baseUrl = `https://diamond-quant-live.vercel.app`;
      const today = new Date().toISOString().split("T")[0];
      const allMlbProps: any[] = [];
      const { MLB_MARKETS, commitMLBPropProjections } = await import("@/lib/bot/mlb-prop-pipeline");
      for (const market of MLB_MARKETS) {
        try {
          const res = await fetch(`${baseUrl}/api/players?sport=baseball_mlb&market=${market}`, { signal: AbortSignal.timeout(10000) });
          if (!res.ok) continue;
          const data = await res.json();
          for (const p of (data.props ?? [])) {
            allMlbProps.push({
              playerName: p.playerName, team: p.team ?? "", gameId: p.gameTime ?? "",
              market, line: p.line,
              bestOverOdds: p.bestOver?.price ?? -110,
              bestUnderOdds: p.bestUnder?.price ?? -110,
            });
          }
        } catch {}
      }
      if (allMlbProps.length > 0) {
        const { committed } = await commitMLBPropProjections(allMlbProps, today);
        mlbGhostCommitted = committed;
      }
    } catch (e) { console.error("mlb prop commit error:", e); }

    // ── Commit NRFI/YRFI predictions (MLB) ──
    let nrfiCommitted = 0;
    try {
      const today = new Date().toISOString().split("T")[0];
      const { commitNRFIProjections } = await import("@/lib/bot/nrfi-pipeline");
      const result = await commitNRFIProjections(games, today);
      nrfiCommitted = result.committed;
    } catch (e) { console.error("nrfi commit error:", e); }

    // ── Track Record: settle yesterday's logged picks ──
    let trackSettled = 0;
    const settleGames = completedGames.map(g => ({
      homeTeam: g.homeTeam ?? "", awayTeam: g.awayTeam ?? "",
      homeAbbrev: g.homeAbbrev ?? "", awayAbbrev: g.awayAbbrev ?? "",
      homeScore: g.homeScore ?? 0, awayScore: g.awayScore ?? 0,
    }));
    try {
      const { settled } = await settlePendingPicks(settleGames);
      trackSettled = settled;
    } catch (e) { console.error("track settle error:", e); }

    // ── User Bets: auto-settle every user's pending bets ──
    // Runs whenever there are completed games + gated by env flag for safety
    let userBetsSettled = { users: 0, bets: 0 };
    if (process.env.BET_AUTOSETTLE_ENABLED === "1" && completedGames.length > 0) {
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
            const pending = bets.filter(b => b.result === "pending");
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
            const br: any = bankrollRow?.value ?? { bankroll: 5000, startingBankroll: 5000 };
            const starting = Number(br.startingBankroll ?? br.bankroll ?? 5000);
            const wins = bets.filter(b => b.result === "win").length;
            const losses = bets.filter(b => b.result === "loss").length;
            const pushes = bets.filter(b => b.result === "push").length;
            const totalStaked = bets.reduce((s, b) => s + (Number(b.stake) || 0), 0);
            const totalReturns = bets.reduce((s, b) => s + (Number(b.payout) || 0), 0);
            const currentBankroll = starting + totalReturns - totalStaked;
            const newBankroll = {
              ...br,
              startingBankroll: starting,
              currentBankroll: Math.round(currentBankroll * 100) / 100,
              totalBets: bets.length,
              totalStaked: Math.round(totalStaked * 100) / 100,
              totalReturns: Math.round(totalReturns * 100) / 100,
              wins, losses, pushes,
              roi: totalStaked > 0 ? Math.round(((currentBankroll - starting) / totalStaked) * 10000) / 100 : 0,
            };

            await supabaseAdmin.from("user_state").upsert({
              user_id: row.user_id, key: "betHistory", value: bets,
            });
            await supabaseAdmin.from("user_state").upsert({
              user_id: row.user_id, key: "bankroll", value: newBankroll,
            });

            userBetsSettled.users++;
            userBetsSettled.bets += changed;
          }
        }
      } catch (e) { console.error("user bet settle error:", e); }
    }

    // ── Auto-generate today's smart picks for all users ──
    // Runs in the morning hours (7-11 AM ET = 11-15 UTC) so picks are ready for the day
    const utcHour = new Date().getUTCHours();
    if (utcHour >= 11 && utcHour <= 15) {
      try {
        const today = new Date().toISOString().split("T")[0];

        // MLB picks
        const mlbTodayKey = `smart_bot_today_mlb_${today}`;
        const existingMlb = await cloudGet(mlbTodayKey, null);
        if (!existingMlb) {
          const baseUrl = `https://${process.env.VERCEL_URL || "diamond-quant-live.vercel.app"}`;
          const mlbRes = await fetch(`${baseUrl}/api/bot-analysis`);
          if (mlbRes.ok) {
            const mlbData = await mlbRes.json();
            const mlbPicks = generateSmartPicks(mlbData.analyses ?? [], 5000);
            if (mlbPicks.length > 0) {
              await cloudSet(mlbTodayKey, { picks: mlbPicks, generatedAt: new Date().toISOString() });
              // Also update the persistent smart bot state
              const botState = await cloudGet("smart_bot", { bankroll: 5000, picks: [], dailyPnL: {} }) as any;
              const existingToday = (botState.picks ?? []).filter((p: any) => p.date === today);
              if (existingToday.length === 0) {
                await cloudSet("smart_bot", { ...botState, picks: [...(botState.picks ?? []), ...mlbPicks] });
              }

              // ── Log to public track record ──
              const etDate = etDateString();
              const logged: LoggedPick[] = mlbPicks.slice(0, 5).map((p: any, idx: number) => ({
                sport: "mlb" as const, pickDate: etDate,
                category: idx === 0 ? "lock" : p.odds > 150 ? "longshot" : "lock",
                pickText: p.pick, game: p.game, market: p.market,
                odds: p.odds, bookmaker: p.bookmaker,
                evPercentage: p.evPercentage, fairProb: p.fairProb, confidence: p.confidence,
              }));
              await logDailyPicks(logged);

              // Fire a push to subscribed users for the sharpest pick
              try {
                const top: any = mlbPicks[0];
                const ev = Number(top?.evPercentage ?? logged[0]?.evPercentage ?? 0);
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
          }
        }

        // NBA picks
        const nbaTodayKey = `smart_bot_today_nba_${today}`;
        const existingNba = await cloudGet(nbaTodayKey, null);
        if (!existingNba) {
          const baseUrl = `https://${process.env.VERCEL_URL || "diamond-quant-live.vercel.app"}`;
          const nbaRes = await fetch(`${baseUrl}/api/nba-analysis`);
          if (nbaRes.ok) {
            const nbaData = await nbaRes.json();
            const nbaPicks = generateSmartPicks(nbaData.analyses ?? [], 5000);
            if (nbaPicks.length > 0) {
              await cloudSet(nbaTodayKey, { picks: nbaPicks, generatedAt: new Date().toISOString() });
              const nbaBotState = await cloudGet("smart_bot_nba", { bankroll: 5000, picks: [], dailyPnL: {} }) as any;
              const existingNbaToday = (nbaBotState.picks ?? []).filter((p: any) => p.date === today);
              if (existingNbaToday.length === 0) {
                await cloudSet("smart_bot_nba", { ...nbaBotState, picks: [...(nbaBotState.picks ?? []), ...nbaPicks] });
              }

              // ── Log to public track record ──
              const etDate = etDateString();
              const logged: LoggedPick[] = nbaPicks.slice(0, 5).map((p: any, idx: number) => ({
                sport: "nba" as const, pickDate: etDate,
                category: idx === 0 ? "lock" : p.odds > 150 ? "longshot" : "lock",
                pickText: p.pick, game: p.game, market: p.market,
                odds: p.odds, bookmaker: p.bookmaker,
                evPercentage: p.evPercentage, fairProb: p.fairProb, confidence: p.confidence,
              }));
              await logDailyPicks(logged);

              try {
                const top: any = nbaPicks[0];
                const ev = Number(top?.evPercentage ?? logged[0]?.evPercentage ?? 0);
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
          }
        }
        // ── High-confidence picks push (sent once per day, all sports combined) ──
        try {
          const pushSentKey = `push_sent_today_${today}`;
          const alreadySent = await cloudGet(pushSentKey, null);
          if (!alreadySent) {
            // Collect all picks generated this run from cache
            const mlbCache = await cloudGet(mlbTodayKey, null) as any;
            const nbaCache = await cloudGet(nbaTodayKey, null) as any;
            const allPicks: any[] = [
              ...(mlbCache?.picks ?? []),
              ...(nbaCache?.picks ?? []),
            ];
            const highConf = allPicks.filter((p: any) => p.confidence === "HIGH");
            if (highConf.length >= 3) {
              const sports = [...new Set(highConf.map((p: any) => p.sport ?? "").filter(Boolean))];
              const sportLabel = sports.length > 0 ? sports.join("/").toUpperCase() : "MLB/NBA";
              const { sendPushToAll } = await import("@/lib/push/send");
              await sendPushToAll({
                title: `🔥 ${highConf.length} high-confidence picks today — ${sportLabel}`,
                body: `Diamond Quant has locked in ${highConf.length} HIGH confidence plays for today.`,
                url: "/",
                tag: `high-conf-${today}`,
              });
              await cloudSet(pushSentKey, { sentAt: new Date().toISOString(), count: highConf.length });
            }
          }
        } catch {}
      } catch (e) { console.error("pick gen/log error:", e); }
    }

    // ── Daily Discord Recap (send once when games are finishing) ──
    const hour = new Date().getUTCHours(); // UTC
    if (final > 0 && (hour >= 3 && hour <= 7)) { // ~11PM-3AM ET = games finishing
      try {
        // Check user preferences for Discord webhooks
        const { supabase: sb } = await import("@/lib/supabase/client");
        if (sb) {
          const { data: prefs } = await sb
            .from("user_preferences")
            .select("discord_webhook")
            .neq("discord_webhook", "")
            .limit(500);
          // Parallelize webhook sends so cron doesn't serialize O(n) network calls
          await Promise.all(
            (prefs ?? []).flatMap((pref: any) =>
              pref.discord_webhook
                ? [
                    buildAndSendRecap(pref.discord_webhook, "mlb").catch(() => {}),
                    buildAndSendRecap(pref.discord_webhook, "nba").catch(() => {}),
                  ]
                : [],
            ),
          );
        }
      } catch (e) {
        console.error("Discord recap error:", e instanceof Error ? e.message : e);
      }
    }

    // ── Daily Email Recap (8am ET = 12-13 UTC) ──
    // No-op when RESEND_API_KEY is not configured.
    let emailRecap = { sent: 0, skipped: 0 };
    if (utcHour >= 12 && utcHour <= 13) {
      try {
        const baseUrl = `https://${process.env.VERCEL_URL || "diamond-quant-live.vercel.app"}`;
        emailRecap = await sendDailyRecapToAll(baseUrl);
      } catch (e) { console.error("email recap error:", e); }
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
        const nbaState = await cloudGet("smart_bot_nba", { picks: [] }) as any;
        for (const p of (nbaState.picks ?? [])) {
          if (p.result !== "pending" || !p.date) continue;
          dateSet.add(p.date.replace(/-/g, "")); // YYYY-MM-DD → YYYYMMDD
        }
      } catch {}
      for (const d of Array.from(dateSet)) {
        const sbRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${d}`, { next: { revalidate: 60 } });
        if (!sbRes.ok) continue;
        const sb = await sbRes.json();
        for (const ev of sb.events ?? []) {
          const comp = ev.competitions?.[0];
          if (comp?.status?.type?.name !== "STATUS_FINAL") continue;
          const home = comp.competitors?.find((c: any) => c.homeAway === "home");
          const away = comp.competitors?.find((c: any) => c.homeAway === "away");
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
    } catch (e) { console.error("nba scoreboard error:", e); }

    // ── MLB + NBA Bot Settlement ──
    const botSettle = { mlb: 0, nba: 0, nbaFeed: nbaCompletedGames.length, mlbFeed: completedGames.length };
    try {
      const { settleAndLearn } = await import("@/lib/bot/smart-picks");

      for (const { key, sport, feed } of [
        { key: "smart_bot", sport: "mlb", feed: completedGames },
        { key: "smart_bot_nba", sport: "nba", feed: nbaCompletedGames },
      ]) {
        if (feed.length === 0) continue;
        const state = await cloudGet(key, { bankroll: 5000, picks: [], dailyPnL: {} }) as any;
        const pending = (state.picks ?? []).filter((p: any) => p.result === "pending");
        if (pending.length === 0) continue;
        const { botState: settled } = settleAndLearn(state, feed, sport);
        const newlySettled = settled.picks.filter(
          (p: any, i: number) => state.picks[i]?.result === "pending" && p.result !== "pending",
        ).length;
        if (newlySettled > 0) {
          await cloudSet(key, settled);
          if (sport === "mlb") botSettle.mlb = newlySettled;
          else botSettle.nba = newlySettled;
        }
      }
    } catch (e) { console.error("bot settle error:", e); }

    // ── Grade today's NBA prop picks against box scores ──
    let propsGraded = 0;
    if (nbaCompletedGames.length > 0) {
      try {
        const { gradePropPick } = await import("@/lib/bot/prop-grader");
        const today = new Date().toISOString().split("T")[0];
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
                const players: Array<{ playerName: string; pts: number; reb: number; ast: number; minutes: number }> = [];
                for (const team of boxData.boxscore?.players ?? []) {
                  for (const stat of team.statistics ?? []) {
                    const labels: string[] = stat.labels ?? [];
                    const minIdx = labels.indexOf("MIN");
                    const ptsIdx = labels.indexOf("PTS");
                    const rebIdx = labels.indexOf("REB");
                    const astIdx = labels.indexOf("AST");
                    for (const athlete of stat.athletes ?? []) {
                      const stats: string[] = athlete.stats ?? [];
                      const mins = minIdx >= 0 ? parseInt(stats[minIdx] ?? "0") : 0;
                      const pts = ptsIdx >= 0 ? parseInt(stats[ptsIdx] ?? "0") : 0;
                      const reb = rebIdx >= 0 ? parseInt(stats[rebIdx] ?? "0") : 0;
                      const ast = astIdx >= 0 ? parseInt(stats[astIdx] ?? "0") : 0;
                      players.push({ playerName: athlete.athlete?.displayName ?? "", pts, reb, ast, minutes: mins });
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
            await cloudSet(propCacheKey, { ...propData, gradedAt: new Date().toISOString() });
            // Append to cumulative history (cap at 500 most recent). Dedupe by
            // playerName::propType::date so re-grading the same cache (e.g.
            // when prop-picks-today is force-regenerated) doesn't duplicate.
            if (newlyGraded.length > 0) {
              const histKey = "prop_pick_history_nba";
              const existing = (await cloudGet<any[]>(histKey, [])) ?? [];
              const seenKey = (p: any) => `${(p.playerName ?? "").toLowerCase()}::${p.propType ?? p.market ?? ""}::${p.date ?? ""}`;
              const seen = new Set(existing.map(seenKey));
              const fresh = newlyGraded.filter((p) => !seen.has(seenKey(p)));
              if (fresh.length > 0) {
                const merged = [...fresh, ...existing].slice(0, 500);
                await cloudSet(histKey, merged);
              }
            }
          }
        }
      } catch (e) { console.error("prop grading error:", e); }
    }

    // ── Grade MLB prop predictions against box scores ──
    let mlbPropsGraded = 0;
    if (completedGames.length > 0) {
      try {
        const { gradeMLBPropPick, parseMLBBoxScore } = await import("@/lib/bot/prop-grader");
        const { loadMLBPropBrainFromCloud, saveMLBPropBrainToCloud, learnFromMLBResult } = await import("@/lib/bot/mlb-prop-brain");
        let mlbBrain = await loadMLBPropBrainFromCloud();
        let brainUpdated = false;
        const { supabase: sb } = await import("@/lib/supabase/client");
        if (sb) {
          const today = new Date().toISOString().split("T")[0];
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
                const bxRes = await fetch(`https://statsapi.mlb.com/api/v1/game/${game.id}/boxscore`, { next: { revalidate: 300 } });
                if (!bxRes.ok) continue;
                const boxData = await bxRes.json();
                const players = parseMLBBoxScore(boxData);
                if (players.length === 0) continue;
                for (const pred of pendingMlb) {
                  if (pred.status !== "pending") continue;
                  const grade = gradeMLBPropPick({
                    playerName: pred.player_name,
                    market: pred.prop_type,
                    line: pred.line,
                    side: pred.predicted_side,
                  }, players);
                  if (!grade) continue;
                  const brierScore = Math.pow((pred.predicted_prob ?? 0.5) - (grade.result === "win" ? 1 : 0), 2);
                  await sb.from("prop_predictions").update({
                    actual_value: grade.actualValue,
                    hit: grade.result === "win",
                    brier_score: Math.round(brierScore * 10000) / 10000,
                    status: "graded",
                    graded_at: new Date().toISOString(),
                  }).eq("id", pred.id);
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

                  // Feed result into the MLB brain so it learns over time
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
                      factors: Array.isArray(pred.factors) ? pred.factors : [],
                    });
                    brainUpdated = true;
                  } catch {}
                }
              } catch {}
            }
            if (newlyGradedMlb.length > 0) {
              const histKey = "prop_pick_history_mlb";
              const existing = (await cloudGet<any[]>(histKey, [])) ?? [];
              const seenKey = (p: any) => `${(p.playerName ?? p.player_name ?? "").toLowerCase()}::${p.propType ?? p.prop_type ?? ""}::${p.date ?? ""}`;
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
      } catch (e) { console.error("mlb prop grading error:", e); }
    }

    // ── Grade NRFI/YRFI predictions against MLB linescores ──
    let nrfiGraded = 0;
    if (completedGames.length > 0) {
      try {
        const { gradeNRFIPredictions } = await import("@/lib/bot/nrfi-pipeline");
        const result = await gradeNRFIPredictions(completedGames.map(g => ({ id: g.id })));
        nrfiGraded = result.graded;
        // Push to history (same dedup pattern as other MLB grading)
        if (result.newlyGraded.length > 0) {
          const histKey = "prop_pick_history_mlb";
          const existing = (await cloudGet<any[]>(histKey, [])) ?? [];
          const seenKey = (p: any) => `${(p.playerName ?? "").toLowerCase()}::${p.propType ?? p.market ?? ""}::${p.date ?? ""}`;
          const seen = new Set(existing.map(seenKey));
          const fresh = result.newlyGraded.filter((p) => !seen.has(seenKey(p)));
          if (fresh.length > 0) {
            const merged = [...fresh, ...existing].slice(0, 500);
            await cloudSet(histKey, merged);
          }
        }
      } catch (e) { console.error("nrfi grading error:", e); }
    }

    // ── Clean stale pending bot picks (>7 days old) ──
    let stalePruned = { mlb: 0, nba: 0 };
    try {
      const cutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
      for (const { key, sport } of [
        { key: "smart_bot", sport: "mlb" as const },
        { key: "smart_bot_nba", sport: "nba" as const },
      ]) {
        const state = await cloudGet(key, { bankroll: 5000, picks: [], dailyPnL: {} }) as any;
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
    } catch (e) { console.error("stale prune error:", e); }
    // Make these visible in the response
    (botSettle as any).propsGraded = propsGraded;
    (botSettle as any).mlbGhostCommitted = mlbGhostCommitted;
    (botSettle as any).mlbPropsGraded = mlbPropsGraded;
    (botSettle as any).nrfiCommitted = nrfiCommitted;
    (botSettle as any).nrfiGraded = nrfiGraded;
    (botSettle as any).stalePruned = stalePruned;

    // ── Daily Supabase Snapshot Cleanup (3-4 UTC = 11 PM-12 AM ET) ──
    // Removes dated snapshot rows older than 5 days to keep Supabase lean.
    let snapsPruned = 0;
    if (utcHour >= 3 && utcHour <= 4) {
      try {
        const { supabase } = await import("@/lib/supabase/client");
        if (supabase) {
          const cutoff = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
          const prefixes = ["line_snap_", "props_snap_", "prop_picks_today_", "prop_results_", "parlay_today_"];
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
      } catch (e) { console.error("snap prune error:", e); }
    }
    (botSettle as any).snapsPruned = snapsPruned;

    // ── Daily Prop History Rehydration (4-5 UTC = 12-1 AM ET) ──
    // Rebuild prop_pick_history_{sport} from prop_predictions table so the
    // cumulative array can never get truncated/lost. Idempotent.
    let rehydrated = { nba: 0, mlb: 0 };
    if (utcHour >= 4 && utcHour <= 5) {
      try {
        const { supabase: sb } = await import("@/lib/supabase/client");
        if (sb) {
          const MARKET_NBA: Record<string, string> = {
            player_points: "Points", player_rebounds: "Rebounds", player_assists: "Assists",
          };
          const MARKET_MLB: Record<string, string> = {
            pitcher_strikeouts: "Strikeouts", pitcher_outs: "Outs",
            batter_hits: "Hits", batter_home_runs: "Home Runs",
            batter_total_bases: "Total Bases", batter_rbis: "RBIs", batter_runs_scored: "Runs",
          };
          for (const sport of ["nba", "mlb"] as const) {
            const { data: rows } = await sb
              .from("prop_predictions")
              .select("player_name, prop_type, line, predicted_side, hit, actual_value, game_date, odds_at_pick")
              .eq("sport", sport)
              .eq("status", "graded")
              .order("game_date", { ascending: false })
              .limit(500);
            if (!rows || rows.length === 0) continue;
            const LABELS = sport === "nba" ? MARKET_NBA : MARKET_MLB;
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
      } catch (e) { console.error("rehydrate error:", e); }
    }
    (botSettle as any).rehydrated = rehydrated;

    // ── Weekly Calibration (Sunday 2-3 UTC = Sat 10-11 PM ET) ──
    // Recompute the "predicted prob vs actual hit rate" curve.
    let calibrationSample = 0;
    const dayOfWeek = new Date().getUTCDay(); // 0 = Sunday
    if (dayOfWeek === 0 && utcHour >= 2 && utcHour <= 3) {
      try {
        const { computeCalibration, saveCalibration } = await import("@/lib/bot/calibration");
        const curve = await computeCalibration();
        if (curve) {
          await saveCalibration(curve);
          calibrationSample = curve.sample;
        }
      } catch (e) { console.error("calibration error:", e); }
    }

    // ── Daily Brain Training (auto-trigger when stale) ──
    // Fires once per day in the 4-5 UTC window (12-1 AM ET, after games settle).
    // Re-trains if brain has never been trained OR last training is >7 days old.
    if (forceTrain || (utcHour >= 4 && utcHour <= 5)) {
      try {
        const lastTrainKey = "nba_brain_last_trained";
        const lastTrained = await cloudGet<string | null>(lastTrainKey, null);
        const brain = await loadNbaPropBrainFromCloud();
        const neverTrained = !brain.isPreTrained || brain.totalGamesProcessed === 0;
        const daysSinceTrain = lastTrained
          ? (Date.now() - new Date(lastTrained).getTime()) / (1000 * 60 * 60 * 24)
          : 999;

        if (neverTrained || daysSinceTrain >= 7) {
          // Fire-and-forget — training takes ~5 min, cron has 120s
          const baseUrl = `https://${process.env.VERCEL_URL || "diamond-quant-live.vercel.app"}`;
          fetch(`${baseUrl}/api/nba-prop-train?seasons=2022,2023,2024${neverTrained ? "&reset=true" : ""}`, {
            headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" },
          }).catch(() => {});
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
          ? (Date.now() - new Date(lastEvolved).getTime()) / (1000 * 60 * 60 * 24)
          : 999;

        if (daysSince >= 6) {
          // Trigger evolution in background (don't await — cron has time limit)
          const baseUrl = `https://${process.env.VERCEL_URL || "diamond-quant-live.vercel.app"}`;
          fetch(`${baseUrl}/api/nba-prop-evolve?generations=2`, {
            headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" },
          }).catch(() => {});
          await cloudSet(lastEvolvedKey, new Date().toISOString());
        }
      } catch {}
    }

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      mlb: { total: games.length, live, final, pre, completedToday: completedGames.length },
      nbaProps: { ...nbaAudit, ghostCommitted: nbaGhostCommitted },
      trackRecord: { settled: trackSettled },
      userBets: userBetsSettled,
      botSettle,
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
