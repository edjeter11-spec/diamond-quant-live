"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/supabase/auth";
import { supabase } from "@/lib/supabase/client";
import {
  Shield,
  Users,
  Brain,
  BarChart3,
  Ticket,
  Eye,
  RefreshCw,
  Crown,
  Trash2,
  ArrowLeft,
  Activity,
  Database,
  Zap,
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

    // Stats sources verified against the DB (2026-08-16):
    //  - Brain games:      prop_predictions rows where status='graded'.
    //                      The `brain` app_state key exists but has no
    //                      totalGamesProcessed / pitcherMemory, so the
    //                      panel used to show 0/0 while 1176 MLB rows were
    //                      graded. `smart_bot` is the current-generation
    //                      state (57 picks; no pitcherMemory either).
    //  - Elo:              elo_mlb + elo_nba, both live under-populated
    //                      today (9 teams / 7 games MLB, 4 / 11 NBA) — the
    //                      display now sums BOTH so a first-timer sees the
    //                      real footprint instead of MLB-only.
    //  - Invites:          user_profiles.invite_code / invited_by. The
    //                      dedicated `invites` table is empty; the actual
    //                      truth lives inline on user_profiles.
    // 14 days of published picks — feeds the new "Grading Health" card so
    // an admin can answer "is grading actually running / are we winning"
    // without leaving the panel. Cron heartbeat surfaces the last time the
    // whole pipeline ran, which is the fastest way to spot "recap silently
    // stopped firing".
    const since14 = new Date(Date.now() - 14 * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    const [
      usersRes,
      brainCountRes,
      smartBotRes,
      eloMlbRes,
      eloNbaRes,
      picks14Res,
      heartbeatRes,
    ] = await Promise.all([
      supabase
        .from("user_profiles")
        .select("*")
        .order("created_at", { ascending: false }),
      // Cheap count query — head:true means the server doesn't return rows,
      // just the count in the range header.
      supabase
        .from("prop_predictions")
        .select("id", { count: "exact", head: true })
        .eq("status", "graded"),
      supabase
        .from("app_state")
        .select("value")
        .eq("key", "smart_bot")
        .maybeSingle(),
      supabase
        .from("app_state")
        .select("value")
        .eq("key", "elo_mlb")
        .maybeSingle(),
      supabase
        .from("app_state")
        .select("value")
        .eq("key", "elo_nba")
        .maybeSingle(),
      supabase
        .from("manual_picks")
        .select("slate_date,result,profit_units")
        .gte("slate_date", since14)
        .order("slate_date", { ascending: false })
        .limit(500),
      supabase
        .from("app_state")
        .select("value")
        .eq("key", "cron_heartbeat")
        .maybeSingle(),
    ]);

    setUsers((usersRes.data ?? []) as UserRow[]);
    // `invites` count now comes from user_profiles inline. Rows kept as an
    // empty array to preserve the UI shape without inventing invite rows.
    setInvites([] as InviteRow[]);

    const smartBot = smartBotRes.data?.value as any;
    const eloMlb = eloMlbRes.data?.value as any;
    const eloNba = eloNbaRes.data?.value as any;
    const usersRows = usersRes.data ?? [];
    const invitedCount = usersRows.filter((u: any) => u.invited_by).length;

    // Grading health — pulls from the same manual_picks table the recap
    // reads from. If wins+losses = 0, grading is dead. If pending count
    // hasn't dropped in a day, grading is stalled.
    const picks14 = (picks14Res.data ?? []) as Array<{
      slate_date: string;
      result: string | null;
      profit_units: number | null;
    }>;
    const wins14 = picks14.filter((p) => p.result === "win").length;
    const losses14 = picks14.filter((p) => p.result === "loss").length;
    const pending14 = picks14.filter((p) => !p.result).length;
    const units14 = picks14.reduce(
      (s, p) => s + Number(p.profit_units ?? 0),
      0,
    );
    // "Stuck" = pending row on a slate that's already >3 days in the past.
    // Today's + yesterday's pending are normal (games still running).
    const stuckCutoff = new Date(Date.now() - 3 * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    const stuck14 = picks14.filter(
      (p) => !p.result && p.slate_date < stuckCutoff,
    ).length;
    const decided = wins14 + losses14;
    const winRate14 = decided > 0 ? (wins14 / decided) * 100 : null;

    // Cron heartbeat — minutes since the pipeline last ran.
    const hbAt = (heartbeatRes.data?.value as any)?.at;
    const heartbeatMinutesAgo = hbAt
      ? Math.round((Date.now() - Date.parse(hbAt)) / 60000)
      : null;

    setStats({
      totalUsers: usersRows.length,
      activeUsers: usersRows.filter((u: any) => {
        const lastActive = u.last_active
          ? new Date(u.last_active).getTime()
          : 0;
        return Date.now() - lastActive < 7 * 24 * 60 * 60 * 1000;
      }).length,
      // Real "games the brain has learned from" — every graded prop prediction.
      brainGames: brainCountRes.count ?? 0,
      brainPitchers: Object.keys(smartBot?.pitcherMemory ?? {}).length,
      eloTeams:
        Object.keys(eloMlb?.teams ?? {}).length +
        Object.keys(eloNba?.teams ?? {}).length,
      eloGames:
        (eloMlb?.totalGamesProcessed ?? 0) + (eloNba?.totalGamesProcessed ?? 0),
      invitesUsed: invitedCount,
      // "Total created" = every user who holds an invite code.
      invitesTotal: usersRows.filter((u: any) => u.invite_code).length,
      // New grading-health block
      wins14,
      losses14,
      pending14,
      stuck14,
      units14: Math.round(units14 * 10) / 10,
      winRate14,
      heartbeatMinutesAgo,
    });

    setLoading(false);
  }

  const generateInvite = async () => {
    if (!supabase || !user) return;
    const code =
      newInviteCode.toUpperCase() ||
      Math.random().toString(36).slice(2, 8).toUpperCase();
    await supabase.from("invites").insert({ code, created_by: user.id });
    setNewInviteCode("");
    loadData();
  };

  const toggleAdmin = async (userId: string, current: boolean) => {
    if (!supabase) return;
    await supabase
      .from("user_profiles")
      .update({ is_admin: !current })
      .eq("id", userId);
    loadData();
  };

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
      <div className="max-w-5xl mx-auto px-4 pt-6 pb-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link
            href="/"
            className="p-2 rounded-lg hover:bg-[#121727] transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-[#8e9ab5]" />
          </Link>
          <Shield className="w-8 h-8 text-[#f59e0b]" />
          <div>
            <h1 className="text-xl font-bold text-white">Admin Panel</h1>
            <p className="text-xs text-[#8e9ab5] font-mono">
              SYSTEM MANAGEMENT
            </p>
          </div>
          <Link
            href="/admin/picks"
            className="ml-auto text-xs bg-[#4cc9ff]/10 text-[#4cc9ff] border border-[#4cc9ff]/30 rounded-lg px-3 py-1.5 hover:bg-[#4cc9ff]/20 transition-colors"
          >
            Create Pick
          </Link>
          <Link
            href="/admin/bot"
            className="text-xs bg-[#a855f7]/10 text-[#a855f7] border border-[#a855f7]/30 rounded-lg px-3 py-1.5 hover:bg-[#a855f7]/20 transition-colors"
          >
            Bot Challenge
          </Link>
          <button
            onClick={loadData}
            className="p-2 rounded-lg hover:bg-[#121727] transition-colors"
          >
            <RefreshCw
              className={`w-4 h-4 text-[#8e9ab5] ${loading ? "animate-spin" : ""}`}
            />
          </button>
        </div>

        {/* Quick Stats */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <QuickStat
              icon={Users}
              label="Total Users"
              value={stats.totalUsers}
              color="#4cc9ff"
            />
            <QuickStat
              icon={Activity}
              label="Active (7d)"
              value={stats.activeUsers}
              color="#2ee6a6"
            />
            <QuickStat
              icon={Brain}
              label="Brain Games"
              value={stats.brainGames.toLocaleString()}
              color="#a855f7"
            />
            <QuickStat
              icon={Zap}
              label="Elo Teams"
              value={stats.eloTeams}
              color="#f59e0b"
            />
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-4 bg-[#0a0e17] rounded-lg p-1 border border-[#232a3d]/50">
          {(["users", "invites", "stats"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 rounded-md text-xs font-semibold transition-all capitalize ${
                tab === t
                  ? "bg-[#4cc9ff]/10 text-[#4cc9ff]"
                  : "text-[#8e9ab5] hover:text-white"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Users Tab */}
        {tab === "users" && (
          <div className="rounded-xl bg-[#0a0e17] border border-[#232a3d]/50 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#232a3d]/50 text-[#8e9ab5] text-left">
                    <th className="px-4 py-3 font-semibold">User</th>
                    <th className="px-4 py-3 font-semibold">Email</th>
                    <th className="px-4 py-3 font-semibold">Invite Code</th>
                    <th className="px-4 py-3 font-semibold">Last Active</th>
                    <th className="px-4 py-3 font-semibold">Admin</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr
                      key={u.id}
                      className="border-b border-[#232a3d]/20 hover:bg-[#121727]/30"
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-[#2ee6a6]/10 flex items-center justify-center text-[#2ee6a6] text-[10px] font-bold">
                            {(u.display_name?.[0] || "?").toUpperCase()}
                          </div>
                          <span className="text-white font-medium">
                            {u.display_name}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-[#8e9ab5]">{u.email}</td>
                      <td className="px-4 py-2.5 font-mono text-[#4cc9ff]">
                        {u.invite_code}
                      </td>
                      <td className="px-4 py-2.5 text-[#8e9ab5]">
                        {u.last_active
                          ? new Date(u.last_active).toLocaleDateString()
                          : "Never"}
                      </td>
                      <td className="px-4 py-2.5">
                        <button
                          onClick={() => toggleAdmin(u.id, u.is_admin)}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            u.is_admin
                              ? "bg-[#f59e0b]/10 text-[#f59e0b]"
                              : "bg-[#232a3d]/50 text-[#8e9ab5]"
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
                onChange={(e) => setNewInviteCode(e.target.value.toUpperCase())}
                maxLength={6}
                className="flex-1 px-3 py-2 rounded-lg bg-[#0a0e17] border border-[#232a3d]/50 text-sm text-white placeholder:text-[#8e9ab5]/50 font-mono uppercase focus:outline-none focus:border-[#4cc9ff]/50"
              />
              <button
                onClick={generateInvite}
                className="px-4 py-2 rounded-lg bg-[#2ee6a6]/10 border border-[#2ee6a6]/20 text-[#2ee6a6] text-xs font-semibold hover:bg-[#2ee6a6]/20 transition-all"
              >
                Generate Invite
              </button>
            </div>
            <div className="rounded-xl bg-[#0a0e17] border border-[#232a3d]/50 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#232a3d]/50 text-[#8e9ab5] text-left">
                    <th className="px-4 py-3">Code</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {invites.map((inv) => (
                    <tr key={inv.id} className="border-b border-[#232a3d]/20">
                      <td className="px-4 py-2.5 font-mono text-[#4cc9ff] font-bold">
                        {inv.code}
                      </td>
                      <td className="px-4 py-2.5">
                        {inv.used_by ? (
                          <span className="text-[#8e9ab5]">
                            Used{" "}
                            {inv.used_at
                              ? new Date(inv.used_at).toLocaleDateString()
                              : ""}
                          </span>
                        ) : (
                          <span className="text-[#2ee6a6]">Available</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-[#8e9ab5]">
                        {new Date(inv.created_at).toLocaleDateString()}
                      </td>
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
            {/* Grading Health — the single card that answers "is it working
                and is it winning". Colour flips red when stuck picks appear
                or when the cron heartbeat is older than 30 min. Sits FIRST
                so it's the first thing you see on the stats tab. */}
            <div
              className={`sm:col-span-2 rounded-xl border p-4 ${
                stats.stuck14 > 0 ||
                (stats.heartbeatMinutesAgo != null &&
                  stats.heartbeatMinutesAgo > 30)
                  ? "bg-[#2a0f14] border-[#ff5c7a]/40"
                  : "bg-[#0a0e17] border-[#232a3d]/50"
              }`}
            >
              <div className="flex items-center gap-2 mb-3">
                <Activity className="w-4 h-4 text-[#2ee6a6]" />
                <h3 className="text-sm font-bold text-white">
                  Grading Health · Last 14 days
                </h3>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-[#8e9ab5]">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-[#8e9ab5]/70">
                    Record
                  </div>
                  <div className="text-lg font-mono text-white">
                    {stats.wins14}-{stats.losses14}
                    {stats.winRate14 != null && (
                      <span className="text-xs text-[#8e9ab5] ml-1">
                        ({stats.winRate14.toFixed(1)}%)
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-[#8e9ab5]/70">
                    Units
                  </div>
                  <div
                    className={`text-lg font-mono ${
                      stats.units14 >= 0 ? "text-[#2ee6a6]" : "text-[#ff5c7a]"
                    }`}
                  >
                    {stats.units14 >= 0 ? "+" : ""}
                    {stats.units14}u
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-[#8e9ab5]/70">
                    Pending
                  </div>
                  <div className="text-lg font-mono text-white">
                    {stats.pending14}
                    {stats.stuck14 > 0 && (
                      <span className="text-xs text-[#ff5c7a] ml-1">
                        ({stats.stuck14} stuck &gt;3d)
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-[#8e9ab5]/70">
                    Cron
                  </div>
                  <div
                    className={`text-lg font-mono ${
                      stats.heartbeatMinutesAgo == null ||
                      stats.heartbeatMinutesAgo > 30
                        ? "text-[#ff5c7a]"
                        : "text-white"
                    }`}
                  >
                    {stats.heartbeatMinutesAgo != null
                      ? `${stats.heartbeatMinutesAgo}m ago`
                      : "unknown"}
                  </div>
                </div>
              </div>
              {stats.wins14 + stats.losses14 === 0 && (
                <p className="text-[11px] text-[#ff5c7a] mt-3">
                  No graded picks in 14 days — grading may be stopped.
                </p>
              )}
              {stats.stuck14 > 0 && (
                <p className="text-[11px] text-[#ff5c7a] mt-3">
                  {stats.stuck14} pick(s) pending on slates older than 3 days —
                  box-score fetch or the grader may be failing.
                </p>
              )}
            </div>

            <div className="rounded-xl bg-[#0a0e17] border border-[#232a3d]/50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Brain className="w-4 h-4 text-[#a855f7]" />
                <h3 className="text-sm font-bold text-white">
                  Brain Intelligence
                </h3>
              </div>
              <div className="space-y-1.5 text-xs text-[#8e9ab5]">
                <p>
                  Games processed:{" "}
                  <span className="text-white font-mono">
                    {stats.brainGames.toLocaleString()}
                  </span>
                </p>
                <p>
                  Pitchers known:{" "}
                  <span className="text-white font-mono">
                    {stats.brainPitchers}
                  </span>
                </p>
              </div>
            </div>
            <div className="rounded-xl bg-[#0a0e17] border border-[#232a3d]/50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Database className="w-4 h-4 text-[#4cc9ff]" />
                <h3 className="text-sm font-bold text-white">Elo System</h3>
              </div>
              <div className="space-y-1.5 text-xs text-[#8e9ab5]">
                <p>
                  Teams tracked:{" "}
                  <span className="text-white font-mono">{stats.eloTeams}</span>
                </p>
                <p>
                  Games processed:{" "}
                  <span className="text-white font-mono">
                    {stats.eloGames.toLocaleString()}
                  </span>
                </p>
              </div>
            </div>
            <div className="rounded-xl bg-[#0a0e17] border border-[#232a3d]/50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Ticket className="w-4 h-4 text-[#f59e0b]" />
                <h3 className="text-sm font-bold text-white">Invites</h3>
              </div>
              <div className="space-y-1.5 text-xs text-[#8e9ab5]">
                <p>
                  Total created:{" "}
                  <span className="text-white font-mono">
                    {stats.invitesTotal}
                  </span>
                </p>
                <p>
                  Used:{" "}
                  <span className="text-white font-mono">
                    {stats.invitesUsed}
                  </span>
                </p>
              </div>
            </div>
            <div className="rounded-xl bg-[#0a0e17] border border-[#232a3d]/50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-[#2ee6a6]" />
                <h3 className="text-sm font-bold text-white">Users</h3>
              </div>
              <div className="space-y-1.5 text-xs text-[#8e9ab5]">
                <p>
                  Total:{" "}
                  <span className="text-white font-mono">
                    {stats.totalUsers}
                  </span>
                </p>
                <p>
                  Active (7d):{" "}
                  <span className="text-white font-mono">
                    {stats.activeUsers}
                  </span>
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function QuickStat({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: any;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div className="rounded-xl bg-[#0a0e17] border border-[#232a3d]/50 p-3 text-center">
      <Icon className="w-4 h-4 mx-auto mb-1" style={{ color }} />
      <p className="text-lg font-bold font-mono text-white">{value}</p>
      <p className="text-[9px] text-[#8e9ab5] uppercase">{label}</p>
    </div>
  );
}
