import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest, supabaseAdmin } from "@/lib/supabase/server-auth";
import { postPickToDiscord } from "@/lib/bot/discord-bridge";

export const dynamic = "force-dynamic";

// POST — flip a draft pick live and post it to Discord with sportsbook
// buttons. Stores the returned message_id/channel_id so future edits,
// retracts, and grades can update this same message instead of reposting.
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

  if (pick.status === "published") {
    return NextResponse.json(
      { ok: false, error: "Already published" },
      { status: 409 },
    );
  }

  const discordResult = await postPickToDiscord({
    ...pick,
    status: "published",
  });
  if (!discordResult.ok) {
    return NextResponse.json(
      { ok: false, error: `Discord post failed: ${discordResult.error}` },
      { status: 502 },
    );
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("manual_picks")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      discord_channel_id: discordResult.channel_id,
      discord_message_id: discordResult.message_id,
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
