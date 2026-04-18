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
    try {
      const settleGames = completedGames.map(g => ({
        homeTeam: g.homeTeam ?? "", awayTeam: g.awayTeam ?? "",
        homeAbbrev: g.homeAbbrev ?? "", awayAbbrev: g.awayAbbrev ?? "",
        homeScore: g.homeScore ?? 0, awayScore: g.awayScore ?? 0,
      }));
      const { settled } = await settlePendingPicks(settleGames);
      trackSettled = settled;
    } catch (e) { console.error("track settle error:", e); }

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
          const { data: prefs } = await sb.from("user_preferences").select("discord_webhook").neq("discord_webhook", "");
          for (const pref of prefs ?? []) {
            if (pref.discord_webhook) {
              await buildAndSendRecap(pref.discord_webhook, "mlb");
              await buildAndSendRecap(pref.discord_webhook, "nba");
            }
          }
        }
      } catch {}
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

    // ── MLB Bot Settlement ──
    // When games are finishing at night (3-7 UTC = 11PM-3AM ET)
    if (final > 0 && hour >= 3 && hour <= 7) {
      try {
        const { settleAndLearn, saveSmartBot } = await import("@/lib/bot/smart-picks");
        const { cloudGet } = await import("@/lib/supabase/client");
        const mlbBotState = await cloudGet("smart_bot", { bankroll: 5000, picks: [], dailyPnL: {} }) as any;

        const pendingCount = (mlbBotState.picks ?? []).filter((p: any) => p.result === "pending").length;
        if (pendingCount > 0) {
          const { botState: settled } = settleAndLearn(mlbBotState, completedGames, "mlb");
          const newlySettled = settled.picks.filter((p: any, i: number) =>
            mlbBotState.picks[i]?.result === "pending" && p.result !== "pending"
          ).length;
          if (newlySettled > 0) {
            await cloudSet("smart_bot", settled);
          }
        }
      } catch {}
    }

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
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
