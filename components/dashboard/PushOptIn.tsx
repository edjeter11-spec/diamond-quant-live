"use client";

import { useEffect, useState } from "react";
import { Bell, Check, X } from "lucide-react";
import { useAuth } from "@/lib/supabase/auth";

const DISMISS_KEY = "dq_push_dismissed";
const DISMISS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const THANK_YOU_MS = 30 * 1000; // 30s

type Phase = "loading" | "default" | "granted" | "denied" | "hidden" | "unsupported";

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
  const [phase, setPhase] = useState<Phase>("loading");
  const [busy, setBusy] = useState(false);
  const [grantedAt, setGrantedAt] = useState<number | null>(null);

  // Detect support, dismissal, and current Notification.permission state
  useEffect(() => {
    if (typeof window === "undefined") return;
    const supported =
      "Notification" in window &&
      "serviceWorker" in navigator &&
      "PushManager" in window;
    if (!supported) {
      setPhase("unsupported");
      return;
    }

    const perm = Notification.permission;
    if (perm === "granted") {
      setPhase("granted");
      return;
    }
    if (perm === "denied") {
      setPhase("denied");
      return;
    }

    // "default" — respect 7-day dismissal
    try {
      const raw = localStorage.getItem(DISMISS_KEY);
      const ts = raw ? parseInt(raw, 10) : 0;
      if (ts && Date.now() - ts < DISMISS_WINDOW_MS) {
        setPhase("hidden");
        return;
      }
    } catch {}
    setPhase("default");
  }, []);

  // Auto-hide 30s after grant
  useEffect(() => {
    if (phase !== "granted" || grantedAt == null) return;
    const elapsed = Date.now() - grantedAt;
    const remaining = Math.max(0, THANK_YOU_MS - elapsed);
    const t = setTimeout(() => setPhase("hidden"), remaining);
    return () => clearTimeout(t);
  }, [phase, grantedAt]);

  async function enable() {
    if (busy) return;
    if (!user || !session) return;
    const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!pub) return;
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm === "denied") {
        setPhase("denied");
        return;
      }
      if (perm !== "granted") return;

      const reg =
        (await navigator.serviceWorker.getRegistration("/sw.js")) ??
        (await navigator.serviceWorker.register("/sw.js"));
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(pub) as BufferSource,
        }));

      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });

      setGrantedAt(Date.now());
      setPhase("granted");
    } catch {
      // soft-fail, keep card visible
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {}
    setPhase("hidden");
  }

  if (phase === "loading" || phase === "hidden" || phase === "unsupported") return null;
  if (!user) return null;

  if (phase === "granted") {
    return (
      <div className="glass rounded-xl border border-slate/30 p-4 flex items-center gap-3 animate-slide-up">
        <div className="w-9 h-9 rounded-lg bg-neon/10 border border-neon/20 flex items-center justify-center flex-shrink-0">
          <Check className="w-4 h-4 text-neon" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-silver">Notifications on</p>
          <p className="text-[11px] text-mercury/70">
            We'll ping you when sharp picks drop.{" "}
            <button
              type="button"
              onClick={() => {
                /* TODO: open preferences modal */
              }}
              className="text-neon hover:underline"
            >
              Manage preferences
            </button>
          </p>
        </div>
      </div>
    );
  }

  if (phase === "denied") {
    return (
      <div className="glass rounded-xl border border-slate/30 p-4 flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-amber/10 border border-amber/20 flex items-center justify-center flex-shrink-0">
          <Bell className="w-4 h-4 text-amber" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-silver">Notifications blocked</p>
          <p className="text-[11px] text-mercury/70 mt-0.5">
            Re-enable in your browser's site settings (lock icon in the address bar) to get +EV alerts.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="p-1 rounded hover:bg-gunmetal/50 text-mercury/60 hover:text-mercury flex-shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  // "default"
  return (
    <div className="glass rounded-xl border border-slate/30 p-4 flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg bg-purple/10 border border-purple/20 flex items-center justify-center flex-shrink-0">
        <Bell className="w-4 h-4 text-purple" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-silver">Get +EV alerts when sharp picks drop</p>
        <p className="text-[11px] text-mercury/70">A quiet ping — only when the model finds an edge worth taking.</p>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button
          type="button"
          onClick={enable}
          disabled={busy}
          className="px-3 py-1.5 rounded-lg bg-purple/15 hover:bg-purple/25 text-purple text-[11px] font-semibold border border-purple/25 transition-colors disabled:opacity-50"
        >
          {busy ? "Enabling…" : "Enable"}
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="p-1.5 rounded hover:bg-gunmetal/50 text-mercury/60 hover:text-mercury"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
