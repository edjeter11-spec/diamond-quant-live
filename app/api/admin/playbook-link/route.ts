import { NextRequest, NextResponse } from "next/server";
import { cloudGet, cloudSet } from "@/lib/supabase/client";
import { getUserFromRequest } from "@/lib/supabase/server-auth";
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
  await cloudSet(keyFor(sport, slate), stored);
  return NextResponse.json({ ok: true, sport, slate, link: stored });
}
