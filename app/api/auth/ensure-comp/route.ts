// ──────────────────────────────────────────────────────────
// Ensure Complimentary Access
//
// Called client-side after auth. If the signed-in user's email is in
// COMP_ACCESS_EMAILS (server-only env), flips is_admin + is_premium
// to true. Idempotent — no-op when already granted.
// ──────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { getUserFromRequest, supabaseAdmin } from "@/lib/supabase/server-auth";

export const dynamic = "force-dynamic";

function compEmails(): string[] {
  const raw = process.env.COMP_ACCESS_EMAILS ?? "";
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false, error: "Server misconfigured" }, { status: 500 });

  const allow = compEmails();
  const email = (user.email ?? "").toLowerCase();
  if (!email || !allow.includes(email)) {
    return NextResponse.json({ ok: true, compGranted: false });
  }

  // Check if already flagged — avoid a no-op write
  const { data: profile } = await supabaseAdmin
    .from("user_profiles")
    .select("is_admin,is_premium")
    .eq("id", user.id)
    .single();

  if (profile?.is_admin && (profile as any)?.is_premium) {
    return NextResponse.json({ ok: true, compGranted: true, alreadySet: true });
  }

  const { error } = await supabaseAdmin
    .from("user_profiles")
    .update({
      is_admin: true,
      is_premium: true,
      subscription_status: "comp",
    })
    .eq("id", user.id);

  if (error) {
    console.error("comp grant error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, compGranted: true });
}
