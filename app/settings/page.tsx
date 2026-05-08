"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Settings as SettingsIcon,
  Bell,
  Webhook,
  Mail,
  Trophy,
  DollarSign,
  Check,
  AlertCircle,
} from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/lib/supabase/auth";
import { cloudSet, cloudGet } from "@/lib/supabase/client";
import { getDiscordWebhook, setDiscordWebhook } from "@/lib/store";
import { useSport, type Sport } from "@/lib/sport-context";
import PushOptIn from "@/components/dashboard/PushOptIn";

const STAKE_KEY = "dq_default_stake";

type SaveState = "idle" | "saving" | "saved" | "error";

function StatusBadge({ state }: { state: SaveState }) {
  if (state === "saving")
    return <span className="text-[10px] text-mercury/60 font-mono">Saving…</span>;
  if (state === "saved")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-neon font-mono">
        <Check className="w-3 h-3" /> Saved
      </span>
    );
  if (state === "error")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-danger font-mono">
        <AlertCircle className="w-3 h-3" /> Error
      </span>
    );
  return null;
}

function useSaveState() {
  const [state, setState] = useState<SaveState>("idle");
  function flash(s: SaveState) {
    setState(s);
    if (s === "saved" || s === "error") {
      setTimeout(() => setState("idle"), 2000);
    }
  }
  return { state, flash };
}

export default function SettingsPage() {
  const { user, loading: authLoading } = useAuth();
  const { currentSport, setSport } = useSport();

  // Discord
  const [webhook, setWebhook] = useState("");
  const webhookSave = useSaveState();

  // Email opt-in
  const [emailOptIn, setEmailOptIn] = useState(false);
  const emailSave = useSaveState();

  // Default stake
  const [stake, setStake] = useState<number>(25);
  const stakeSave = useSaveState();

  // Sport
  const sportSave = useSaveState();

  // Hydrate values on mount
  useEffect(() => {
    if (!user) return;

    // Discord webhook — local first, then cloud
    const local = getDiscordWebhook();
    if (local) setWebhook(local);
    cloudGet<string>("user_pref_discord_" + user.id, "").then((v) => {
      if (v && typeof v === "string") setWebhook(v);
    });

    // Email opt-in
    cloudGet<{ optIn: boolean } | null>("user_pref_email_" + user.id, null).then((v) => {
      if (v && typeof v === "object") setEmailOptIn(!!v.optIn);
    });

    // Stake — local first
    if (typeof window !== "undefined") {
      const raw = localStorage.getItem(STAKE_KEY);
      if (raw) {
        const n = parseFloat(raw);
        if (!Number.isNaN(n) && n > 0) setStake(n);
      }
    }
    cloudGet<number | null>("user_pref_stake_" + user.id, null).then((v) => {
      if (typeof v === "number" && v > 0) setStake(v);
    });
  }, [user]);

  async function saveWebhook() {
    if (!user) return;
    webhookSave.flash("saving");
    try {
      setDiscordWebhook(webhook);
      const r = await cloudSet("user_pref_discord_" + user.id, webhook);
      webhookSave.flash(r.ok ? "saved" : "error");
    } catch {
      webhookSave.flash("error");
    }
  }

  async function toggleEmail(next: boolean) {
    if (!user) return;
    setEmailOptIn(next);
    emailSave.flash("saving");
    try {
      const r = await cloudSet("user_pref_email_" + user.id, {
        optIn: next,
        addedAt: new Date().toISOString(),
      });
      emailSave.flash(r.ok ? "saved" : "error");
    } catch {
      emailSave.flash("error");
    }
  }

  async function saveStake() {
    if (!user) return;
    stakeSave.flash("saving");
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem(STAKE_KEY, String(stake));
      }
      const r = await cloudSet("user_pref_stake_" + user.id, stake);
      stakeSave.flash(r.ok ? "saved" : "error");
    } catch {
      stakeSave.flash("error");
    }
  }

  async function chooseSport(s: Sport) {
    setSport(s);
    if (!user) return;
    sportSave.flash("saving");
    try {
      const r = await cloudSet("user_pref_sport_" + user.id, s);
      sportSave.flash(r.ok ? "saved" : "error");
    } catch {
      sportSave.flash("error");
    }
  }

  // Auth gate
  if (authLoading) {
    return (
      <div className="min-h-screen bg-void text-silver flex items-center justify-center">
        <p className="text-sm text-mercury animate-pulse">Loading…</p>
      </div>
    );
  }
  if (!user) {
    return (
      <div className="min-h-screen bg-void text-silver flex flex-col">
        <div className="max-w-2xl w-full mx-auto px-4 pt-6 pb-8">
          <div className="flex items-center gap-3 mb-6">
            <Link href="/" className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-gunmetal/60 transition-colors" aria-label="Back to dashboard">
              <ArrowLeft className="w-5 h-5 text-mercury" />
            </Link>
            <h1 className="text-xl font-bold text-white">Settings</h1>
          </div>
          <div className="glass rounded-xl border border-electric/30 p-6 text-center bg-gradient-to-br from-electric/5 to-purple/5">
            <SettingsIcon className="w-10 h-10 text-electric mx-auto mb-3" />
            <p className="text-base text-silver font-bold">Sign in to manage settings</p>
            <p className="text-xs text-mercury/70 mt-2 max-w-sm mx-auto">
              Push alerts, Discord webhook, email digest — all sync across devices once you&apos;re in.
            </p>
            <Link
              href="/"
              className="mt-5 inline-flex items-center justify-center min-h-[44px] px-5 rounded-xl bg-electric text-bunker text-sm font-bold hover:bg-electric/90 transition-all"
            >
              Go Sign In →
            </Link>
          </div>

          {/* Feature preview cards so the page isn't dead empty */}
          <div className="mt-6 grid gap-3">
            <div className="glass rounded-xl border border-slate/20 p-4 opacity-50">
              <p className="text-[11px] font-semibold text-mercury uppercase tracking-wider mb-2">🔔 Push Notifications</p>
              <p className="text-xs text-mercury/60">Get +EV alerts pushed to your phone the moment edges hit. Filter by HIGH/MED/LOW confidence.</p>
            </div>
            <div className="glass rounded-xl border border-slate/20 p-4 opacity-50">
              <p className="text-[11px] font-semibold text-mercury uppercase tracking-wider mb-2">🤖 Discord Webhook</p>
              <p className="text-xs text-mercury/60">Auto-post daily picks, recaps, and arb alerts to your Discord server.</p>
            </div>
            <div className="glass rounded-xl border border-slate/20 p-4 opacity-50">
              <p className="text-[11px] font-semibold text-mercury uppercase tracking-wider mb-2">📧 Email Digest</p>
              <p className="text-xs text-mercury/60">Daily morning email with tonight's picks, top arbs, and yesterday's results.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-void text-silver">
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link href="/" className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-gunmetal/60 transition-colors" aria-label="Back to dashboard">
            <ArrowLeft className="w-5 h-5 text-mercury" />
          </Link>
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-electric/20 to-purple/20 flex items-center justify-center border border-electric/20">
            <SettingsIcon className="w-5 h-5 text-electric" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Settings</h1>
            <p className="text-xs text-mercury font-mono">PREFERENCES &amp; NOTIFICATIONS</p>
          </div>
        </div>

        {/* Push Notifications */}
        <section className="mb-4">
          <div className="flex items-center gap-2 mb-2 px-1">
            <Bell className="w-3.5 h-3.5 text-purple" />
            <h2 className="text-[11px] font-semibold text-mercury uppercase tracking-wider">
              Push Notifications
            </h2>
          </div>
          <div className="space-y-2">
            <PushOptIn />
            <p className="text-[10px] text-mercury/50 px-1">
              Browser web-push for sharp picks. You&apos;ll only ping when the model finds an edge.
            </p>
          </div>
        </section>

        {/* Discord Webhook */}
        <section className="mb-4">
          <div className="flex items-center justify-between mb-2 px-1">
            <div className="flex items-center gap-2">
              <Webhook className="w-3.5 h-3.5 text-electric" />
              <h2 className="text-[11px] font-semibold text-mercury uppercase tracking-wider">
                Discord Webhook
              </h2>
            </div>
            <StatusBadge state={webhookSave.state} />
          </div>
          <div className="glass rounded-xl border border-slate/30 p-4">
            <p className="text-[11px] text-mercury/70 mb-3">
              Paste a Discord channel webhook URL to receive picks &amp; settle alerts directly in
              your server.
            </p>
            <div className="flex gap-2">
              <input
                type="url"
                value={webhook}
                onChange={(e) => setWebhook(e.target.value)}
                placeholder="https://discord.com/api/webhooks/…"
                className="flex-1 bg-bunker border border-slate/40 rounded-lg px-3 py-2 text-xs text-silver placeholder:text-mercury/40 focus:outline-none focus:border-electric/40"
              />
              <button
                type="button"
                onClick={saveWebhook}
                disabled={webhookSave.state === "saving"}
                className="px-3 py-2 rounded-lg bg-electric/15 hover:bg-electric/25 text-electric text-[11px] font-semibold border border-electric/25 transition-colors disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </section>

        {/* Email digest */}
        <section className="mb-4">
          <div className="flex items-center justify-between mb-2 px-1">
            <div className="flex items-center gap-2">
              <Mail className="w-3.5 h-3.5 text-amber" />
              <h2 className="text-[11px] font-semibold text-mercury uppercase tracking-wider">
                Email Digest
              </h2>
            </div>
            <StatusBadge state={emailSave.state} />
          </div>
          <div className="glass rounded-xl border border-slate/30 p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber/10 border border-amber/20 flex items-center justify-center flex-shrink-0">
              <Mail className="w-4 h-4 text-amber" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-silver">Daily recap email</p>
              <p className="text-[11px] text-mercury/70">
                Morning email with yesterday&apos;s settled bets and today&apos;s top picks.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={emailOptIn}
              onClick={() => toggleEmail(!emailOptIn)}
              className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                emailOptIn ? "bg-neon/40 border border-neon/40" : "bg-gunmetal/60 border border-slate/40"
              }`}
            >
              <span
                className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                  emailOptIn ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
        </section>

        {/* Default Sport */}
        <section className="mb-4">
          <div className="flex items-center justify-between mb-2 px-1">
            <div className="flex items-center gap-2">
              <Trophy className="w-3.5 h-3.5 text-gold" />
              <h2 className="text-[11px] font-semibold text-mercury uppercase tracking-wider">
                Default Sport
              </h2>
            </div>
            <StatusBadge state={sportSave.state} />
          </div>
          <div className="glass rounded-xl border border-slate/30 p-2">
            <div className="flex gap-1">
              {(["mlb", "nba"] as Sport[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => chooseSport(s)}
                  className={`flex-1 py-2.5 rounded-lg text-[11px] font-semibold transition-all uppercase tracking-wider ${
                    currentSport === s
                      ? s === "mlb"
                        ? "bg-neon/15 text-neon border border-neon/30"
                        : "bg-orange/15 text-orange border border-orange/30"
                      : "text-mercury hover:text-white border border-transparent"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Default stake */}
        <section className="mb-4">
          <div className="flex items-center justify-between mb-2 px-1">
            <div className="flex items-center gap-2">
              <DollarSign className="w-3.5 h-3.5 text-neon" />
              <h2 className="text-[11px] font-semibold text-mercury uppercase tracking-wider">
                Default Stake
              </h2>
            </div>
            <StatusBadge state={stakeSave.state} />
          </div>
          <div className="glass rounded-xl border border-slate/30 p-4">
            <p className="text-[11px] text-mercury/70 mb-3">
              Pre-fills new bet slips with this amount. Per-bet sizing still respects Kelly when
              available.
            </p>
            <div className="flex gap-2 items-center">
              <div className="flex-1 relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-mercury/60 text-xs font-mono">
                  $
                </span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={stake}
                  onChange={(e) => {
                    const n = parseFloat(e.target.value);
                    setStake(Number.isFinite(n) ? n : 0);
                  }}
                  className="w-full bg-bunker border border-slate/40 rounded-lg pl-7 pr-3 py-2 text-xs text-silver focus:outline-none focus:border-neon/40 font-mono"
                />
              </div>
              <button
                type="button"
                onClick={saveStake}
                disabled={stakeSave.state === "saving" || !(stake > 0)}
                className="px-3 py-2 rounded-lg bg-neon/15 hover:bg-neon/25 text-neon text-[11px] font-semibold border border-neon/25 transition-colors disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </section>

        {/* Footer */}
        <div className="text-center mt-8 space-y-1">
          <p className="text-[10px] text-mercury/50">
            Preferences sync across devices via your account
          </p>
          <Link href="/" className="text-[10px] text-electric hover:text-neon transition-colors">
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
