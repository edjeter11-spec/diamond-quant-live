"use client";

import { useState } from "react";
import { useAuth } from "@/lib/supabase/auth";
import { Check, ArrowLeft, Loader2, Sparkles } from "lucide-react";
import Link from "next/link";

const FEATURES = [
  "Unlimited daily picks",
  "AI Prop Brain — every NBA + MLB projection",
  "Live arbitrage scanner",
  "Parlay builder + sharp money tracker",
  "Auto-grade against box scores",
  "Discord daily recap",
];

export default function PricingPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const priceId = process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID || "price_pro";

  const handleCheckout = async () => {
    if (!user) {
      window.location.href = "/?signin=1";
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceId, userId: user.id, email: user.email }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch {}
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-void text-silver">
      <div className="max-w-md mx-auto px-4 pt-6 pb-12">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Link href="/" className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-gunmetal/60 transition-colors" aria-label="Back to dashboard">
            <ArrowLeft className="w-5 h-5 text-mercury" />
          </Link>
          <h1 className="text-2xl font-bold text-white">Pro</h1>
        </div>

        {/* Single Pro card */}
        <div className="glass rounded-2xl p-6 border-2 border-gold/30 bg-gradient-to-br from-gold/5 via-electric/5 to-purple/5">
          <div className="text-center mb-6">
            <p className="text-[10px] font-bold text-gold uppercase tracking-wider mb-2">7-Day Free Trial</p>
            <div className="flex items-baseline justify-center gap-1">
              <span className="text-5xl font-bold text-white">$15</span>
              <span className="text-sm text-mercury">/month</span>
            </div>
            <p className="text-xs text-mercury/60 mt-2">Cancel anytime. No credit card surprises.</p>
          </div>

          <ul className="space-y-3 mb-6">
            {FEATURES.map((f, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm">
                <Check className="w-4 h-4 flex-shrink-0 mt-0.5 text-neon" />
                <span className="text-silver">{f}</span>
              </li>
            ))}
          </ul>

          <button
            onClick={handleCheckout}
            disabled={loading}
            className="w-full min-h-[52px] rounded-xl font-bold text-base bg-gradient-to-r from-gold via-yellow-400 to-gold text-bunker shadow-lg shadow-gold/30 hover:shadow-gold/50 hover:scale-[1.01] active:scale-[0.98] disabled:opacity-60 transition-all flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {loading ? "Loading..." : "Start Free Trial"}
            <span>→</span>
          </button>
        </div>

        {/* Subtle free-tier note */}
        <p className="text-center text-[11px] text-mercury/50 mt-6">
          Browse the board free without an account — Pro unlocks every pick + the brain.
        </p>
      </div>
    </div>
  );
}
