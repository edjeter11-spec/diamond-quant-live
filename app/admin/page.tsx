"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/supabase/auth";
import { supabase } from "@/lib/supabase/client";
import {
  Shield, Users, Brain, BarChart3, Ticket, Eye, RefreshCw,
  Crown, Trash2, ArrowLeft, Activity, Database, Zap,
} from "lucide-react";
import Link from "next/link";

interface UserRow {
  id: string;
  display_name: string;
  email: string;
  is_admin: boolean;
  invite_code: string;
  invites_remaining: number;
  last_active: string;
  created_at: string;
}

interface InviteRow {
  id: string;
  code: string;
  created_by: string;
  used_by: string | null;
  used_at: string | null;
  created_at: string;
}

export default function AdminPage() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"users" | "invites" | "stats">("users");
  const [newInviteCode, setNewInviteCode] = useState("");

  useEffect(() => {
    if (!isAdmin || !supabase) return;
    loadData();
  }, [isAdmin]);

  async function loadData() {
    if (!supabase) return;
    setLoading(true);

    const [usersRes, invitesRes, brainRes, eloRes] = await Promise.all([
      supabase.from("user_profiles").select("*").order("created_at", { ascending: false }),
      supabase.from("invites").select("*").order("created_at", { ascending: false }).limit(50),
      supabase.from("app_state").select("value").eq("key", "brain").single(),
      supabase.from("app_state").select("value").eq("key", "elo_mlb").single(),
    ]);

    setUsers((usersRes.data ?? []) as UserRow[]);
    setInvites((invitesRes.data ?? []) as InviteRow[]);

    const brain = brainRes.data?.value as any;
    const elo = eloRes.data?.value as any;
    setStats({
      totalUsers: usersRes.data?.length ?? 0,
      activeUsers: (usersRes.data ?? []).filter((u: any) => {
        const lastActive = new Date(u.last_active).getTime();
        return Date.now() - lastActive < 7 * 24 * 60 * 60 * 1000;
      }).length,
      brainGames: brain?.totalGamesProcessed ?? 0,
      brainPitchers: Object.keys(brain?.pitcherMemory ?? {}).length,
      eloTeams: Object.keys(elo?.teams ?? {}).length,
      eloGames: elo?.totalGamesProcessed ?? 0,
      invitesUsed: (invitesRes.data ?? []).filter((i: any) => i.used_by).length,
      invitesTotal: invitesRes.data?.length ?? 0,
    });

    setLoading(false);
  }

  const generateInvite = async () => {
    if (!supabase || !user) return;
    const code = newInviteCode.toUpperCase() || Math.random().toString(36).slice(2, 8).toUpperCase();
    await supabase.from("invites").insert({ code, created_by: user.id });
    setNewInviteCode("");
    loadData();
  };

  const toggleAdmin = async (userId: string, current: boolean) => {
    if (!supabase) return;
    await supabase.from("user_profiles").update({ is_admin: !current }).eq("id", userId);
    loadData();
  };

  if (authLoading) {
    return <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
      <RefreshCw className="w-6 h-6 text-[#8b8fa3] animate-spin" />
    </div>;
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center text-center px-4">
        <div>
          <Shield className="w-10 h-10 text-[#ff3b5c]/30 mx-auto mb-3" />
          <p className="text-sm text-[#ff3b5c] font-semibold">Access Denied</p>
          <p className="text-xs text-[#8b8fa3] mt-1">Admin privileges required</p>
          <Link href="/" className="text-xs text-[#00d4ff] mt-3 inline-block">← Back to Dashboard</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-[#c4c8d8]">
      <div className="max-w-5xl mx-auto px-4 pt-6 pb-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link href="/" className="p-2 rounded-lg hover:bg-[#1a1d2e] transition-colors">
            <ArrowLeft className="w-4 h-4 text-[#8b8fa3]" />
          </Link>
          <Shield className="w-8 h-8 text-[#f59e0b]" />
          <div>
            <h1 className="text-xl font-bold text-white">Admin Panel</h1>
            <p className="text-xs text-[#8b8fa3] font-mono">SYSTEM MANAGEMENT</p>
          </div>
          <button onClick={loadData} className="ml-auto p-2 rounded-lg hover:bg-[#1a1d2e] transition-colors">
            <RefreshCw className={`w-4 h-4 text-[#8b8fa3] ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Quick Stats */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <QuickStat icon={Users} label="Total Users" value={stats.totalUsers} color="#00d4ff" />
            <QuickStat icon={Activity} label="Active (7d)" value={stats.activeUsers} color="#00ff88" />
            <QuickStat icon={Brain} label="Brain Games" value={stats.brainGames.toLocaleString()} color="#a855f7" />
            <QuickStat icon={Zap} label="Elo Teams" value={stats.eloTeams} color="#f59e0b" />
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-4 bg-[#0f1117] rounded-lg p-1 border border-[#2a2d3e]/50">
          {(["users", "invites", "stats"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 rounded-md text-xs font-semibold transition-all capitalize ${
                tab === t ? "bg-[#00d4ff]/10 text-[#00d4ff]" : "text-[#8b8fa3] hover:text-white"
              }`}
            >{t}</button>
          ))}
        </div>

        {/* Users Tab */}
        {tab === "users" && (
          <div className="rounded-xl bg-[#0f1117] border border-[#2a2d3e]/50 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#2a2d3e]/50 text-[#8b8fa3] text-left">
                    <th className="px-4 py-3 font-semibold">User</th>
                    <th className="px-4 py-3 font-semibold">Email</th>
                    <th className="px-4 py-3 font-semibold">Invite Code</th>
                    <th className="px-4 py-3 font-semibold">Last Active</th>
                    <th className="px-4 py-3 font-semibold">Admin</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} className="border-b border-[#2a2d3e]/20 hover:bg-[#1a1d2e]/30">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-[#00ff88]/10 flex items-center justify-center text-[#00ff88] text-[10px] font-bold">
                            {(u.display_name?.[0] || "?").toUpperCase()}
                          </div>
                          <span className="text-white font-medium">{u.display_name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-[#8b8fa3]">{u.email}</td>
                      <td className="px-4 py-2.5 font-mono text-[#00d4ff]">{u.invite_code}</td>
                      <td className="px-4 py-2.5 text-[#8b8fa3]">
                        {u.last_active ? new Date(u.last_active).toLocaleDateString() : "Never"}
                      </td>
                      <td className="px-4 py-2.5">
                        <button
                          onClick={() => toggleAdmin(u.id, u.is_admin)}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            u.is_admin ? "bg-[#f59e0b]/10 text-[#f59e0b]" : "bg-[#2a2d3e]/50 text-[#8b8fa3]"
                          }`}
                        >
                          {u.is_admin ? "ADMIN" : "USER"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Invites Tab */}
        {tab === "invites" && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Custom code (or leave blank for random)"
                value={newInviteCode}
                onChange={e => setNewInviteCode(e.target.value.toUpperCase())}
                maxLength={6}
                className="flex-1 px-3 py-2 rounded-lg bg-[#0f1117] border border-[#2a2d3e]/50 text-sm text-white placeholder:text-[#8b8fa3]/50 font-mono uppercase focus:outline-none focus:border-[#00d4ff]/50"
              />
              <button
                onClick={generateInvite}
                className="px-4 py-2 rounded-lg bg-[#00ff88]/10 border border-[#00ff88]/20 text-[#00ff88] text-xs font-semibold hover:bg-[#00ff88]/20 transition-all"
              >
                Generate Invite
              </button>
            </div>
            <div className="rounded-xl bg-[#0f1117] border border-[#2a2d3e]/50 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#2a2d3e]/50 text-[#8b8fa3] text-left">
                    <th className="px-4 py-3">Code</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {invites.map(inv => (
                    <tr key={inv.id} className="border-b border-[#2a2d3e]/20">
                      <td className="px-4 py-2.5 font-mono text-[#00d4ff] font-bold">{inv.code}</td>
                      <td className="px-4 py-2.5">
                        {inv.used_by ? (
                          <span className="text-[#8b8fa3]">Used {inv.used_at ? new Date(inv.used_at).toLocaleDateString() : ""}</span>
                        ) : (
                          <span className="text-[#00ff88]">Available</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-[#8b8fa3]">{new Date(inv.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Stats Tab */}
        {tab === "stats" && stats && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-xl bg-[#0f1117] border border-[#2a2d3e]/50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Brain className="w-4 h-4 text-[#a855f7]" />
                <h3 className="text-sm font-bold text-white">Brain Intelligence</h3>
              </div>
              <div className="space-y-1.5 text-xs text-[#8b8fa3]">
                <p>Games processed: <span className="text-white font-mono">{stats.brainGames.toLocaleString()}</span></p>
                <p>Pitchers known: <span className="text-white font-mono">{stats.brainPitchers}</span></p>
              </div>
            </div>
            <div className="rounded-xl bg-[#0f1117] border border-[#2a2d3e]/50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Database className="w-4 h-4 text-[#00d4ff]" />
                <h3 className="text-sm font-bold text-white">Elo System</h3>
              </div>
              <div className="space-y-1.5 text-xs text-[#8b8fa3]">
                <p>Teams tracked: <span className="text-white font-mono">{stats.eloTeams}</span></p>
                <p>Games processed: <span className="text-white font-mono">{stats.eloGames.toLocaleString()}</span></p>
              </div>
            </div>
            <div className="rounded-xl bg-[#0f1117] border border-[#2a2d3e]/50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Ticket className="w-4 h-4 text-[#f59e0b]" />
                <h3 className="text-sm font-bold text-white">Invites</h3>
              </div>
              <div className="space-y-1.5 text-xs text-[#8b8fa3]">
                <p>Total created: <span className="text-white font-mono">{stats.invitesTotal}</span></p>
                <p>Used: <span className="text-white font-mono">{stats.invitesUsed}</span></p>
              </div>
            </div>
            <div className="rounded-xl bg-[#0f1117] border border-[#2a2d3e]/50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-[#00ff88]" />
                <h3 className="text-sm font-bold text-white">Users</h3>
              </div>
              <div className="space-y-1.5 text-xs text-[#8b8fa3]">
                <p>Total: <span className="text-white font-mono">{stats.totalUsers}</span></p>
                <p>Active (7d): <span className="text-white font-mono">{stats.activeUsers}</span></p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function QuickStat({ icon: Icon, label, value, color }: { icon: any; label: string; value: string | number; color: string }) {
  return (
    <div className="rounded-xl bg-[#0f1117] border border-[#2a2d3e]/50 p-3 text-center">
      <Icon className="w-4 h-4 mx-auto mb-1" style={{ color }} />
      <p className="text-lg font-bold font-mono text-white">{value}</p>
      <p className="text-[9px] text-[#8b8fa3] uppercase">{label}</p>
    </div>
  );
}
