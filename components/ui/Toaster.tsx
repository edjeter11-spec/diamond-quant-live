"use client";

import { useEffect, useState } from "react";
import { CheckCircle, Info, AlertTriangle, X } from "lucide-react";

interface Toast {
  id: number;
  tone: "good" | "info" | "warn";
  message: string;
  sub?: string;
}

// Listens for window "dq-toast" CustomEvents and renders ephemeral toasts.
// Any part of the app (including the zustand store) can fire one with:
//   window.dispatchEvent(new CustomEvent("dq-toast", { detail: { tone, message, sub } }));
export default function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { tone?: Toast["tone"]; message?: string; sub?: string } | undefined;
      if (!detail?.message) return;
      const toast: Toast = {
        id: Date.now() + Math.random(),
        tone: detail.tone ?? "info",
        message: detail.message,
        sub: detail.sub,
      };
      setToasts(t => [...t.slice(-3), toast]);
      setTimeout(() => setToasts(t => t.filter(x => x.id !== toast.id)), 2800);
    };
    window.addEventListener("dq-toast", handler);
    return () => window.removeEventListener("dq-toast", handler);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-[70] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => {
        const Icon = t.tone === "good" ? CheckCircle : t.tone === "warn" ? AlertTriangle : Info;
        const color = t.tone === "good" ? "text-neon border-neon/30 bg-neon/10"
          : t.tone === "warn" ? "text-amber border-amber/30 bg-amber/10"
          : "text-electric border-electric/30 bg-electric/10";
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-2 px-3 py-2 rounded-xl border backdrop-blur-md shadow-xl animate-slide-up max-w-[min(90vw,340px)] ${color}`}
            role="status"
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate">{t.message}</p>
              {t.sub && <p className="text-[10px] opacity-80 truncate">{t.sub}</p>}
            </div>
            <button
              onClick={() => setToasts(list => list.filter(x => x.id !== t.id))}
              className="text-mercury/50 hover:text-silver transition-colors"
              aria-label="Dismiss"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
