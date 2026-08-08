// ──────────────────────────────────────────────────────────
// DAILY RECAP — Auto-send picks + results to Discord
// Runs via cron after games finish
// ──────────────────────────────────────────────────────────

import { sendDiscordAlert } from "@/lib/odds/sportsbooks";
import { etDateString } from "@/lib/sports-date";

interface RecapData {
  sport: string;
  date: string;
  // Bot performance
  botRecord: { wins: number; losses: number; pending: number };
  botROI: number;
  botProfit: number;
  // Today's picks
  picks: Array<{
    pick: string;
    odds: number;
    result: string;
    payout: number;
    stake: number;
  }>;
  // Brain stats
  brainAccuracy?: { points?: number; rebounds?: number; assists?: number };
  // Prop Brain (NBA)
  propPredictions?: { total: number; hits: number; winRate: number };
}

export async function sendDailyRecap(webhookUrl: string, data: RecapData) {
  if (!webhookUrl) return;

  const {
    sport,
    date,
    botRecord,
    botROI,
    botProfit,
    picks,
    brainAccuracy,
    propPredictions,
  } = data;
  const sportEmoji = sport === "nba" ? "🏀" : "⚾";
  const sportName = sport === "nba" ? "NBA" : "MLB";

  // Build settled picks summary
  const settledPicks = picks.filter((p) => p.result !== "pending");
  const pendingPicks = picks.filter((p) => p.result === "pending");

  const picksText =
    settledPicks.length > 0
      ? settledPicks
          .map((p) => {
            const icon =
              p.result === "win" ? "✅" : p.result === "loss" ? "❌" : "➖";
            const pl = p.payout - p.stake;
            return `${icon} ${p.pick} (${p.odds > 0 ? "+" : ""}${p.odds}) → ${pl >= 0 ? "+" : ""}$${pl.toFixed(0)}`;
          })
          .join("\n")
      : "No settled picks today";

  const pendingText =
    pendingPicks.length > 0
      ? `\n⏳ ${pendingPicks.length} picks still pending`
      : "";

  // Color: green if profitable, red if not, blue if all pending
  const color =
    settledPicks.length === 0 ? 0x00d4ff : botProfit >= 0 ? 0x00ff88 : 0xff3b5c;

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    {
      name: "Record",
      value: `${botRecord.wins}W-${botRecord.losses}L`,
      inline: true,
    },
    {
      name: "ROI",
      value: `${botROI >= 0 ? "+" : ""}${botROI.toFixed(1)}%`,
      inline: true,
    },
    {
      name: "P/L",
      value: `${botProfit >= 0 ? "+" : ""}$${botProfit.toFixed(0)}`,
      inline: true,
    },
  ];

  if (brainAccuracy && sport === "nba") {
    fields.push({
      name: "Brain Accuracy",
      value: `Pts: ${brainAccuracy.points?.toFixed(1) ?? "—"}% | Reb: ${brainAccuracy.rebounds?.toFixed(1) ?? "—"}% | Ast: ${brainAccuracy.assists?.toFixed(1) ?? "—"}%`,
      inline: false,
    });
  }

  if (propPredictions && propPredictions.total > 0) {
    fields.push({
      name: "Prop Brain",
      value: `${propPredictions.hits}/${propPredictions.total} (${propPredictions.winRate.toFixed(1)}%)`,
      inline: true,
    });
  }

  await sendDiscordAlert(webhookUrl, {
    title: `${sportEmoji} ${sportName} Daily Recap — ${date}`,
    description: `${picksText}${pendingText}`,
    color,
    fields,
  });
}

// Build recap from bot state (called from cron)
export async function buildAndSendRecap(webhookUrl: string, sport: string) {
  try {
    const { cloudGet } = await import("@/lib/supabase/client");

    // Explicit per-sport map, NOT `sport === "nba" ? ... : "smart_bot"`.
    // That ternary sent every non-NBA sport to MLB's state, so calling this
    // with "nfl" would have read MLB's picks and posted them under an NFL
    // heading. An unknown sport now returns instead of silently mislabeling
    // another sport's slate.
    // NOTE: nothing writes smart_bot_nfl yet — the NFL pipeline commits and
    // grades prop predictions but has no smart_bot state — so an "nfl" recap
    // is a deliberate no-op rather than a wrong-sport post. The key is listed
    // so that whenever that state does start being written, this recap picks
    // it up without another edit here.
    const BOT_KEY: Record<string, string> = {
      mlb: "smart_bot",
      nba: "smart_bot_nba",
      nfl: "smart_bot_nfl",
    };
    const botKey = BOT_KEY[sport];
    if (!botKey) return;
    const botState = await cloudGet<any>(botKey, null);
    if (!botState) return;

    const today = etDateString();
    const todayPicks = (botState.picks ?? []).filter(
      (p: any) => p.date === today,
    );
    if (todayPicks.length === 0) return;

    const settled = (botState.picks ?? []).filter(
      (p: any) => p.result !== "pending",
    );
    const wins = settled.filter((p: any) => p.result === "win").length;
    const losses = settled.filter((p: any) => p.result === "loss").length;
    const totalStaked = settled.reduce(
      (s: number, p: any) => s + (p.stake ?? 0),
      0,
    );
    const totalReturns = settled.reduce(
      (s: number, p: any) => s + (p.payout ?? 0),
      0,
    );
    const profit = totalReturns - totalStaked;
    const roi = totalStaked > 0 ? (profit / totalStaked) * 100 : 0;

    // NBA brain accuracy
    let brainAccuracy;
    if (sport === "nba") {
      const brain = await cloudGet<any>("nba_prop_brain", null);
      if (brain?.markets) {
        brainAccuracy = {
          points: brain.markets.player_points?.winRate,
          rebounds: brain.markets.player_rebounds?.winRate,
          assists: brain.markets.player_assists?.winRate,
        };
      }
    }

    await sendDailyRecap(webhookUrl, {
      sport,
      date: today,
      botRecord: {
        wins,
        losses,
        pending: todayPicks.filter((p: any) => p.result === "pending").length,
      },
      botROI: roi,
      botProfit: profit,
      picks: todayPicks.map((p: any) => ({
        pick: p.pick,
        odds: p.odds,
        result: p.result,
        payout: p.payout ?? 0,
        stake: p.stake ?? 0,
      })),
      brainAccuracy,
    });
  } catch {}
}
