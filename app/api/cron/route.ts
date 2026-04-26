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

      // 2. Commit ghost prop projections for upcoming NBA games
      try {
        const oddsRes = await fetch(`https://${process.env.VERCEL_URL || "diamond-quant-live.vercel.app"}/api/players?sport=basketball_nba&market=player_points`);
        if (oddsRes.ok) {
          const oddsData = await oddsRes.json();
          const props = (oddsData.props ?? []).map((p: any) => ({
            playerName: p.playerName,
            team: p.team,
            gameId: p.gameTime ?? "",
            propType: "player_points",
            line: p.line,
            bestOverOdds: p.bestOver?.price ?? -110,
            bestUnderOdds: p.bestUnder?.price ?? -110,
            isHome: false,
          }));
          if (props.length > 0) {
            const brain = graded > 0 ? updatedBrain : nbaBrain;
            const { committed } = await commitPropProjections(brain, props, {});
            nbaGhostCommitted = committed;
          }
        }
      } catch {}
    } catch {}

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

    // ── Weekly Brain Evolution (Sunday midnight UTC = Sunday 8PM ET) ──
    // Uses dayOfWeek from calibration block above.
    if (dayOfWeek === 0 && utcHour >= 0 && utcHour <= 2) {
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
