import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest, supabaseAdmin } from "@/lib/supabase/server-auth";

export const dynamic = "force-dynamic";

// GET — list picks (most recent first) for the admin picks dashboard.
export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user)
    return NextResponse.json(
      { ok: false, error: "Auth required" },
      { status: 401 },
    );
  if (!user.isAdmin)
    return NextResponse.json(
      { ok: false, error: "Admin only" },
      { status: 403 },
    );
  if (!supabaseAdmin)
    return NextResponse.json(
      { ok: false, error: "Server not configured" },
      { status: 500 },
    );

  const { data, error } = await supabaseAdmin
    .from("manual_picks")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error)
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );

  return NextResponse.json({ ok: true, picks: data ?? [] });
}

// POST — create a new draft pick.
export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user)
    return NextResponse.json(
      { ok: false, error: "Auth required" },
      { status: 401 },
    );
  if (!user.isAdmin)
    return NextResponse.json(
      { ok: false, error: "Admin only" },
      { status: 403 },
    );
  if (!supabaseAdmin)
    return NextResponse.json(
      { ok: false, error: "Server not configured" },
      { status: 500 },
    );

  const body = await req.json().catch(() => null);
  if (!body?.sport || !body?.pick_text) {
    return NextResponse.json(
      { ok: false, error: "sport and pick_text are required" },
      { status: 400 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("manual_picks")
    .insert({
      created_by: user.id,
      sport: body.sport,
      game: body.game ?? null,
      market: body.market ?? null,
      pick_text: body.pick_text,
      units: body.units ?? 1,
      confidence: body.confidence ?? null,
      writeup: body.writeup ?? null,
      status: "draft",
    })
    .select()
    .single();

  if (error)
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );

  return NextResponse.json({ ok: true, pick: data });
}
