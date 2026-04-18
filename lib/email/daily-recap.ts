// Daily recap email — sends each subscriber a morning summary of
// yesterday's results + tonight's slate.
//
// Fires server-side from the cron job. No-ops when RESEND_API_KEY
// isn't configured (code-ready for a later activation).

import { supabaseAdmin } from "@/lib/supabase/server-auth";

interface RecapPayload {
  yesterdayRecord: { wins: number; losses: number; profitUnits: number };
  tonightCount: number;
  parlayOdds?: number;
  results7Days: { wins: number; losses: number; profitUnits: number };
  siteUrl: string;
}

const FROM = process.env.RESEND_FROM_EMAIL || "Diamond-Quant <picks@diamond-quant-live.vercel.app>";

function renderHtml(p: RecapPayload, displayName?: string): string {
  const profit = p.yesterdayRecord.profitUnits;
  const profitColor = profit > 0 ? "#00ff88" : profit < 0 ? "#ff3b5c" : "#8b8fa3";
  const profitText = profit >= 0 ? `+${profit.toFixed(1)}u` : `${profit.toFixed(1)}u`;

  const greeting = displayName ? `Hey ${displayName.split(" ")[0]},` : "Hey,";

  return `<!doctype html>
<html><body style="margin:0;background:#0a0a0f;color:#e6e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:32px 20px;">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:24px;">
      <div style="width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#00ff88,#00d4ff);display:inline-flex;align-items:center;justify-content:center;color:#0a0a0f;font-weight:900;font-size:18px;">D</div>
      <span style="font-size:15px;font-weight:700;color:#fff;">Diamond-Quant Live</span>
    </div>

    <h1 style="font-size:20px;font-weight:700;color:#fff;margin:0 0 8px;">${greeting}</h1>
    <p style="font-size:14px;color:#c4c8d8;margin:0 0 24px;">Here's yesterday's recap and what's on tonight.</p>

    <div style="background:#0f1117;border:1px solid #2a2d3e;border-radius:12px;padding:16px;margin-bottom:16px;">
      <p style="font-size:11px;color:#8b8fa3;text-transform:uppercase;letter-spacing:1px;margin:0 0 6px;">Yesterday</p>
      <p style="font-size:22px;font-weight:800;color:#fff;margin:0 0 4px;">
        ${p.yesterdayRecord.wins}W–${p.yesterdayRecord.losses}L
        <span style="color:${profitColor};font-size:18px;margin-left:8px;">${profitText}</span>
      </p>
      <p style="font-size:11px;color:#8b8fa3;margin:0;">
        Last 7 days: ${p.results7Days.wins}–${p.results7Days.losses} · ${p.results7Days.profitUnits >= 0 ? "+" : ""}${p.results7Days.profitUnits.toFixed(1)}u
      </p>
    </div>

    <div style="background:linear-gradient(135deg,rgba(0,255,136,0.08),rgba(0,212,255,0.04));border:1px solid rgba(0,255,136,0.25);border-radius:12px;padding:16px;margin-bottom:24px;">
      <p style="font-size:11px;color:#00ff88;text-transform:uppercase;letter-spacing:1px;margin:0 0 6px;">Tonight</p>
      <p style="font-size:18px;font-weight:700;color:#fff;margin:0 0 4px;">
        ${p.tonightCount} pick${p.tonightCount !== 1 ? "s" : ""} posted
        ${p.parlayOdds != null ? ` · Parlay ${p.parlayOdds > 0 ? "+" : ""}${p.parlayOdds}` : ""}
      </p>
      <a href="${p.siteUrl}" style="display:inline-block;margin-top:10px;padding:10px 20px;background:rgba(0,255,136,0.15);border:1px solid rgba(0,255,136,0.3);border-radius:10px;color:#00ff88;font-size:13px;font-weight:700;text-decoration:none;">Open tonight's slate →</a>
    </div>

    <div style="text-align:center;">
      <a href="${p.siteUrl}/results" style="color:#00d4ff;font-size:12px;text-decoration:none;">Full track record</a>
      <span style="color:#8b8fa3;margin:0 6px;">·</span>
      <a href="${p.siteUrl}/profile" style="color:#8b8fa3;font-size:12px;text-decoration:none;">Email settings</a>
    </div>

    <p style="font-size:10px;color:#8b8fa3;text-align:center;margin-top:24px;line-height:1.5;">
      Analytics platform. For informational purposes only.<br>
      You're receiving this because you enabled daily recap in your profile.
    </p>
  </div>
</body></html>`;
}

/** Build recap data from the public track record. */
export async function buildRecap(siteUrl: string): Promise<RecapPayload | null> {
  if (!supabaseAdmin) return null;
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yStr = yesterday.toISOString().split("T")[0];

  const { data: yesterdayRows } = await supabaseAdmin
    .from("daily_picks_log")
    .select("result,profit_units")
    .eq("pick_date", yStr)
    .neq("result", "pending");

  const yesterdayRecord = {
    wins: (yesterdayRows ?? []).filter(r => r.result === "win").length,
    losses: (yesterdayRows ?? []).filter(r => r.result === "loss").length,
    profitUnits: Math.round((yesterdayRows ?? []).reduce((s, r) => s + Number(r.profit_units ?? 0), 0) * 10) / 10,
  };

  // 7-day rollup
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 7);
  const { data: weekRows } = await supabaseAdmin
    .from("daily_picks_log")
    .select("result,profit_units")
    .gte("pick_date", since.toISOString().split("T")[0])
    .neq("result", "pending");
  const results7Days = {
    wins: (weekRows ?? []).filter(r => r.result === "win").length,
    losses: (weekRows ?? []).filter(r => r.result === "loss").length,
    profitUnits: Math.round((weekRows ?? []).reduce((s, r) => s + Number(r.profit_units ?? 0), 0) * 10) / 10,
  };

  // Tonight's parlay + pick count
  const today = new Date().toISOString().split("T")[0];
  const { data: parlay } = await supabaseAdmin
    .from("app_state")
    .select("value")
    .eq("key", `parlay_today_mlb_${today}`)
    .single();
  const { data: tonightPicks } = await supabaseAdmin
    .from("daily_picks_log")
    .select("id")
    .eq("pick_date", today)
    .eq("result", "pending");

  const parlayOdds = (parlay?.value as any)?.totalOdds;
  return {
    yesterdayRecord,
    tonightCount: tonightPicks?.length ?? 0,
    parlayOdds,
    results7Days,
    siteUrl,
  };
}

/** Send the daily recap to every user who opted in. */
export async function sendDailyRecapToAll(siteUrl: string): Promise<{ sent: number; skipped: number }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !supabaseAdmin) return { sent: 0, skipped: 0 };

  const payload = await buildRecap(siteUrl);
  if (!payload) return { sent: 0, skipped: 0 };

  // Find all users who opted in
  const { data: users } = await supabaseAdmin
    .from("user_preferences")
    .select("user_id, email_daily_recap")
    .eq("email_daily_recap", true);

  let sent = 0;
  let skipped = 0;
  for (const u of users ?? []) {
    const { data: profile } = await supabaseAdmin
      .from("user_profiles")
      .select("email,display_name")
      .eq("id", u.user_id)
      .single();
    if (!profile?.email) { skipped++; continue; }

    try {
      const html = renderHtml(payload, profile.display_name);
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: FROM,
          to: profile.email,
          subject: `Yesterday: ${payload.yesterdayRecord.wins}-${payload.yesterdayRecord.losses} · Tonight's slate is up`,
          html,
        }),
      });
      if (res.ok) sent++;
      else skipped++;
    } catch {
      skipped++;
    }
  }

  return { sent, skipped };
}
