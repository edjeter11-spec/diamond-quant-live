"use client";

import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/lib/supabase/auth";
import AuthModal from "./AuthModal";
import { User, LogOut, Settings, Crown, Copy, Check, ChevronDown } from "lucide-react";

export default function AuthButton() {
  const { user, profile, isAdmin, signOut, loading } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [copied, setCopied] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const copyInviteCode = () => {
    if (profile?.invite_code) {
      navigator.clipboard.writeText(profile.invite_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) {
    return <div className="w-8 h-8 rounded-full bg-gunmetal/50 animate-pulse" />;
  }

  // Not logged in
  if (!user) {
    return (
      <>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-electric/10 border border-electric/20 text-electric text-[11px] font-semibold hover:bg-electric/20 transition-all"
        >
          <User className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Sign In</span>
        </button>
        <AuthModal isOpen={showModal} onClose={() => setShowModal(false)} />
      </>
    );
  }

  // Logged in
  const initial = (profile?.display_name?.[0] || user.email?.[0] || "?").toUpperCase();
  const avatarUrl = profile?.avatar_url || user.user_metadata?.avatar_url;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="flex items-center gap-1.5 px-1.5 py-1 rounded-lg hover:bg-gunmetal/50 transition-colors"
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="w-7 h-7 rounded-full border border-neon/30" />
        ) : (
          <div className="w-7 h-7 rounded-full bg-neon/20 border border-neon/30 flex items-center justify-center text-neon text-xs font-bold">
            {initial}
          </div>
        )}
        <ChevronDown className={`w-3 h-3 text-mercury/50 transition-transform ${showDropdown ? "rotate-180" : ""}`} />
      </button>

      {/* Dropdown */}
      {showDropdown && (
        <div className="absolute right-0 top-full mt-1 w-64 rounded-xl bg-bunker border border-slate/30 shadow-2xl overflow-hidden z-50 animate-slide-up">
          {/* User info */}
          <div className="px-4 py-3 border-b border-slate/20">
            <div className="flex items-center gap-2">
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="w-9 h-9 rounded-full border border-neon/30" />
              ) : (
                <div className="w-9 h-9 rounded-full bg-neon/20 border border-neon/30 flex items-center justify-center text-neon text-sm font-bold">
                  {initial}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <p className="text-sm font-semibold text-silver truncate">{profile?.display_name || "User"}</p>
                  {isAdmin && <Crown className="w-3 h-3 text-gold flex-shrink-0" />}
                </div>
                <p className="text-[10px] text-mercury/50 truncate">{user.email}</p>
              </div>
            </div>
          </div>

          {/* Invite code */}
          {profile?.invite_code && (
            <div className="px-4 py-2.5 border-b border-slate/20">
              <p className="text-[9px] text-mercury/50 uppercase tracking-wider mb-1">Your Invite Code</p>
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-neon font-bold tracking-wider">{profile.invite_code}</code>
                <button
                  onClick={copyInviteCode}
                  className="p-1 rounded hover:bg-gunmetal/50 transition-colors"
                  title="Copy invite code"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-neon" /> : <Copy className="w-3.5 h-3.5 text-mercury/50" />}
                </button>
                <span className="text-[9px] text-mercury/40 ml-auto">{profile.invites_remaining} left</span>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="p-1.5">
            {isAdmin && (
              <a
                href="/admin"
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-gold hover:bg-gold/5 transition-colors"
                onClick={() => setShowDropdown(false)}
              >
                <Crown className="w-3.5 h-3.5" />
                Admin Panel
              </a>
            )}
            <a
              href="/leaderboard"
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-mercury hover:bg-gunmetal/50 transition-colors"
              onClick={() => setShowDropdown(false)}
            >
              <Settings className="w-3.5 h-3.5" />
              Leaderboard
            </a>
            <button
              onClick={() => { signOut(); setShowDropdown(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-danger hover:bg-danger/5 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
