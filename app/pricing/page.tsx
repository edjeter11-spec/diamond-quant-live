"use client";

import { useState } from "react";
import { useAuth } from "@/lib/supabase/auth";
import { Diamond, Check, Zap, Crown, ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";

const PLANS = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    features: [
      "3 picks per day",
      "Live odds from 10+ sportsbooks",
      "Public track record",
      "Bankroll + bet logging",
    ],
    cta: "Current Plan",
    highlighted: false,
    priceId: null,
  },
  {
    name: "Pro",
    price: "$15",
    period: "/month",
    features: [
      "Unlimited picks — every +EV bet we find",
      "Parlay of the Day + Top Locks unlocked",
      "AI Prop Brain (NBA) + prop projections",
      "Live arbitrage scanner",
      "Sharp money tracker",
      "Auto-settle bets from screenshots",
      "Discord daily recap",
      "7-day free trial · cancel anytime",
    ],
    cta: "Start 7-Day Free Trial",
    highlighted: true,
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID || "price_pro",
  },
];

export default function PricingPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState<string | null>(null);

  const handleCheckout = async (priceId: string | null) => {
    if (!priceId || !user) return;
    setLoading(priceId);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceId, userId: user.id, email: user.email }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch {}
    setLoading(null);
  };

  return (
    <div className="min-h-screen bg-void text-silver">
      <div className="max-w-5xl mx-auto px-4 pt-8 pb-12">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Link href="/" className="p-2 rounded-lg hover:bg-gunmetal/60 transition-colors">
            <ArrowLeft className="w-4 h-4 text-mercury" />
          </Link>
          <Diamond className="w-8 h-8 text-neon" />
          <div>
            <h1 className="text-2xl font-bold text-white">Pricing</h1>
            <p className="text-sm text-mercury">Unlock the full power of Diamond-Quant Live</p>
          </div>
        </div>

        {/* Plans */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl mx-auto">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-2xl p-6 border ${
                plan.highlighted
                  ? "bg-neon/5 border-neon/30 ring-1 ring-neon/20"
                  : "bg-bunker border-slate/40"
              }`}
            >
              {plan.highlighted && (
                <div className="flex items-center gap-1 mb-3">
                  <Crown className="w-3.5 h-3.5 text-neon" />
                  <span className="text-[10px] font-bold text-neon uppercase tracking-wider">Most Popular</span>
                </div>
              )}
              <h2 className="text-xl font-bold text-white">{plan.name}</h2>
              <div className="flex items-baseline gap-1 mt-2 mb-4">
                <span className="text-3xl font-bold text-white">{plan.price}</span>
                <span className="text-sm text-mercury">{plan.period}</span>
              </div>

              <ul className="space-y-2.5 mb-6">
                {plan.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <Check className={`w-4 h-4 flex-shrink-0 mt-0.5 ${plan.highlighted ? "text-neon" : "text-mercury"}`} />
                    <span className="text-silver">{f}</span>
                  </li>
                ))}
              </ul>

              <button
                onClick={() => handleCheckout(plan.priceId)}
                disabled={!plan.priceId || loading === plan.priceId}
                className={`w-full py-3 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 ${
                  plan.highlighted
                    ? "bg-neon/20 text-neon border border-neon/30 hover:bg-neon/30"
                    : plan.priceId
                    ? "bg-gunmetal/60 text-white border border-slate/40 hover:bg-slate/40"
                    : "bg-gunmetal/40 text-mercury border border-slate/40 cursor-default"
                } disabled:opacity-50`}
              >
                {loading === plan.priceId && <Loader2 className="w-4 h-4 animate-spin" />}
                {plan.cta}
              </button>
            </div>
          ))}
        </div>

        {/* FAQ */}
        <div className="mt-12 text-center">
          <p className="text-xs text-mercury">All plans include a 7-day free trial. Cancel anytime.</p>
          <Link href="/" className="text-xs text-electric hover:text-neon mt-2 inline-block">← Back to Dashboard</Link>
        </div>
      </div>
    </div>
  );
}
