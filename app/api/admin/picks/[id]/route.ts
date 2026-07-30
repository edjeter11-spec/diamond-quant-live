import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest, supabaseAdmin } from "@/lib/supabase/server-auth";
import { editPickInDiscord } from "@/lib/bot/discord-bridge";

export const dynamic = "force-dynamic";

async function requireAdmin(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user)
    return {
      error: NextResponse.json(
        { ok: false, error: "Auth required" },
        { status: 401 },
      ),
    };
  if (!user.isAdmin)
    return {
      error: NextResponse.json(
        { ok: false, error: "Admin only" },
        { status: 403 },
      ),
    };
  return { user };
}

// PATCH — edit a pick's fields. If it's already published, also push the
// edit into the live Discord message (same message_id, no repost).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdmin(req);
  if (error) return error;
  if (!supabaseAdmin)
    return NextResponse.json(
      { ok: false, error: "Server not configured" },
      { status: 500 },
    );

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body)
    return NextResponse.json(
      { ok: false, error: "Invalid body" },
      { status: 400 },
    );

  const updates: Record<string, any> = {};
  for (const key of [
    "sport",
    "game",
    "market",
    "pick_text",
    "units",
    "confidence",
    "writeup",
  ]) {
    if (key in body) updates[key] = body[key];
  }
  updates.updated_at = new Date().toISOString();

  const { data, error: dbError } = await supabaseAdmin
    .from("manual_picks")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (dbError || !data)
    return NextResponse.json(
      { ok: false, error: dbError?.message ?? "Not found" },
      { status: 404 },
    );

  if (data.status === "published") {
    const result = await editPickInDiscord(data);
    if (!result.ok) {
      return NextResponse.json({
        ok: true,
        pick: data,
        discordWarning: result.error,
      });
    }
  }

  return NextResponse.json({ ok: true, pick: data });
}

// DELETE — hard delete. Only sensible for picks still in draft; published
// picks should be retracted (see /retract), not deleted, so the Discord
// message stays honest rather than orphaned.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdmin(req);
  if (error) return error;
  if (!supabaseAdmin)
    return NextResponse.json(
      { ok: false, error: "Server not configured" },
      { status: 500 },
    );

  const { id } = await params;
  const { data: existing } = await supabaseAdmin
    .from("manual_picks")
    .select("status")
    .eq("id", id)
    .single();

  if (existing?.status === "published") {
    return NextResponse.json(
      { ok: false, error: "Retract the pick before deleting it" },
      { status: 409 },
    );
  }

  const { error: dbError } = await supabaseAdmin
    .from("manual_picks")
    .delete()
    .eq("id", id);
  if (dbError)
    return NextResponse.json(
      { ok: false, error: dbError.message },
      { status: 500 },
    );

  return NextResponse.json({ ok: true });
}
