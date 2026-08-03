import { NextRequest, NextResponse } from "next/server";
import { cloudGet, cloudSet } from "@/lib/supabase/client";
import { getUserFromRequest, supabaseAdmin } from "@/lib/supabase/server-auth";
import { editPickInDiscord } from "@/lib/bot/discord-bridge";
import { etDateString } from "@/lib/sports-date";

export const dynamic = "force-dynamic";

// ──────────────────────────────────────────────────────────
// PLAYBOOK SLIP LINK (admin)
//
// Playbook's slip builder is reachable only through their website — the API
// behind it is gated by a key that ships in their own homepage JS, which isn't
// ours to use (see PLAYBOOK-PARTNER-REQUEST.md, where we've asked for our own).
//
// So the loop is: admin pastes today's parlay into playbookbot.com, copies the
// share link, and drops it here. The Discord post then carries a real one-tap
// betslip instead of a line the reader has to paste themselves.
//
// Stored per sport per ET day, so yesterday's link can never be attached to
// today's parlay — a stale slip would send someone to bets that already
// settled, which is worse than no link at all.
// ──────────────────────────────────────────────────────────

function keyFor(sport: string, slate: string) {
  return `playbook_link_${sport}_${slate}`;
}

interface StoredLink {
  url: string;
  savedAt: string;
  savedBy?: string;
}

/**
 * Only accept links that actually come from Playbook. A pasted URL goes into a
 * public Discord post, so an arbitrary string here would let a mistake — or a
 * compromised admin session — publish a link to anywhere.
 */
function isPlaybookUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    return (
      host === "playbookbot.com" ||
      host.endsWith(".playbookbot.com") ||
      host === "switchboard.actionnetwork.com"
    );
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user?.isAdmin)
    return NextResponse.json(
      { ok: false, error: "Admin only" },
      { status: 403 },
    );

  const { searchParams } = new URL(req.url);
  const sport = (searchParams.get("sport") ?? "mlb").toLowerCase();
  const slate = searchParams.get("slate") ?? etDateString();

  const stored = await cloudGet<StoredLink | null>(keyFor(sport, slate), null);
  return NextResponse.json({ ok: true, sport, slate, link: stored });
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user?.isAdmin)
    return NextResponse.json(
      { ok: false, error: "Admin only" },
      { status: 403 },
    );

  const body = await req.json().catch(() => ({}));
  const sport = String(body.sport ?? "mlb").toLowerCase();
  const slate = String(body.slate ?? etDateString());
  const url = String(body.url ?? "").trim();

  // Empty clears the link — a wrong slip should be removable, not just
  // overwritable.
  if (!url) {
    await cloudSet(keyFor(sport, slate), null);
    return NextResponse.json({ ok: true, cleared: true });
  }

  if (!isPlaybookUrl(url))
    return NextResponse.json(
      {
        ok: false,
        error:
          "Must be a playbookbot.com or switchboard.actionnetwork.com https link",
      },
      { status: 400 },
    );

  const stored: StoredLink = {
    url,
    savedAt: new Date().toISOString(),
    savedBy: user.email,
  };

  // Saving publishes. If today's parlay is already in Discord, edit that
  // message in place rather than waiting for the next cron tick — by then the
  // games have often started and the slip is worthless. Editing (not
  // re-posting) matters because people may already have the original message
  // open; a second post would compete with it.
  //
  // Pass ?post=false to save quietly without touching Discord.
  const shouldPost = new URL(req.url).searchParams.get("post") !== "false";
  let discord: any = { attempted: false };

  if (shouldPost && supabaseAdmin) {
    try {
      const parlayBatchKey = `${sport}_parlay_${slate}`;
      const { data: legs } = await supabaseAdmin
        .from("manual_picks")
        .select("pick_text, odds, discord_message_id, discord_channel_id")
        .eq("batch_key", parlayBatchKey)
        .eq("status", "published");

      const msgId = legs?.find(
        (l: any) => l.discord_message_id,
      )?.discord_message_id;

      if (!legs?.length || !msgId) {
        discord = {
          attempted: true,
          ok: false,
          reason: "Today's parlay hasn't posted to Discord yet",
        };
      } else {
        const lines = legs.map(
          (l: any, i: number) =>
            `**${i + 1}.** ${l.pick_text}${
              l.odds ? ` — ${Number(l.odds) > 0 ? "+" : ""}${l.odds}` : ""
            }`,
        );
        const res = await editPickInDiscord({
          id: parlayBatchKey,
          sport,
          game: "⚾ PARLAY OF THE DAY",
          market: `${legs.length}-Leg`,
          pick_text: lines.join("\n"),
          units: 1,
          confidence: "Lean",
          writeup:
            `**🎟️ One-tap betslip:** ${url}\n` +
            `_Opens Playbook with all ${legs.length} legs loaded — pick your book from there._`,
          status: "published",
          discord_message_id: msgId,
          discord_channel_id: legs.find((l: any) => l.discord_channel_id)
            ?.discord_channel_id,
        } as any);
        discord = { attempted: true, ok: res.ok, error: res.error };
      }
    } catch (e) {
      discord = { attempted: true, ok: false, error: String(e) };
    }
  }
  await cloudSet(keyFor(sport, slate), stored);
  return NextResponse.json({ ok: true, sport, slate, link: stored, discord });
}
