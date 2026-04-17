import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, getUserFromRequest, isAllowedOrigin } from "@/lib/supabase/server-auth";

function generateSlipId(): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let id = "";
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

// Validate the shape of a single pick — reject anything malformed
function validatePick(p: any): boolean {
  if (!p || typeof p !== "object") return false;
  if (typeof p.pick !== "string" || p.pick.length === 0 || p.pick.length > 200) return false;
  if (typeof p.game !== "string" || p.game.length > 200) return false;
  if (typeof p.odds !== "number" || !Number.isFinite(p.odds) || Math.abs(p.odds) > 100000) return false;
  if (p.bookmaker && (typeof p.bookmaker !== "string" || p.bookmaker.length > 60)) return false;
  return true;
}

export async function POST(req: NextRequest) {
  if (!isAllowedOrigin(req)) {
    return NextResponse.json({ error: "Forbidden origin" }, { status: 403 });
  }
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  try {
    const body = await req.json();
    const { picks, totalOdds, stake } = body;

    if (!picks || !Array.isArray(picks) || picks.length === 0 || picks.length > 12) {
      return NextResponse.json({ error: "1-12 picks required" }, { status: 400 });
    }
    if (!picks.every(validatePick)) {
      return NextResponse.json({ error: "Invalid pick data" }, { status: 400 });
    }
    if (totalOdds != null && (typeof totalOdds !== "number" || !Number.isFinite(totalOdds))) {
      return NextResponse.json({ error: "Invalid totalOdds" }, { status: 400 });
    }
    if (stake != null && (typeof stake !== "number" || !Number.isFinite(stake) || stake < 0 || stake > 1000000)) {
      return NextResponse.json({ error: "Invalid stake" }, { status: 400 });
    }

    // Bind user_id to the authenticated session — never trust client-supplied userId.
    // Anonymous shares allowed (user_id = null).
    const user = await getUserFromRequest(req);
    const userId = user?.id ?? null;

    // displayName comes from server-side profile if authed, else "Anonymous"
    let displayName = "Anonymous";
    if (user) {
      const { data: profile } = await supabaseAdmin
        .from("user_profiles")
        .select("display_name")
        .eq("id", user.id)
        .single();
      if (profile?.display_name) displayName = String(profile.display_name).slice(0, 40);
    }

    const id = generateSlipId();
    const { error } = await supabaseAdmin.from("shared_slips").insert({
      id,
      user_id: userId,
      slip_data: {
        picks,
        totalOdds,
        stake,
        sharedBy: displayName,
        sharedAt: new Date().toISOString(),
      },
      reactions: {},
      views: 0,
    });

    if (error) {
      console.error("share slip insert error:", error);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    return NextResponse.json({ id, url: `/slip/${id}` });
  } catch (e: any) {
    console.error("share slip exception:", e);
    return NextResponse.json({ error: "Failed to share slip" }, { status: 500 });
  }
}
