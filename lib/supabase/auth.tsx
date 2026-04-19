"use client";

// ──────────────────────────────────────────────────────────
// Auth Context — Supabase Auth with Google OAuth + email/password
// Provides user session, profile, preferences across the app
// ──────────────────────────────────────────────────────────

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { supabase } from "./client";
import type { User, Session } from "@supabase/supabase-js";

export interface UserProfile {
  id: string;
  display_name: string;
  avatar_url: string;
  email: string;
  is_admin: boolean;
  invite_code: string;
  invites_remaining: number;
  last_active: string;
  devices: Array<{ ua: string; last_seen: string }>;
  created_at: string;
}

export interface UserPreferences {
  default_sport: string;
  discord_webhook: string;
  push_enabled: boolean;
  push_min_confidence: string;
  email_daily_recap: boolean;
  theme: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  preferences: UserPreferences | null;
  loading: boolean;
  isAdmin: boolean;
  // Actions
  signInWithEmail: (email: string, password: string) => Promise<{ error: string | null }>;
  signUpWithEmail: (email: string, password: string, displayName: string, inviteCode?: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<UserProfile>) => Promise<void>;
  updatePreferences: (updates: Partial<UserPreferences>) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  profile: null,
  preferences: null,
  loading: true,
  isAdmin: false,
  signInWithEmail: async () => ({ error: "Not initialized" }),
  signUpWithEmail: async () => ({ error: "Not initialized" }),
  signInWithGoogle: async () => ({ error: "Not initialized" }),
  signOut: async () => {},
  updateProfile: async () => {},
  updatePreferences: async () => {},
  refreshProfile: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch profile + preferences (with retry for new signups where trigger hasn't finished)
  const fetchProfile = useCallback(async (userId: string, attempt = 0) => {
    if (!supabase) return;
    try {
      const [profileRes, prefsRes] = await Promise.all([
        supabase.from("user_profiles").select("*").eq("id", userId).single(),
        supabase.from("user_preferences").select("*").eq("user_id", userId).single(),
      ]);

      // Profile might not exist yet if the trigger is still running (new signup)
      if (!profileRes.data && attempt < 3) {
        setTimeout(() => fetchProfile(userId, attempt + 1), 1000);
        return;
      }

      if (profileRes.data) setProfile(profileRes.data as UserProfile);
      if (prefsRes.data) setPreferences(prefsRes.data as UserPreferences);

      // Update last_active + device info
      if (profileRes.data) {
        const ua = typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 80) : "unknown";
        await supabase.from("user_profiles").update({
          last_active: new Date().toISOString(),
          devices: [{ ua, last_seen: new Date().toISOString() }],
        }).eq("id", userId);
      }
    } catch {}
  }, []);

  // Listen for auth changes
  // Fire the complimentary-access check once per session — no-op unless
  // the user's email is in COMP_ACCESS_EMAILS (server-side env list).
  const ensureComp = useCallback(async (accessToken: string | undefined) => {
    if (!accessToken) return;
    try {
      const res = await fetch("/api/auth/ensure-comp", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (data?.compGranted && !data?.alreadySet && user) {
        // Refresh profile so is_admin/is_premium propagate immediately
        fetchProfile(user.id);
      }
    } catch {}
  }, [fetchProfile, user]);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) { fetchProfile(s.user.id); ensureComp(s.access_token); }
      setLoading(false);
    });

    // Subscribe to changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) { fetchProfile(s.user.id); ensureComp(s?.access_token); }
      else { setProfile(null); setPreferences(null); }
    });

    return () => subscription.unsubscribe();
  }, [fetchProfile, ensureComp]);

  // ── Sign in with email/password ──
  const signInWithEmail = useCallback(async (email: string, password: string) => {
    if (!supabase) return { error: "Supabase not configured" };
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }, []);

  // ── Sign up with email/password ──
  const signUpWithEmail = useCallback(async (email: string, password: string, displayName: string, inviteCode?: string) => {
    if (!supabase) return { error: "Supabase not configured" };

    // Validate invite code if provided
    if (inviteCode) {
      const { data: invite } = await supabase
        .from("invites")
        .select("*")
        .eq("code", inviteCode.toUpperCase())
        .is("used_by", null)
        .single();
      if (!invite) return { error: "Invalid or already used invite code" };
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: displayName } },
    });
    if (error) return { error: error.message };

    // Claim invite code
    if (inviteCode && data.user) {
      await supabase.from("invites").update({
        used_by: data.user.id,
        used_at: new Date().toISOString(),
      }).eq("code", inviteCode.toUpperCase());
    }

    return { error: null };
  }, []);

  // ── Google OAuth ──
  const signInWithGoogle = useCallback(async () => {
    if (!supabase) return { error: "Supabase not configured" };
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: typeof window !== "undefined" ? `${window.location.origin}/` : undefined,
      },
    });
    return { error: error?.message ?? null };
  }, []);

  // ── Sign out ──
  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setProfile(null);
    setPreferences(null);
  }, []);

  // ── Update profile ──
  const updateProfile = useCallback(async (updates: Partial<UserProfile>) => {
    if (!supabase || !user) return;
    const { data } = await supabase
      .from("user_profiles")
      .update(updates)
      .eq("id", user.id)
      .select()
      .single();
    if (data) setProfile(data as UserProfile);
  }, [user]);

  // ── Update preferences ──
  const updatePreferences = useCallback(async (updates: Partial<UserPreferences>) => {
    if (!supabase || !user) return;
    const { data } = await supabase
      .from("user_preferences")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .select()
      .single();
    if (data) setPreferences(data as UserPreferences);
  }, [user]);

  const refreshProfile = useCallback(async () => {
    if (user) await fetchProfile(user.id);
  }, [user, fetchProfile]);

  return (
    <AuthContext.Provider value={{
      user, session, profile, preferences, loading,
      isAdmin: profile?.is_admin ?? false,
      signInWithEmail, signUpWithEmail, signInWithGoogle, signOut,
      updateProfile, updatePreferences, refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
