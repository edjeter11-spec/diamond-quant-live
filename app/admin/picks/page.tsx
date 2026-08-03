"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/supabase/auth";
import { supabase } from "@/lib/supabase/client";
import {
  Shield,
  ArrowLeft,
  RefreshCw,
  Send,
  Undo2,
  Trophy,
  Plus,
} from "lucide-react";
import Link from "next/link";

interface ManualPick {
  id: string;
  sport: string;
  game: string | null;
  market: string | null;
  pick_text: string;
  units: number;
  confidence: string | null;
  writeup: string | null;
  status: "draft" | "published" | "retracted";
  result: string | null;
  created_at: string;
}

const SPORTS = ["mlb", "nba", "nfl", "nhl"] as const;

const STATUS_COLOR: Record<string, string> = {
  draft: "#8e9ab5",
  published: "#2ee6a6",
  retracted: "#ff5c7a",
};

async function authedFetch(path: string, opts: RequestInit = {}) {
  const { data } = await supabase!.auth.getSession();
  const token = data.session?.access_token;
  return fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
}

export default function AdminPicksPage() {
  const { isAdmin, loading: authLoading } = useAuth();
  const [picks, setPicks] = useState<ManualPick[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Playbook slip link ──
  // Their slip builder is only reachable through their website (the API behind
  // it uses a key that ships in their own JS, which isn't ours to use — see
  // PLAYBOOK-PARTNER-REQUEST.md). So the admin pastes today's parlay there,
  // copies the share link, and drops it here; the Discord post then carries a
  // real one-tap betslip instead of a line the reader has to paste themselves.
  const [pbText, setPbText] = useState("");
  const [pbLink, setPbLink] = useState("");
  const [pbSaved, setPbSaved] = useState<string | null>(null);
  const [pbBusy, setPbBusy] = useState(false);
  const [pbMsg, setPbMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [form, setForm] = useState({
    sport: "mlb",
    game: "",
    market: "",
    pick_text: "",
    units: 1,
    confidence: "Lean",
    writeup: "",
  });

  const load = useCallback(async () => {
    if (!isAdmin || !supabase) return;
    setLoading(true);
    const res = await authedFetch("/api/admin/picks");
    const data = await res.json();
    if (data.ok) setPicks(data.picks);
    setLoading(false);
  }, [isAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  async function createPick(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.pick_text.trim()) return;
    const res = await authedFetch("/api/admin/picks", {
      method: "POST",
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!data.ok) {
      setError(data.error ?? "Failed to create pick");
      return;
    }
    setForm({ ...form, game: "", market: "", pick_text: "", writeup: "" });
    load();
  }

  async function doAction(
    id: string,
    action: "publish" | "retract",
    extra?: any,
  ) {
    setBusyId(id);
    setError(null);
    const res = await authedFetch(`/api/admin/picks/${id}/${action}`, {
      method: "POST",
      body: extra ? JSON.stringify(extra) : undefined,
    });
    const data = await res.json();
    if (!data.ok) setError(data.error ?? `Failed to ${action}`);
    await load();
    setBusyId(null);
  }

  // Load today's parlay text + any link already saved, so the panel shows the
  // current state rather than an empty box that looks like nothing is set.
  const loadPlaybook = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const [p, l] = await Promise.all([
        fetch("/api/parlay-today?sport=mlb").then((r) => r.json()),
        authedFetch("/api/admin/playbook-link?sport=mlb").then((r) => r.json()),
      ]);
      setPbText(
        p?.playbookText ??
          (p?.legs ?? []).map((x: any) => x.pick).join(", ") ??
          "",
      );
      setPbSaved(l?.link?.url ?? null);
      setPbLink(l?.link?.url ?? "");
    } catch {
      /* panel just stays empty — not worth an error banner */
    }
  }, [isAdmin]);

  useEffect(() => {
    loadPlaybook();
  }, [loadPlaybook]);

  async function savePlaybookLink(clear = false) {
    setPbBusy(true);
    setPbMsg(null);
    const res = await authedFetch("/api/admin/playbook-link", {
      method: "POST",
      body: JSON.stringify({ sport: "mlb", url: clear ? "" : pbLink.trim() }),
    });
    const d = await res.json();
    if (!d.ok) {
      setPbMsg(d.error ?? "Failed to save");
    } else {
      setPbSaved(clear ? null : (d.link?.url ?? null));
      if (clear) setPbLink("");
      setPbMsg(clear ? "Cleared" : "Saved — next Discord post will use it");
    }
    setPbBusy(false);
  }

  async function gradePick(id: string, result: string) {
    setBusyId(id);
    setError(null);
    const res = await authedFetch(`/api/admin/picks/${id}/grade`, {
      method: "POST",
      body: JSON.stringify({ result }),
    });
    const data = await res.json();
    if (!data.ok) setError(data.error ?? "Failed to grade");
    await load();
    setBusyId(null);
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#05070d] flex items-center justify-center">
        <RefreshCw className="w-6 h-6 text-[#8e9ab5] animate-spin" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[#05070d] flex items-center justify-center text-center px-4">
        <div>
          <Shield className="w-10 h-10 text-[#ff5c7a]/30 mx-auto mb-3" />
          <p className="text-sm text-[#ff5c7a] font-semibold">Access Denied</p>
          <p className="text-xs text-[#8e9ab5] mt-1">
            Admin privileges required
          </p>
          <Link href="/" className="text-xs text-[#4cc9ff] mt-3 inline-block">
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#05070d] text-[#e6eaf4]">
      <div className="max-w-3xl mx-auto px-4 pt-6 pb-16">
        <div className="flex items-center gap-3 mb-6">
          <Link
            href="/admin"
            className="p-2 rounded-lg hover:bg-[#121727] transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-[#8e9ab5]" />
          </Link>
          <Send className="w-7 h-7 text-[#4cc9ff]" />
          <div>
            <h1 className="text-xl font-bold text-white">Create Pick</h1>
            <p className="text-xs text-[#8e9ab5] font-mono">
              WEBSITE → DISCORD PUBLISHING
            </p>
          </div>
          <button
            onClick={load}
            className="ml-auto p-2 rounded-lg hover:bg-[#121727] transition-colors"
          >
            <RefreshCw
              className={`w-4 h-4 text-[#8e9ab5] ${loading ? "animate-spin" : ""}`}
            />
          </button>
        </div>

        {/* ── Playbook one-tap betslip ── */}
        <div className="mb-6 rounded-xl border border-[#f59e0b]/25 bg-[#f59e0b]/[0.04] p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-base">🎟️</span>
            <h2 className="text-sm font-bold text-white">
              Playbook betslip link
            </h2>
            {pbSaved ? (
              <span className="ml-auto px-2 py-0.5 rounded bg-[#2ee6a6]/15 text-[#2ee6a6] text-[10px] font-bold">
                SET FOR TODAY
              </span>
            ) : (
              <span className="ml-auto px-2 py-0.5 rounded bg-[#8e9ab5]/15 text-[#8e9ab5] text-[10px] font-bold">
                NOT SET
              </span>
            )}
          </div>
          <p className="text-[11px] text-[#8e9ab5] mb-3 leading-snug">
            Paste the legs into playbookbot.com, copy the share link, drop it
            here. The daily parlay post uses it as a one-tap betslip. Without
            one it falls back to the copy-paste line, so this is optional.
          </p>

          {/* Step 1 — the exact string that builds the slip */}
          <label className="block text-[10px] uppercase tracking-wide text-[#8e9ab5] mb-1">
            1 · Today&apos;s legs
          </label>
          <div className="flex gap-2 mb-3">
            <code className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-[#0b0f1a] border border-[#1b2235] text-[11px] text-[#e6eaf4] font-mono overflow-x-auto whitespace-nowrap">
              {pbText || "No parlay built yet today"}
            </code>
            <button
              type="button"
              disabled={!pbText}
              onClick={() => {
                navigator.clipboard.writeText(pbText).then(
                  () => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1800);
                  },
                  () =>
                    setPbMsg("Clipboard blocked — select and copy manually"),
                );
              }}
              className="px-3 rounded-lg bg-[#1b2235] hover:bg-[#243049] disabled:opacity-40 text-xs font-semibold text-white whitespace-nowrap transition-colors"
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <a
              href="https://playbookbot.com"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-2 rounded-lg bg-[#f59e0b]/15 hover:bg-[#f59e0b]/25 text-xs font-semibold text-[#f59e0b] whitespace-nowrap transition-colors"
            >
              Open ↗
            </a>
          </div>

          {/* Step 2 — the link back */}
          <label className="block text-[10px] uppercase tracking-wide text-[#8e9ab5] mb-1">
            2 · Paste the share link
          </label>
          <div className="flex gap-2">
            <input
              value={pbLink}
              onChange={(e) => setPbLink(e.target.value)}
              placeholder="https://playbookbot.com/books/..."
              className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-[#0b0f1a] border border-[#1b2235] text-xs text-[#e6eaf4] font-mono placeholder:text-[#4a5670] focus:outline-none focus:border-[#4cc9ff]/50"
            />
            <button
              type="button"
              disabled={pbBusy || !pbLink.trim()}
              onClick={() => savePlaybookLink(false)}
              className="px-4 rounded-lg bg-[#4cc9ff] hover:bg-[#6fd5ff] disabled:opacity-40 text-xs font-bold text-[#05070d] whitespace-nowrap transition-colors"
            >
              {pbBusy ? "…" : "Save"}
            </button>
            {pbSaved && (
              <button
                type="button"
                disabled={pbBusy}
                onClick={() => savePlaybookLink(true)}
                className="px-3 rounded-lg bg-[#1b2235] hover:bg-[#ff5c7a]/20 text-xs font-semibold text-[#8e9ab5] hover:text-[#ff5c7a] whitespace-nowrap transition-colors"
              >
                Clear
              </button>
            )}
          </div>

          {pbMsg && (
            <p
              className={`text-[11px] mt-2 ${pbMsg.startsWith("Saved") || pbMsg === "Cleared" ? "text-[#2ee6a6]" : "text-[#ff5c7a]"}`}
            >
              {pbMsg}
            </p>
          )}
          {pbSaved && (
            <a
              href={pbSaved}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-[11px] mt-2 text-[#4cc9ff] hover:underline truncate"
            >
              Test it → {pbSaved}
            </a>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-[#ff5c7a]/30 bg-[#ff5c7a]/10 px-3 py-2 text-xs text-[#ff5c7a]">
            {error}
          </div>
        )}

        {/* Create form */}
        <form
          onSubmit={createPick}
          className="rounded-xl bg-[#0a0e17] border border-[#232a3d]/50 p-4 mb-8 space-y-3"
        >
          <div className="grid grid-cols-2 gap-3">
            <select
              value={form.sport}
              onChange={(e) => setForm({ ...form, sport: e.target.value })}
              className="bg-[#121727] border border-[#232a3d]/50 rounded-lg px-3 py-2 text-sm"
            >
              {SPORTS.map((s) => (
                <option key={s} value={s}>
                  {s.toUpperCase()}
                </option>
              ))}
            </select>
            <input
              placeholder="Confidence (Lock / Lean / Longshot)"
              value={form.confidence}
              onChange={(e) => setForm({ ...form, confidence: e.target.value })}
              className="bg-[#121727] border border-[#232a3d]/50 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <input
            placeholder="Game (e.g. NYY @ BOS)"
            value={form.game}
            onChange={(e) => setForm({ ...form, game: e.target.value })}
            className="w-full bg-[#121727] border border-[#232a3d]/50 rounded-lg px-3 py-2 text-sm"
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              placeholder="Market (e.g. Moneyline, Spread)"
              value={form.market}
              onChange={(e) => setForm({ ...form, market: e.target.value })}
              className="bg-[#121727] border border-[#232a3d]/50 rounded-lg px-3 py-2 text-sm"
            />
            <input
              type="number"
              step="0.5"
              min="0"
              placeholder="Units"
              value={form.units}
              onChange={(e) =>
                setForm({ ...form, units: Number(e.target.value) })
              }
              className="bg-[#121727] border border-[#232a3d]/50 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <textarea
            required
            placeholder="The bet (e.g. Yankees -1.5)"
            value={form.pick_text}
            onChange={(e) => setForm({ ...form, pick_text: e.target.value })}
            className="w-full bg-[#121727] border border-[#232a3d]/50 rounded-lg px-3 py-2 text-sm"
            rows={2}
          />
          <textarea
            placeholder="Write-up / reasoning"
            value={form.writeup}
            onChange={(e) => setForm({ ...form, writeup: e.target.value })}
            className="w-full bg-[#121727] border border-[#232a3d]/50 rounded-lg px-3 py-2 text-sm"
            rows={3}
          />
          <button
            type="submit"
            className="flex items-center gap-2 bg-[#4cc9ff]/10 text-[#4cc9ff] border border-[#4cc9ff]/30 rounded-lg px-4 py-2 text-sm font-semibold hover:bg-[#4cc9ff]/20 transition-colors"
          >
            <Plus className="w-4 h-4" /> Save Draft
          </button>
        </form>

        {/* Picks list */}
        <div className="space-y-3">
          {picks.map((p) => (
            <div
              key={p.id}
              className="rounded-xl bg-[#0a0e17] border border-[#232a3d]/50 p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded"
                  style={{
                    color: STATUS_COLOR[p.status],
                    background: `${STATUS_COLOR[p.status]}1a`,
                  }}
                >
                  {p.status}
                </span>
                {p.result && (
                  <span className="text-[10px] font-bold uppercase text-[#f59e0b]">
                    {p.result}
                  </span>
                )}
                <span className="text-[10px] text-[#8e9ab5] ml-auto">
                  {p.sport.toUpperCase()} · {p.units}u
                </span>
              </div>
              <p className="text-sm font-semibold text-white mb-1">
                {p.pick_text}
              </p>
              {p.game && (
                <p className="text-xs text-[#8e9ab5] mb-1">{p.game}</p>
              )}
              {p.writeup && (
                <p className="text-xs text-[#8e9ab5] mb-3 line-clamp-3">
                  {p.writeup}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                {p.status === "draft" && (
                  <button
                    disabled={busyId === p.id}
                    onClick={() => doAction(p.id, "publish")}
                    className="flex items-center gap-1 text-xs bg-[#2ee6a6]/10 text-[#2ee6a6] border border-[#2ee6a6]/30 rounded-lg px-3 py-1.5 hover:bg-[#2ee6a6]/20 disabled:opacity-40"
                  >
                    <Send className="w-3 h-3" /> Publish
                  </button>
                )}
                {p.status === "published" && (
                  <>
                    <button
                      disabled={busyId === p.id}
                      onClick={() => doAction(p.id, "retract")}
                      className="flex items-center gap-1 text-xs bg-[#ff5c7a]/10 text-[#ff5c7a] border border-[#ff5c7a]/30 rounded-lg px-3 py-1.5 hover:bg-[#ff5c7a]/20 disabled:opacity-40"
                    >
                      <Undo2 className="w-3 h-3" /> Retract
                    </button>
                    {!p.result && (
                      <>
                        <button
                          disabled={busyId === p.id}
                          onClick={() => gradePick(p.id, "win")}
                          className="flex items-center gap-1 text-xs bg-[#2ee6a6]/10 text-[#2ee6a6] border border-[#2ee6a6]/30 rounded-lg px-3 py-1.5 hover:bg-[#2ee6a6]/20 disabled:opacity-40"
                        >
                          <Trophy className="w-3 h-3" /> Win
                        </button>
                        <button
                          disabled={busyId === p.id}
                          onClick={() => gradePick(p.id, "loss")}
                          className="text-xs bg-[#ff5c7a]/10 text-[#ff5c7a] border border-[#ff5c7a]/30 rounded-lg px-3 py-1.5 hover:bg-[#ff5c7a]/20 disabled:opacity-40"
                        >
                          Loss
                        </button>
                        <button
                          disabled={busyId === p.id}
                          onClick={() => gradePick(p.id, "push")}
                          className="text-xs bg-[#8e9ab5]/10 text-[#8e9ab5] border border-[#8e9ab5]/30 rounded-lg px-3 py-1.5 hover:bg-[#8e9ab5]/20 disabled:opacity-40"
                        >
                          Push
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
          {!loading && picks.length === 0 && (
            <p className="text-center text-xs text-[#8e9ab5] py-8">
              No picks yet — create one above.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
