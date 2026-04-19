"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { useAuth } from "@/lib/supabase/auth";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export default function PushOptIn() {
  const { user, session } = useAuth();
  const [state, setState] = useState<"idle" | "subscribing" | "on" | "off" | "unsupported">("idle");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }
    navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    });
  }, []);

  async function subscribe() {
    if (!user || !session) return;
    const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!pub) return;
    setState("subscribing");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState("off"); return; }
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(pub) as BufferSource,
      });
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      setState("on");
    } catch {
      setState("off");
    }
  }

  async function unsubscribe() {
    if (!session) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch(`/api/push/subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      await sub.unsubscribe();
    }
    setState("off");
  }

  if (state === "unsupported" || !user) return null;
  if (state === "idle") return null;

  const isOn = state === "on";
  return (
    <button
      onClick={isOn ? unsubscribe : subscribe}
      disabled={state === "subscribing"}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-purple/25 bg-purple/10 hover:bg-purple/20 text-purple text-[11px] font-semibold transition-colors disabled:opacity-50"
      title={isOn ? "Disable +EV alerts" : "Get pinged when a new +EV pick lands"}
    >
      {isOn ? <Bell className="w-3 h-3" /> : <BellOff className="w-3 h-3" />}
      {state === "subscribing" ? "Enabling…" : isOn ? "Alerts on" : "Enable alerts"}
    </button>
  );
}
