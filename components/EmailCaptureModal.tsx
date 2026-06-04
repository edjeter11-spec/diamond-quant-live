"use client";

import { useEffect, useState } from "react";
import { Mail, X, Sparkles, CheckCircle, Loader2 } from "lucide-react";

const STORAGE_KEY = "dq_email_modal_v1";

interface Props {
  /** Delay (ms) before modal auto-fires. Default 20000. */
  delayMs?: number;
  /** Optional source label saved with the email (e.g. "track-record-hero"). */
  source?: string;
}

export default function EmailCaptureModal({ delayMs = 20000, source = "track-record" }: Props) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let dismissed = false;
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      dismissed = v === "dismissed" || v === "subscribed";
    } catch {}
    if (dismissed) return;

    // Fire on whichever happens first: time elapsed OR scrolled past 50%
    let fired = false;
    const fire = () => {
      if (fired) return;
      fired = true;
      setOpen(true);
      window.removeEventListener("scroll", onScroll);
    };
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (max > 0 && window.scrollY / max > 0.5) fire();
    };
    const t = setTimeout(fire, delayMs);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(t);
      window.removeEventListener("scroll", onScroll);
    };
  }, [delayMs]);

  const close = (reason: "dismissed" | "subscribed") => {
    try { localStorage.setItem(STORAGE_KEY, reason); } catch {}
    setOpen(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Enter a valid email");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Failed");
      setDone(true);
      // Auto-dismiss after success
      setTimeout(() => close("subscribed"), 2200);
    } catch (e: any) {
      setError(e?.message ?? "Failed to subscribe");
    }
    setSubmitting(false);
  };

  // ESC to dismiss + simple focus trap
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close("dismissed");
    };
    window.addEventListener("keydown", onKey);
    // Lock body scroll while modal open
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="email-modal-title"
    >
      <div className="absolute inset-0 bg-void/70 backdrop-blur-sm" onClick={() => close("dismissed")} aria-hidden="true" />
      <div className="relative max-w-md w-full bg-bunker border border-gold/30 rounded-2xl shadow-2xl shadow-gold/10 p-6 animate-slide-up">
        <button
          onClick={() => close("dismissed")}
          className="absolute top-3 right-3 flex items-center justify-center min-w-[36px] min-h-[36px] rounded-lg text-mercury/50 hover:text-silver hover:bg-gunmetal/40 transition-colors"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>

        {done ? (
          <div className="text-center py-6 space-y-3">
            <div className="w-14 h-14 mx-auto rounded-full bg-neon/15 border border-neon/30 flex items-center justify-center">
              <CheckCircle className="w-7 h-7 text-neon" />
            </div>
            <h2 className="text-lg font-bold text-silver">You're in.</h2>
            <p className="text-sm text-mercury/80">Tomorrow morning you'll get tonight's top pick + yesterday's W-L recap.</p>
          </div>
        ) : (
          <>
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-gold/20 to-electric/10 border border-gold/30 flex items-center justify-center mb-3">
              <Mail className="w-6 h-6 text-gold" />
            </div>
            <h2 id="email-modal-title" className="text-xl font-bold text-silver leading-tight">Get tonight's top pick — free</h2>
            <p className="text-sm text-mercury/70 mt-2 leading-relaxed">
              One email per day. The brain's highest-confidence pick, yesterday's W-L, and tonight's live arbs. Unsubscribe anytime.
            </p>

            <form onSubmit={submit} className="mt-5 space-y-3">
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                className="w-full min-h-[44px] px-4 rounded-xl bg-gunmetal/50 border border-slate/30 text-silver text-sm placeholder:text-mercury/40 focus:border-electric/40 outline-none"
                required
              />
              {error && <p className="text-[11px] text-danger">{error}</p>}
              <button
                type="submit"
                disabled={submitting}
                className="group w-full min-h-[48px] rounded-xl bg-gradient-to-r from-gold via-yellow-400 to-gold text-bunker font-bold text-sm shadow-lg shadow-gold/20 hover:shadow-gold/40 hover:scale-[1.01] active:scale-95 disabled:opacity-60 transition-all flex items-center justify-center gap-2"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {submitting ? "Subscribing..." : "Send Me Tonight's Pick"}
              </button>
              <p className="text-[10px] text-mercury/40 text-center">No spam. No credit card. Cancel anytime.</p>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
