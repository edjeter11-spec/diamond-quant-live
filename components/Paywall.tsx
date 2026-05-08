"use client";

import { useAuth } from "@/lib/supabase/auth";
import { Lock, Crown, Sparkles, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import AuthModal from "./auth/AuthModal";

interface PaywallProps {
  feature: string;
  description: string;
  children?: React.ReactNode;
  variant?: "blur" | "replace";
}

/**
 * Wraps content behind a Stripe paywall.
 * - Premium users + admins see the children directly
 * - Non-signed-in users see a sign-up CTA
 * - Free users see an upgrade CTA with optional blurred preview
 */
export default function Paywall({ feature, description, children, variant = "replace" }: PaywallProps) {
  const { user, profile, loading } = useAuth();
  const [showAuth, setShowAuth] = useState(false);

  // Loading auth state — show children without flicker (will hide if non-pro)
  if (loading) return <>{children}</>;

  const isPro = profile?.is_premium || profile?.is_admin;

  // Premium / admin → show real content
  if (isPro) return <>{children}</>;

  // Build the gate UI
  const gate = (
    <div className="glass rounded-xl border border-gold/30 bg-gradient-to-br from-gold/5 via-electric/5 to-purple/5 p-6 text-center space-y-4">
      <div className="w-12 h-12 mx-auto rounded-full bg-gold/15 border border-gold/30 flex items-center justify-center">
        {user ? <Crown className="w-6 h-6 text-gold" /> : <Lock className="w-6 h-6 text-gold" />}
      </div>
      <div>
        <h3 className="text-lg font-bold text-silver mb-1">{feature}</h3>
        <p className="text-xs text-mercury/70 leading-relaxed max-w-sm mx-auto">{description}</p>
      </div>
      <div className="flex flex-col gap-2 max-w-xs mx-auto">
        {user ? (
          <Link
            href="/pricing"
            className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-gold text-bunker text-sm font-bold hover:bg-gold/90 transition-all"
          >
            <Sparkles className="w-4 h-4" />
            Upgrade to Pro — $15/mo
            <ArrowRight className="w-4 h-4" />
          </Link>
        ) : (
          <>
            <button
              onClick={() => setShowAuth(true)}
              className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-electric text-bunker text-sm font-bold hover:bg-electric/90 transition-all"
            >
              Sign Up Free
              <ArrowRight className="w-4 h-4" />
            </button>
            <Link
              href="/pricing"
              className="text-[11px] text-mercury/60 hover:text-silver transition-colors"
            >
              See plans →
            </Link>
          </>
        )}
        <p className="text-[10px] text-mercury/40 mt-1">7-day free trial · cancel anytime</p>
      </div>
      {showAuth && <AuthModal isOpen={showAuth} onClose={() => setShowAuth(false)} />}
    </div>
  );

  // Blur variant: show children blurred behind the gate
  if (variant === "blur" && children) {
    return (
      <div className="relative">
        <div className="blur-md pointer-events-none select-none opacity-40">{children}</div>
        <div className="absolute inset-0 flex items-center justify-center p-4">{gate}</div>
      </div>
    );
  }

  // Replace variant: just show the gate
  return gate;
}

/**
 * Inline mini-CTA — for use within a feature where you want to show
 * "X more locked, upgrade for full list"
 */
export function PaywallInline({ remaining }: { remaining: number }) {
  const { profile } = useAuth();
  if (profile?.is_premium || profile?.is_admin) return null;
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gradient-to-r from-gold/10 to-electric/5 border border-gold/25">
      <Crown className="w-4 h-4 text-gold flex-shrink-0" />
      <p className="text-xs text-silver flex-1">
        <span className="font-bold">+{remaining} more picks</span> locked.{" "}
        <span className="text-mercury/70">Upgrade to Pro for the full list.</span>
      </p>
      <Link
        href="/pricing"
        className="px-3 py-1.5 rounded-lg bg-gold text-bunker text-[11px] font-bold hover:bg-gold/90 transition-all flex-shrink-0"
      >
        Unlock
      </Link>
    </div>
  );
}
