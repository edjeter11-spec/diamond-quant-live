"use client";

// Desktop-only hero banner. Mirrors the marketing panel from the product
// render: brand mark + value prop on the left, three capability callouts on
// the right. Hidden below `lg` so the mobile board stays exactly as it was —
// on a phone this is pure vertical space between the user and their picks.
//
// Deliberately makes no performance claims (no win rates, no "10M+ data
// points"). Those numbers belong in the footer stats strip, which reads them
// from the real graded track record.

import { Brain, Radio, Sparkles } from "lucide-react";

const FEATURES = [
  {
    icon: Brain,
    title: "Model-Backed Picks",
    body: "Every pick carries its own edge math and reasoning",
  },
  {
    icon: Radio,
    title: "Real-Time Updates",
    body: "Lines, injuries, weather and scores as they move",
  },
  {
    icon: Sparkles,
    title: "Every Pick Graded",
    body: "Wins and losses both settled against final scores",
  },
];

export default function HeroBanner() {
  return (
    <div className="hidden lg:block relative overflow-hidden rounded-xl border border-slate/25 bg-gradient-to-br from-bunker via-void to-bunker">
      {/* Ambient glow behind the mark, echoing the logo artwork */}
      <div
        aria-hidden
        className="absolute -right-24 -top-24 w-72 h-72 rounded-full bg-electric/10 blur-3xl"
      />
      <div
        aria-hidden
        className="absolute -left-16 -bottom-20 w-64 h-64 rounded-full bg-purple/10 blur-3xl"
      />

      <div className="relative flex items-center gap-6 px-6 py-5">
        {/* Left — brand + value prop */}
        <div className="flex items-center gap-4 flex-shrink-0">
          <img
            src="/quant-mark.png"
            alt=""
            width={64}
            height={64}
            className="w-16 h-16 rounded-2xl border border-electric/25 shadow-lg shadow-electric/10"
          />
          <div>
            <h2 className="text-xl font-extrabold text-silver leading-tight tracking-tight">
              Precision betting
              <span className="block text-electric">&amp; analytics.</span>
            </h2>
            <p className="text-[11px] text-mercury/70 mt-1 font-mono tracking-wider">
              MODELS · EDGES · RECEIPTS
            </p>
          </div>
        </div>

        {/* Divider */}
        <div className="w-px self-stretch bg-slate/20 mx-1" />

        {/* Right — capability callouts. Single column until there's genuinely
            room for three, otherwise the copy wraps to one word per line. */}
        <div className="flex-1 grid grid-cols-1 2xl:grid-cols-3 gap-3 2xl:gap-4 min-w-0">
          {FEATURES.map((f) => (
            <div key={f.title} className="flex items-start gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-gunmetal/60 border border-slate/25 flex items-center justify-center flex-shrink-0">
                <f.icon className="w-4 h-4 text-electric" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-silver leading-tight">
                  {f.title}
                </p>
                <p className="text-[10px] text-mercury/70 leading-snug mt-0.5">
                  {f.body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
