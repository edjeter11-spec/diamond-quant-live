"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Diamond, AlertTriangle } from "lucide-react";

const GATE_KEY = "dq_age_gate_v1";

export default function AgeGate() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(GATE_KEY)) setShow(true);
    } catch {
      setShow(true);
    }
  }, []);

  const confirm = () => {
    try { localStorage.setItem(GATE_KEY, new Date().toISOString()); } catch {}
    setShow(false);
  };

  const decline = () => {
    window.location.href = "https://www.ncpgambling.org/";
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-void/95 backdrop-blur-lg flex items-center justify-center px-4">
      <div className="max-w-md w-full rounded-2xl bg-bunker border border-slate/30 p-6 sm:p-8">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-neon/20 to-electric/20 border border-neon/30 flex items-center justify-center mx-auto mb-4">
          <Diamond className="w-7 h-7 text-neon" />
        </div>
        <h2 className="text-xl font-bold text-silver text-center mb-1">Diamond-Quant Live</h2>
        <p className="text-xs text-mercury/60 text-center mb-5 font-mono uppercase tracking-wider">Sports Betting Intelligence</p>

        <div className="rounded-xl bg-amber/5 border border-amber/25 p-3 mb-5 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber flex-shrink-0 mt-0.5" />
          <p className="text-xs text-mercury/80 leading-relaxed">
            This site contains sports betting analytics. You must be <strong className="text-silver">21+</strong> in the United States
            (or 18+ where locally permitted) to continue.
          </p>
        </div>

        <p className="text-[11px] text-mercury/60 text-center mb-5">
          By continuing, you confirm you&apos;re of legal gambling age in your jurisdiction and accept our{" "}
          <Link href="/terms" className="text-electric hover:underline">Terms</Link> and{" "}
          <Link href="/privacy" className="text-electric hover:underline">Privacy Policy</Link>.
        </p>

        <div className="flex flex-col gap-2">
          <button
            onClick={confirm}
            className="w-full py-3 rounded-xl bg-neon/15 border border-neon/30 text-neon font-semibold text-sm hover:bg-neon/25 active:scale-[0.99] transition-all"
          >
            I&apos;m 21+ — Enter
          </button>
          <button
            onClick={decline}
            className="w-full py-2 rounded-xl text-mercury/60 text-xs hover:text-mercury transition-colors"
          >
            I&apos;m under 21 — Exit
          </button>
        </div>

        <div className="mt-5 pt-4 border-t border-slate/20 text-center">
          <p className="text-[10px] text-mercury/50">
            Problem gambling? Call{" "}
            <a href="tel:1-800-426-2537" className="text-electric hover:underline">1-800-GAMBLER</a> ·{" "}
            <Link href="/responsible-gaming" className="text-electric hover:underline">Get help</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
