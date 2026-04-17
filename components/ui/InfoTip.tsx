"use client";

import { useState, type ReactNode } from "react";
import { HelpCircle } from "lucide-react";

// Hover (desktop) + tap (mobile) tooltip with a small "?" trigger.
// Used as <InfoTip term="EV" />  or  <InfoTip term="Vig">custom child</InfoTip>

const GLOSSARY: Record<string, { title: string; body: string }> = {
  EV: {
    title: "Expected Value (EV)",
    body: "How much you'd profit on average per dollar wagered. +5% EV means you'd net 5¢ on every $1 over the long run if the model's probability is correct. Doesn't guarantee any single bet wins.",
  },
  SHARP: {
    title: "Sharp",
    body: "A bet flagged as having signal from professional bettors — usually triggered by a meaningful line move at a respected book like Pinnacle, Circa, or BetCRIS.",
  },
  NRFI: {
    title: "NRFI / YRFI",
    body: "No Run First Inning vs Yes Run First Inning. A market that pays if no run (NRFI) or any run (YRFI) is scored in the top + bottom of the 1st combined.",
  },
  KELLY: {
    title: "Kelly Criterion",
    body: "Mathematical formula for optimal bet sizing given your edge and bankroll. We default to 1/4 Kelly to reduce variance — recommended max is 5% of bankroll on any single bet.",
  },
  CLV: {
    title: "Closing Line Value (CLV)",
    body: "Whether your bet beat the closing line. Positive CLV (bet closed at a worse price than you got) is the single best long-term predictor of profitability.",
  },
  VIG: {
    title: "Vig / Juice",
    body: "The sportsbook's commission baked into the odds. -110 on both sides of a coin flip = 4.5% vig. In parlays, vig compounds across legs which is why a 3-leg parlay can show negative EV even when each leg is +EV individually.",
  },
  ARB: {
    title: "Arbitrage (Arb)",
    body: "When odds across different books guarantee profit regardless of outcome — bet both sides at different books and lock in a guaranteed return. Rare and short-lived.",
  },
  UNIT: {
    title: "Unit Size",
    body: "A standardized bet amount, typically 1% of your bankroll. We size each pick from 0.5u to 5u based on the model's edge — bigger edge gets bigger size, capped to control variance.",
  },
};

export default function InfoTip({
  term,
  children,
  className = "",
  iconClassName = "",
}: {
  term: keyof typeof GLOSSARY | string;
  children?: ReactNode;
  className?: string;
  iconClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const entry = GLOSSARY[term as keyof typeof GLOSSARY];
  if (!entry) return <>{children}</>;

  return (
    <span className={`relative inline-flex items-center gap-0.5 ${className}`}>
      {children}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="inline-flex items-center text-mercury/40 hover:text-electric transition-colors"
        aria-label={`What is ${entry.title}?`}
      >
        <HelpCircle className={`w-3 h-3 ${iconClassName}`} />
      </button>
      {open && (
        <span
          className="absolute z-50 left-1/2 -translate-x-1/2 top-full mt-1.5 w-64 rounded-lg border border-slate/40 bg-bunker/95 backdrop-blur-md shadow-xl p-2.5 text-left pointer-events-none"
          role="tooltip"
        >
          <span className="block text-[11px] font-semibold text-electric mb-0.5">{entry.title}</span>
          <span className="block text-[10px] text-mercury/80 leading-relaxed normal-case">{entry.body}</span>
        </span>
      )}
    </span>
  );
}
