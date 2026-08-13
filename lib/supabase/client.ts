// ──────────────────────────────────────────────────────────
// Supabase Client + Cloud Sync Layer
// Syncs brain, bets, picks, bankroll to the cloud
// Falls back to localStorage if Supabase is unavailable
// ──────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";

// Sanitize every env read at module scope. Vercel's env store on this project
// has historically kept trailing `\n` characters in copy-pasted values (see
// project memory `project_f1cardvault_env_newline.md`). Server scripts
// already strip; the client bundle did not — a raw
// `https://grbswzfizblkekrzhadw.supabase.co\n` shipped, every browser fetch
// resolved to an invalid hostname, and the whole personalized surface
// (profile, isAdmin, isPremium) silently failed. That's exactly the "nothing
// is loading" report from the user tonight.
//
// Both TRIM and internal-`\n` strip: a token can contain any whitespace that
// leaked from the env editor, and none of it belongs in a URL/API-key value.
const cleanEnv = (v: string | undefined): string =>
  (v ?? "").replace(/[\r\n\t]+/g, "").trim();

const SUPABASE_URL = cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL);
const SUPABASE_KEY = cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const SERVICE_KEY = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);

// The Supabase JS SDK's default fetch has no timeout — when the DB/schema
// cache is degraded (observed: "PGRST002 ... Retrying" looping) a single
// query can hang for minutes with nothing upstream able to bound it. This
// wraps every request the SDK makes in a hard timeout so callers' own
// try/catch (cloudGet/cloudSet already have one) actually gets a chance to
// fall back instead of hanging the whole route.
//
// Timeouts differ by environment: the client (browser) has a longer window
// so a cold Vercel region + first user_profiles read of the session doesn't
// silently abort and leave the user looking logged-out. Server routes keep
// the tighter 8s — those must fail fast to give cron/publish paths room.
// The old shared 8s ate the user's profile call on every cold visit.
function timeoutFetch(timeoutMs: number): typeof fetch {
  return (input, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(input, { ...init, signal: controller.signal }).finally(() =>
      clearTimeout(timer),
    );
  };
}

const CLIENT_TIMEOUT_MS = 15000;
const SERVER_TIMEOUT_MS = 8000;

export const supabase =
  SUPABASE_URL && SUPABASE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_KEY, {
        global: { fetch: timeoutFetch(CLIENT_TIMEOUT_MS) },
      })
    : null;

// Server-side admin client — bypasses RLS. Use for trusted writes from API
// routes/cron. Falls back to the anon client if SERVICE_KEY isn't set, so
// the surface stays the same (just RLS-restricted).
const supabaseWriter =
  typeof window === "undefined" && SUPABASE_URL && SERVICE_KEY
    ? createClient(SUPABASE_URL, SERVICE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: timeoutFetch(SERVER_TIMEOUT_MS) },
      })
    : supabase;

// Key-value store using a single "app_state" table
// This avoids needing to create complex table schemas
// Each key stores a JSON blob

const TABLE = "app_state";

// ── Read from cloud (fall back to localStorage) ──

export async function cloudGet<T>(
  key: string,
  fallback: T,
  validate?: (v: any) => boolean,
): Promise<T> {
  // Try Supabase first
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from(TABLE)
        .select("value")
        .eq("key", key)
        .single();

      if (data && !error && (!validate || validate(data.value))) {
        return data.value as T;
      }
    } catch {}
  }

  // Fall back to localStorage
  if (typeof window === "undefined") return fallback;
  try {
    const stored = localStorage.getItem(`dq_${key}`);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (!validate || validate(parsed)) return parsed;
      localStorage.removeItem(`dq_${key}`); // self-heal corrupt key
    }
  } catch {
    try {
      localStorage.removeItem(`dq_${key}`);
    } catch {}
  }

  return fallback;
}

// ── Write to cloud + localStorage ──

export async function cloudSet(
  key: string,
  value: any,
): Promise<{ ok: boolean; error?: string }> {
  // Always write to localStorage as backup
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(`dq_${key}`, JSON.stringify(value));
    } catch {}
  }

  // Write to Supabase using the writer client (admin server-side, anon client-side)
  const writer = supabaseWriter ?? supabase;
  if (!writer) return { ok: false, error: "no supabase client" };

  try {
    const { error } = await writer
      .from(TABLE)
      .upsert(
        { key, value, updated_at: new Date().toISOString() },
        { onConflict: "key" },
      );

    if (error) {
      // Table might not exist yet — try to create it
      if (error.code === "42P01" || error.message?.includes("does not exist")) {
        await createTable();
        const retry = await writer
          .from(TABLE)
          .upsert(
            { key, value, updated_at: new Date().toISOString() },
            { onConflict: "key" },
          );
        if (retry.error) {
          console.error(
            `[cloudSet] retry failed for "${key}":`,
            retry.error.message,
          );
          return { ok: false, error: retry.error.message };
        }
        return { ok: true };
      }
      console.error(
        `[cloudSet] upsert failed for "${key}":`,
        error.message,
        error.code,
      );
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e: any) {
    console.error(`[cloudSet] exception for "${key}":`, e?.message ?? e);
    return { ok: false, error: e?.message ?? String(e) };
  }
}

// ── Create the table if it doesn't exist ──

async function createTable() {
  if (!supabase) return;
  // We can't create tables via the REST API directly
  // The user needs to create it via the Supabase dashboard
  console.warn(
    "[DQ] Supabase table 'app_state' not found. " +
      "Please go to your Supabase dashboard → SQL Editor and run:\n" +
      "CREATE TABLE app_state (key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMPTZ DEFAULT NOW());\n" +
      "ALTER TABLE app_state ENABLE ROW LEVEL SECURITY;\n" +
      'CREATE POLICY "Allow all" ON app_state FOR ALL USING (true) WITH CHECK (true);',
  );
}

// ── Check if Supabase is connected ──

export async function isCloudConnected(): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await supabase.from(TABLE).select("key").limit(1);
    return !error;
  } catch {
    return false;
  }
}
