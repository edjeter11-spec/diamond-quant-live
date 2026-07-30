import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest, supabaseAdmin } from "@/lib/supabase/server-auth";
import { gradePickInDiscord } from "@/lib/bot/discord-bridge";

export const dynamic = "force-dynamic";

const VALID_RESULTS = new Set(["win", "loss", "push", "void"]);

// POST — settle a published pick (win/loss/push/void). Edits the original
// Discord message to show the result instead of posting a new one.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body?.result || !VALID_RESULTS.has(body.result)) {
    return NextResponse.json(
      { ok: false, error: "result must be one of win/loss/push/void" },
      { status: 400 },
    );
  }

  const { data: pick, error: fetchError } = await supabaseAdmin
    .from("manual_picks")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchError || !pick)
    return NextResponse.json(
      { ok: false, error: "Pick not found" },
      { status: 404 },
    );

  const graded = { ...pick, result: body.result };

  if (pick.discord_message_id) {
    const discordResult = await gradePickInDiscord(graded);
    if (!discordResult.ok) {
      return NextResponse.json(
        { ok: false, error: `Discord grade failed: ${discordResult.error}` },
        { status: 502 },
      );
    }
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("manual_picks")
    .update({
      result: body.result,
      settled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (updateError)
    return NextResponse.json(
      { ok: false, error: updateError.message },
      { status: 500 },
    );

  return NextResponse.json({ ok: true, pick: updated });
}
