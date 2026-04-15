"use client";

import { useState } from "react";
import { useAuth } from "@/lib/supabase/auth";
import { useStore } from "@/lib/store";
import {
  User, Mail, Shield, Bell, BellOff, Globe, Download,
  Save, Loader2, Smartphone, Crown, Ticket, Copy, Check,
} from "lucide-react";

export default function UserProfile() {
  const { user, profile, preferences, isAdmin, updateProfile, updatePreferences } = useAuth();
  const { bankroll, betHistory } = useStore();
  const [editName, setEditName] = useState(profile?.display_name ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  // Prefs state
  const [discord, setDiscord] = useState(preferences?.discord_webhook ?? "");
  const [pushEnabled, setPushEnabled] = useState(preferences?.push_enabled ?? true);
  const [pushMinConf, setPushMinConf] = useState(preferences?.push_min_confidence ?? "MEDIUM");
  const [emailRecap, setEmailRecap] = useState(preferences?.email_daily_recap ?? false);
  const [defaultSport, setDefaultSport] = useState(preferences?.default_sport ?? "mlb");

  if (!user || !profile) {
    return (
      <div className="glass rounded-xl p-8 text-center">
        <User className="w-8 h-8 text-mercury/20 mx-auto mb-3" />
        <p className="text-sm text-mercury">Sign in to view your profile</p>
        <p className="text-xs text-mercury/50 mt-1">Your picks, bankroll, and settings sync across devices</p>
      </div>
    );
  }

  const handleSaveProfile = async () => {
    setSaving(true);
    await updateProfile({ display_name: editName });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSavePrefs = async () => {
    setSaving(true);
    await updatePreferences({
      discord_webhook: discord,
      push_enabled: pushEnabled,
      push_min_confidence: pushMinConf,
      email_daily_recap: emailRecap,
      default_sport: defaultSport,
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const exportData = () => {
    const data = {
      profile,
      bankroll,
      betHistory,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dq-export-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyInvite = () => {
    if (profile.invite_code) {
      navigator.clipboard.writeText(profile.invite_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Stats
  const settled = betHistory.filter(b => b.result !== "pending");
  const wins = settled.filter(b => b.result === "win").length;
  const losses = settled.filter(b => b.result === "loss").length;
  const totalStaked = settled.reduce((s, b) => s + (b.stake ?? 0), 0);
  const totalReturns = settled.reduce((s, b) => s + (b.payout ?? 0), 0);
  const profit = totalReturns - totalStaked;
  const roi = totalStaked > 0 ? (profit / totalStaked) * 100 : 0;
  const winRate = (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* Profile Card */}
      <div className="glass rounded-xl overflow-hidden border border-electric/20">
        <div className="px-4 py-3 bg-gradient-to-r from-electric/10 to-purple/5 border-b border-electric/15 flex items-center gap-3">
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt="" className="w-10 h-10 rounded-full border border-neon/30" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-neon/20 border border-neon/30 flex items-center justify-center text-neon text-lg font-bold">
              {(profile.display_name?.[0] || "?").toUpperCase()}
            </div>
          )}
          <div className="flex-1">
            <div className="flex items-center gap-1.5">
              <h2 className="text-sm font-bold text-silver">{profile.display_name}</h2>
              {isAdmin && <Crown className="w-3.5 h-3.5 text-gold" />}
            </div>
            <p className="text-[10px] text-mercury/60">{user.email}</p>
            <p className="text-[9px] text-mercury/40">Member since {new Date(profile.created_at).toLocaleDateString()}</p>
          </div>
        </div>

        {/* Lifetime Stats */}
        <div className="grid grid-cols-4 gap-px bg-slate/10">
          <StatBox label="Record" value={`${wins}W-${losses}L`} color="text-silver" />
          <StatBox label="Win Rate" value={`${winRate.toFixed(1)}%`} color={winRate > 52 ? "text-neon" : "text-silver"} />
          <StatBox label="ROI" value={`${roi >= 0 ? "+" : ""}${roi.toFixed(1)}%`} color={roi > 0 ? "text-neon" : "text-danger"} />
          <StatBox label="Profit" value={`${profit >= 0 ? "+" : ""}$${profit.toFixed(0)}`} color={profit >= 0 ? "text-neon" : "text-danger"} />
        </div>
      </div>

      {/* Edit Profile */}
      <div className="glass rounded-xl p-4 space-y-3">
        <h3 className="text-xs font-bold text-silver uppercase tracking-wider flex items-center gap-1.5">
          <User className="w-3.5 h-3.5 text-electric" /> Profile
        </h3>
        <div className="space-y-2">
          <label className="text-[10px] text-mercury/60 uppercase">Display Name</label>
          <input
            type="text"
            value={editName}
            onChange={e => setEditName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-gunmetal/50 border border-slate/20 text-sm text-silver focus:border-electric/50 focus:outline-none"
          />
        </div>
        <button onClick={handleSaveProfile} disabled={saving} className="px-4 py-2 rounded-lg bg-electric/15 border border-electric/25 text-electric text-xs font-semibold hover:bg-electric/25 transition-all flex items-center gap-1.5 disabled:opacity-50">
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : saved ? <Check className="w-3 h-3" /> : <Save className="w-3 h-3" />}
          {saved ? "Saved" : "Save"}
        </button>
      </div>

      {/* Invite Code */}
      <div className="glass rounded-xl p-4 space-y-2">
        <h3 className="text-xs font-bold text-silver uppercase tracking-wider flex items-center gap-1.5">
          <Ticket className="w-3.5 h-3.5 text-purple" /> Invite Friends
        </h3>
        <div className="flex items-center gap-3">
          <code className="text-lg font-mono text-neon font-bold tracking-widest">{profile.invite_code}</code>
          <button onClick={copyInvite} className="p-1.5 rounded-lg hover:bg-gunmetal/50 transition-colors" title="Copy">
            {copied ? <Check className="w-4 h-4 text-neon" /> : <Copy className="w-4 h-4 text-mercury/50" />}
          </button>
        </div>
        <p className="text-[10px] text-mercury/50">{profile.invites_remaining} invites remaining • Share your code to let friends join</p>
      </div>

      {/* Notification Preferences */}
      <div className="glass rounded-xl p-4 space-y-3">
        <h3 className="text-xs font-bold text-silver uppercase tracking-wider flex items-center gap-1.5">
          <Bell className="w-3.5 h-3.5 text-amber" /> Notifications
        </h3>
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-silver">Push Notifications</p>
              <p className="text-[9px] text-mercury/50">Alert on high-confidence picks</p>
            </div>
            <button
              onClick={() => setPushEnabled(!pushEnabled)}
              className={`w-10 h-5 rounded-full transition-colors ${pushEnabled ? "bg-neon/30" : "bg-gunmetal/50"}`}
            >
              <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${pushEnabled ? "translate-x-5" : "translate-x-0.5"}`} />
            </button>
          </div>
          {pushEnabled && (
            <div>
              <label className="text-[10px] text-mercury/60 uppercase">Min Confidence</label>
              <select
                value={pushMinConf}
                onChange={e => setPushMinConf(e.target.value)}
                className="w-full mt-1 px-3 py-1.5 rounded-lg bg-gunmetal/50 border border-slate/20 text-xs text-silver focus:outline-none"
              >
                <option value="HIGH">HIGH only</option>
                <option value="MEDIUM">MEDIUM+</option>
                <option value="LOW">All picks</option>
              </select>
            </div>
          )}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-silver">Email Daily Recap</p>
              <p className="text-[9px] text-mercury/50">Summary of picks + results each morning</p>
            </div>
            <button
              onClick={() => setEmailRecap(!emailRecap)}
              className={`w-10 h-5 rounded-full transition-colors ${emailRecap ? "bg-neon/30" : "bg-gunmetal/50"}`}
            >
              <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${emailRecap ? "translate-x-5" : "translate-x-0.5"}`} />
            </button>
          </div>
          <div>
            <label className="text-[10px] text-mercury/60 uppercase">Discord Webhook</label>
            <input
              type="url"
              placeholder="https://discord.com/api/webhooks/..."
              value={discord}
              onChange={e => setDiscord(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-lg bg-gunmetal/50 border border-slate/20 text-xs text-silver placeholder:text-mercury/30 focus:border-electric/50 focus:outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] text-mercury/60 uppercase">Default Sport</label>
            <select
              value={defaultSport}
              onChange={e => setDefaultSport(e.target.value)}
              className="w-full mt-1 px-3 py-1.5 rounded-lg bg-gunmetal/50 border border-slate/20 text-xs text-silver focus:outline-none"
            >
              <option value="mlb">MLB</option>
              <option value="nba">NBA</option>
            </select>
          </div>
        </div>
        <button onClick={handleSavePrefs} disabled={saving} className="px-4 py-2 rounded-lg bg-amber/15 border border-amber/25 text-amber text-xs font-semibold hover:bg-amber/25 transition-all flex items-center gap-1.5 disabled:opacity-50">
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : saved ? <Check className="w-3 h-3" /> : <Save className="w-3 h-3" />}
          {saved ? "Saved" : "Save Preferences"}
        </button>
      </div>

      {/* Device Info */}
      <div className="glass rounded-xl p-4 space-y-2">
        <h3 className="text-xs font-bold text-silver uppercase tracking-wider flex items-center gap-1.5">
          <Smartphone className="w-3.5 h-3.5 text-electric" /> Session
        </h3>
        <p className="text-[10px] text-mercury/60">
          Last active: {profile.last_active ? new Date(profile.last_active).toLocaleString() : "Now"}
        </p>
        {profile.devices?.length > 0 && (
          <p className="text-[10px] text-mercury/50">
            Active on {profile.devices.length} device{profile.devices.length > 1 ? "s" : ""}
          </p>
        )}
      </div>

      {/* Export */}
      <button
        onClick={exportData}
        className="w-full py-2.5 rounded-xl bg-gunmetal/30 border border-slate/20 text-mercury text-xs font-medium hover:bg-gunmetal/50 transition-all flex items-center justify-center gap-2"
      >
        <Download className="w-3.5 h-3.5" /> Export My Data (JSON)
      </button>
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="text-center py-2.5 px-1 bg-bunker/50">
      <p className={`text-sm font-bold font-mono ${color}`}>{value}</p>
      <p className="text-[8px] text-mercury/50 uppercase">{label}</p>
    </div>
  );
}
