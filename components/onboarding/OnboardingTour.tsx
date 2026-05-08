"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { ArrowRight, X, Sparkles } from "lucide-react";

const STORAGE_KEY = "dq_onboarded_v1";

type Step = {
  title: string;
  body: string;
  hint: string;
};

const STEPS: Step[] = [
  {
    title: "Sport Switcher",
    hint: "Top-left of the header — small MLB / NBA toggle next to the DQ logo.",
    body: "Switch sports here. Each sport has its own picks, brain, and bot.",
  },
  {
    title: "Quant Verdict & Picks Board",
    hint: "Center column on the Board tab — today's ranked picks.",
    body: "These are today's picks ranked by edge. HIGH confidence = consensus across all 3 models.",
  },
  {
    title: "Player Props Tab",
    hint: "Top nav (desktop) or bottom bar (mobile) — labeled \"Props\".",
    body: "Player props with our trained NBA brain projection. UNDER picks beat the line ~54% in backtests.",
  },
  {
    title: "Bot Challenge Tab",
    hint: "Top nav (desktop) or bottom bar (mobile) — labeled \"Bot\".",
    body: "Watch the bot bet $5K virtually with daily picks. ROI tracks live.",
  },
];

export default function OnboardingTour() {
  const [mounted, setMounted] = useState(false);
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextBtnRef = useRef<HTMLButtonElement>(null);
  const skipBtnRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Read localStorage AFTER mount to avoid SSR/hydration mismatch.
  useEffect(() => {
    setMounted(true);
    try {
      if (typeof window === "undefined") return;
      const seen = window.localStorage.getItem(STORAGE_KEY);
      if (!seen) {
        previouslyFocused.current = document.activeElement as HTMLElement | null;
        setActive(true);
      }
    } catch {
      // localStorage unavailable (private mode etc.) — skip the tour to be safe
    }
  }, []);

  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "true");
    } catch {}
    setActive(false);
    // Restore focus to whatever was focused before the tour opened
    try {
      previouslyFocused.current?.focus?.();
    } catch {}
  }, []);

  const next = useCallback(() => {
    setStep((s) => {
      if (s >= STEPS.length - 1) {
        dismiss();
        return s;
      }
      return s + 1;
    });
  }, [dismiss]);

  // Lock body scroll while tour is open
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);

  // Auto-focus the primary action when each step renders, and trap focus.
  useEffect(() => {
    if (!active) return;
    nextBtnRef.current?.focus();
  }, [active, step]);

  // Keyboard handling: ESC closes, Enter/Space advances, Tab is trapped.
  useEffect(() => {
    if (!active) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
        return;
      }
      if (e.key === "Tab") {
        // Trap focus between Skip and Next/Get Started
        const focusables = [skipBtnRef.current, nextBtnRef.current].filter(
          (el): el is HTMLButtonElement => !!el
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const activeEl = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (activeEl === first || !activeEl || !cardRef.current?.contains(activeEl)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (activeEl === last || !activeEl || !cardRef.current?.contains(activeEl)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, dismiss]);

  if (!mounted || !active) return null;

  const current = STEPS[step];
  const isFinal = step === STEPS.length - 1;
  const total = STEPS.length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dq-onboarding-title"
      aria-describedby="dq-onboarding-body"
      className="fixed inset-0 z-[100] flex items-center justify-center px-4 sm:px-6"
    >
      {/* Backdrop — clicking it does NOT dismiss (avoid accidental skip);
          user must explicitly Skip or Next through. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-void/85 backdrop-blur-sm"
      />

      <div
        ref={cardRef}
        className="glass relative w-full max-w-md rounded-2xl border border-electric/30 bg-bunker/95 p-6 sm:p-7 shadow-[0_0_60px_-10px_rgba(0,212,255,0.45)] animate-slide-up"
      >
        {/* Skip (X) button */}
        <button
          ref={skipBtnRef}
          onClick={dismiss}
          aria-label="Skip onboarding tour"
          className="absolute top-3 right-3 p-1.5 rounded-lg text-mercury hover:text-silver hover:bg-gunmetal/70 transition-colors focus:outline-none focus:ring-2 focus:ring-electric/50"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-2 mb-1">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-neon/20 to-electric/20 border border-neon/30 flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5 text-neon" aria-hidden="true" />
          </div>
          <span className="text-[10px] font-mono uppercase tracking-widest text-electric">
            Welcome to DQ Live
          </span>
        </div>

        {/* Step counter */}
        <div className="flex items-center gap-1.5 mb-3" aria-label={`Step ${step + 1} of ${total}`}>
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1 rounded-full transition-all ${
                i === step
                  ? "w-6 bg-neon"
                  : i < step
                  ? "w-3 bg-neon/40"
                  : "w-3 bg-slate/40"
              }`}
              aria-hidden="true"
            />
          ))}
          <span className="ml-auto text-[10px] font-mono text-mercury/60">
            {step + 1} / {total}
          </span>
        </div>

        <h2
          id="dq-onboarding-title"
          className="text-lg sm:text-xl font-bold text-silver leading-tight"
        >
          {current.title}
        </h2>

        <p
          id="dq-onboarding-body"
          className="mt-2 text-sm text-silver/90 leading-relaxed"
        >
          {current.body}
        </p>

        <p className="mt-3 text-xs text-mercury italic">
          {current.hint}
        </p>

        {/* Actions */}
        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            onClick={dismiss}
            className="text-xs font-medium text-mercury hover:text-silver transition-colors focus:outline-none focus:ring-2 focus:ring-electric/50 rounded px-1 py-1"
          >
            Skip tour
          </button>
          <button
            ref={nextBtnRef}
            onClick={next}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-neon/15 text-neon border border-neon/40 text-sm font-semibold hover:bg-neon/25 transition-colors focus:outline-none focus:ring-2 focus:ring-neon/60"
          >
            {isFinal ? "Get Started" : "Next"}
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
