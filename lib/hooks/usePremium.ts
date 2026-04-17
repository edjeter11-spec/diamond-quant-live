"use client";

import { useAuth } from "@/lib/supabase/auth";

// Single source of truth for "does this user see paid features".
// Admins always get premium. Otherwise the user_profiles.is_premium flag
// (set by the Stripe webhook) decides.
export function usePremium(): {
  isPremium: boolean;
  isAdmin: boolean;
  loading: boolean;
} {
  const { profile, loading, user } = useAuth();

  // Not logged in = not premium (free 3-picks experience)
  if (!user) return { isPremium: false, isAdmin: false, loading };
  const isAdmin = !!profile?.is_admin;
  const isPremium = isAdmin || !!(profile as any)?.is_premium;
  return { isPremium, isAdmin, loading };
}
