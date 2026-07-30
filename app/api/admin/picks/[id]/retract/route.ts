import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest, supabaseAdmin } from "@/lib/supabase/server-auth";
import { retractPickInDiscord } from "@/lib/bot/discord-bridge";

export const dynamic = "force-dynamic";

// POST — undo a publish. Flips status back off "published" and edits the
// live Discord message to a visibly dead/struck-through state rather than
// deleting it, since people may have already clicked a sportsbook button.
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

  if (pick.discord_message_id) {
    const discordResult = await retractPickInDiscord({
      ...pick,
      status: "retracted",
    });
    if (!discordResult.ok) {
      return NextResponse.json(
        { ok: false, error: `Discord retract failed: ${discordResult.error}` },
        { status: 502 },
      );
    }
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("manual_picks")
    .update({
      status: "retracted",
      retracted_at: new Date().toISOString(),
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
