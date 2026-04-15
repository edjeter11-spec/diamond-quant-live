"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/supabase/auth";
import { X, Mail, Lock, User, Ticket, Loader2 } from "lucide-react";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const { signInWithEmail, signUpWithEmail, signInWithGoogle } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  // Reset state when modal closes and reopens
  useEffect(() => {
    if (isOpen) {
      setError(null);
      setSuccess(false);
      setLoading(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (mode === "signin") {
      const { error: err } = await signInWithEmail(email, password);
      if (err) setError(err);
      else onClose();
    } else {
      if (!displayName.trim()) { setError("Display name required"); setLoading(false); return; }
      const { error: err } = await signUpWithEmail(email, password, displayName, inviteCode || undefined);
      if (err) setError(err);
      else {
        setSuccess(true);
        setTimeout(onClose, 2000);
      }
    }
    setLoading(false);
  };

  const handleGoogle = async () => {
    setError(null);
    setLoading(true);
    const { error: err } = await signInWithGoogle();
    if (err) setError(err);
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-sm rounded-2xl bg-bunker border border-slate/30 shadow-2xl overflow-hidden animate-slide-up">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-slate/20">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-silver">
              {mode === "signin" ? "Welcome Back" : "Create Account"}
            </h2>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-gunmetal/50 transition-colors">
              <X className="w-4 h-4 text-mercury" />
            </button>
          </div>
          <p className="text-xs text-mercury/60 mt-1">
            {mode === "signin"
              ? "Sign in to sync your data across devices"
              : "Join Diamond-Quant Live — your picks, your bankroll, everywhere"}
          </p>
        </div>

        {/* Success state */}
        {success ? (
          <div className="p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-neon/10 flex items-center justify-center mx-auto mb-3">
              <Mail className="w-6 h-6 text-neon" />
            </div>
            <p className="text-sm font-semibold text-silver">Check your email</p>
            <p className="text-xs text-mercury/60 mt-1">Click the confirmation link to activate your account</p>
          </div>
        ) : (
          <div className="p-6 space-y-4">
            {/* Tab toggle */}
            <div className="flex bg-gunmetal/50 rounded-lg p-0.5">
              <button
                onClick={() => { setMode("signin"); setError(null); }}
                className={`flex-1 py-2 rounded-md text-xs font-semibold transition-all ${
                  mode === "signin" ? "bg-electric/20 text-electric" : "text-mercury/60 hover:text-mercury"
                }`}
              >Sign In</button>
              <button
                onClick={() => { setMode("signup"); setError(null); }}
                className={`flex-1 py-2 rounded-md text-xs font-semibold transition-all ${
                  mode === "signup" ? "bg-neon/20 text-neon" : "text-mercury/60 hover:text-mercury"
                }`}
              >Sign Up</button>
            </div>

            {/* Google OAuth */}
            <button
              onClick={handleGoogle}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-white/5 border border-slate/30 text-sm text-silver font-medium hover:bg-white/10 transition-all disabled:opacity-50"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </button>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-slate/20" />
              <span className="text-[10px] text-mercury/40 uppercase">or</span>
              <div className="flex-1 h-px bg-slate/20" />
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-3">
              {mode === "signup" && (
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mercury/40" />
                  <input
                    type="text"
                    placeholder="Display name"
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-gunmetal/50 border border-slate/20 text-sm text-silver placeholder:text-mercury/30 focus:border-electric/50 focus:outline-none transition-colors"
                  />
                </div>
              )}
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mercury/40" />
                <input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-gunmetal/50 border border-slate/20 text-sm text-silver placeholder:text-mercury/30 focus:border-electric/50 focus:outline-none transition-colors"
                />
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mercury/40" />
                <input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-gunmetal/50 border border-slate/20 text-sm text-silver placeholder:text-mercury/30 focus:border-electric/50 focus:outline-none transition-colors"
                />
              </div>
              {mode === "signup" && (
                <div className="relative">
                  <Ticket className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mercury/40" />
                  <input
                    type="text"
                    placeholder="Invite code (optional)"
                    value={inviteCode}
                    onChange={e => setInviteCode(e.target.value.toUpperCase())}
                    maxLength={6}
                    className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-gunmetal/50 border border-slate/20 text-sm text-silver placeholder:text-mercury/30 focus:border-electric/50 focus:outline-none transition-colors font-mono uppercase"
                  />
                </div>
              )}

              {error && (
                <div className="px-3 py-2 rounded-lg bg-danger/10 border border-danger/20">
                  <p className="text-xs text-danger">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className={`w-full py-2.5 rounded-lg font-semibold text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2 ${
                  mode === "signin"
                    ? "bg-electric/20 text-electric border border-electric/30 hover:bg-electric/30"
                    : "bg-neon/20 text-neon border border-neon/30 hover:bg-neon/30"
                }`}
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {mode === "signin" ? "Sign In" : "Create Account"}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
