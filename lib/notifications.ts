// ──────────────────────────────────────────────────────────
// Push Notifications — Service Worker Registration + Alerts
// Register SW, request permission, send local notifications
// ──────────────────────────────────────────────────────────

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    return reg;
  } catch {
    return null;
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

// Send a local push notification (doesn't need a push server)
export async function sendLocalNotification(title: string, body: string, url?: string) {
  if (typeof window === "undefined") return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const reg = await navigator.serviceWorker?.ready;
  if (reg) {
    reg.showNotification(title, {
      body,
      icon: "/icon-192.png",
      tag: `dq-${Date.now()}`,
      data: { url: url || "/" },
      // @ts-ignore — vibrate is valid for mobile but not in TS NotificationOptions type
      vibrate: [100, 50, 100] as any,
    });
  } else {
    // Fallback to basic notification
    new Notification(title, { body });
  }
}

// Notify on high-confidence picks
export function notifyHighConfidencePick(pick: { pick: string; odds: number; confidence: string; game: string }) {
  if (pick.confidence !== "HIGH") return;
  const oddsStr = pick.odds > 0 ? `+${pick.odds}` : `${pick.odds}`;
  sendLocalNotification(
    `🔥 HIGH Confidence: ${pick.pick}`,
    `${pick.game} — ${oddsStr}`,
    "/"
  );
}

// Notify on prop bot auto-bet
export function notifyPropBotPick(playerName: string, propType: string, side: string, line: number, accuracy: number) {
  sendLocalNotification(
    `🏀 Prop Bot: ${playerName}`,
    `${side.toUpperCase()} ${line} ${propType.replace("player_", "")} — Brain: ${accuracy}% accurate`,
    "/"
  );
}
