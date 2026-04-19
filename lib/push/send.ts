// ──────────────────────────────────────────────────────────
// Web Push Sender — VAPID signed pushes to all subscribed users.
//
// Called from the cron when a new +EV pick is detected (>= 5% edge).
// Gracefully no-ops when VAPID keys aren't configured so local dev /
// preview deploys don't crash.
// ──────────────────────────────────────────────────────────

import webpush from "web-push";
import { supabaseAdmin } from "@/lib/supabase/server-auth";

let vapidReady = false;

function initVapid(): boolean {
  if (vapidReady) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:noreply@diamond-quant.com";
  if (!pub || !priv) return false;
  webpush.setVapidDetails(subject, pub, priv);
  vapidReady = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/** Send a push payload to every subscribed device. Removes stale 404/410 subs. */
export async function sendPushToAll(payload: PushPayload): Promise<{ sent: number; pruned: number; skipped: number }> {
  if (!initVapid()) return { sent: 0, pruned: 0, skipped: 1 };
  if (!supabaseAdmin) return { sent: 0, pruned: 0, skipped: 1 };

  const { data: subs, error } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth");
  if (error || !subs || subs.length === 0) return { sent: 0, pruned: 0, skipped: 0 };

  const body = JSON.stringify(payload);
  let sent = 0;
  const staleIds: number[] = [];

  await Promise.all(
    subs.map(async (s: any) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        );
        sent++;
      } catch (err: any) {
        const status = err?.statusCode;
        if (status === 404 || status === 410) staleIds.push(s.id);
      }
    }),
  );

  let pruned = 0;
  if (staleIds.length > 0) {
    const { error: delErr } = await supabaseAdmin.from("push_subscriptions").delete().in("id", staleIds);
    if (!delErr) pruned = staleIds.length;
  }

  return { sent, pruned, skipped: 0 };
}
