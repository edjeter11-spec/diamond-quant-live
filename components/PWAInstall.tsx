"use client";

import { useEffect, useState } from "react";
import { Download, X, Smartphone } from "lucide-react";

const DISMISS_KEY = "dq_pwa_install_dismissed_v1";
const SHOW_AFTER_MS = 15_000; // wait 15s before showing — let user explore first

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function PWAInstall() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [iosBanner, setIosBanner] = useState(false);

  // Register service worker on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Register after page load to not delay TTI
    const reg = () => navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (document.readyState === "complete") reg();
    else window.addEventListener("load", reg, { once: true });
  }, []);

  // Detect installable (Android/Chrome via beforeinstallprompt; iOS needs banner)
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      if (localStorage.getItem(DISMISS_KEY)) return;
    } catch {}

    // Already installed (standalone display mode) → no prompt
    if (window.matchMedia?.("(display-mode: standalone)").matches) return;
    if ((navigator as any).standalone === true) return; // iOS PWA mode

    const ua = navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
    setIsIOS(ios);

    // iOS doesn't fire beforeinstallprompt — show a hint banner after delay
    if (ios) {
      const t = setTimeout(() => setIosBanner(true), SHOW_AFTER_MS);
      return () => clearTimeout(t);
    }

    // Android / Desktop Chrome
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setTimeout(() => setShow(true), SHOW_AFTER_MS);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, "true"); } catch {}
    setShow(false);
    setIosBanner(false);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const result = await deferred.userChoice;
    if (result.outcome === "accepted") {
      try { localStorage.setItem(DISMISS_KEY, "installed"); } catch {}
    }
    setShow(false);
    setDeferred(null);
  };

  // iOS instruction banner (since iOS doesn't have a programmatic install)
  if (iosBanner) {
    return (
      <div className="fixed bottom-20 md:bottom-4 left-2 right-2 md:left-auto md:right-4 md:max-w-sm z-[80] glass rounded-2xl border border-neon/30 bg-bunker/95 p-4 shadow-2xl shadow-neon/10 animate-slide-up">
        <button
          onClick={dismiss}
          className="absolute top-2 right-2 flex items-center justify-center min-w-[32px] min-h-[32px] rounded text-mercury/60 hover:text-silver hover:bg-gunmetal/40"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-neon/15 border border-neon/30 flex items-center justify-center flex-shrink-0">
            <Smartphone className="w-5 h-5 text-neon" />
          </div>
          <div className="flex-1 min-w-0 pr-6">
            <p className="text-sm font-bold text-silver">Install Diamond Quant</p>
            <p className="text-xs text-mercury/70 mt-1 leading-relaxed">
              Tap <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-gunmetal/60 text-mercury text-[10px] font-mono">⬆ Share</span> then "Add to Home Screen" for instant access.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Android / desktop install card
  if (show && deferred) {
    return (
      <div className="fixed bottom-20 md:bottom-4 left-2 right-2 md:left-auto md:right-4 md:max-w-sm z-[80] glass rounded-2xl border border-neon/30 bg-bunker/95 p-4 shadow-2xl shadow-neon/10 animate-slide-up">
        <button
          onClick={dismiss}
          className="absolute top-2 right-2 flex items-center justify-center min-w-[32px] min-h-[32px] rounded text-mercury/60 hover:text-silver hover:bg-gunmetal/40"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
        <div className="flex items-start gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-neon/15 border border-neon/30 flex items-center justify-center flex-shrink-0">
            <Download className="w-5 h-5 text-neon" />
          </div>
          <div className="flex-1 min-w-0 pr-6">
            <p className="text-sm font-bold text-silver">Install Diamond Quant</p>
            <p className="text-xs text-mercury/70 mt-1">Faster loads, push alerts, no browser chrome.</p>
          </div>
        </div>
        <button
          onClick={install}
          className="w-full min-h-[40px] rounded-xl bg-neon text-bunker text-sm font-bold hover:bg-neon/90 active:scale-95 transition-all"
        >
          Install
        </button>
      </div>
    );
  }

  return null;
}
