// Calls the standalone picks bot's internal API (see claude code/quant-picks-bot).
// NOTE: this is NOT `claude code/discord-bot` — that's the separate Claude Code
// Discord bridge bot and is unrelated to picks.
// The bot is a separate always-on process — not deployable on Vercel — so
// every admin publish/edit/retract/grade action reaches it over HTTP.

const BOT_API_URL = process.env.BOT_API_URL || "";
const BOT_API_SECRET = process.env.BOT_API_SECRET || "";

export interface ManualPick {
  id: string;
  sport: string;
  game?: string | null;
  market?: string | null;
  pick_text: string;
  units: number;
  confidence?: string | null;
  writeup?: string | null;
  status: "draft" | "published" | "retracted";
  result?: string | null;
  discord_channel_id?: string | null;
  discord_message_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

async function callBot(
  path: string,
  pick: ManualPick,
): Promise<{
  ok: boolean;
  channel_id?: string;
  message_id?: string;
  error?: string;
}> {
  if (!BOT_API_URL) return { ok: false, error: "BOT_API_URL not configured" };
  try {
    const res = await fetch(`${BOT_API_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bot-secret": BOT_API_SECRET,
      },
      body: JSON.stringify(pick),
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    if (!res.ok)
      return { ok: false, error: data?.error || `HTTP ${res.status}` };
    return data;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export const postPickToDiscord = (pick: ManualPick) =>
  callBot("/pick/post", pick);
export const editPickInDiscord = (pick: ManualPick) =>
  callBot("/pick/edit", pick);
export const retractPickInDiscord = (pick: ManualPick) =>
  callBot("/pick/retract", pick);
export const gradePickInDiscord = (pick: ManualPick) =>
  callBot("/pick/grade", pick);
