// Server-side auth helpers for API routes.
// Verifies the user's JWT from the Authorization header against Supabase.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Service-role client for trusted server-side operations (bypasses RLS).
// Falls back to anon key if SERVICE_ROLE not configured (less secure but works).
export const supabaseAdmin = SUPABASE_URL
  ? createClient(SUPABASE_URL, SERVICE_KEY || SUPABASE_ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

export interface AuthedUser {
  id: string;
  email?: string;
  isAdmin: boolean;
}

/**
 * Extracts and validates the user from the request.
 * Returns null if no valid session.
 *
 * Client must send: Authorization: Bearer <access_token>
 * (Supabase access token from session.access_token)
 */
export async function getUserFromRequest(req: Request): Promise<AuthedUser | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON) return null;

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  if (!token || token.length < 20) return null;

  // Use a per-request client so we can verify the token
  const client = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user) return null;

    // Fetch admin flag from user_profiles (small query, cached by Supabase)
    let isAdmin = false;
    if (supabaseAdmin) {
      const { data: profile } = await supabaseAdmin
        .from("user_profiles")
        .select("is_admin")
        .eq("id", data.user.id)
        .single();
      isAdmin = !!profile?.is_admin;
    }

    return { id: data.user.id, email: data.user.email, isAdmin };
  } catch {
    return null;
  }
}

/**
 * Origin allow-list — blocks calls from unauthorized referrers.
 * Useful for endpoints that should only be called from our own UI.
 */
export function isAllowedOrigin(req: Request): boolean {
  const origin = req.headers.get("origin") ?? req.headers.get("referer") ?? "";
  if (!origin) return true; // server-to-server / cron / curl → allow
  const allowed = [
    "https://diamond-quant-live.vercel.app",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ];
  return allowed.some((a) => origin.startsWith(a));
}
