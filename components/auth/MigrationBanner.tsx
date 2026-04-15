"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/supabase/auth";
import { migrateLocalToUser } from "@/lib/supabase/user-sync";
import { Upload, Check, X, Loader2 } from "lucide-react";

export default function MigrationBanner() {
  const { user } = useAuth();
  const [show, setShow] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [result, setResult] = useState<{ migrated: string[]; skipped: string[] } | null>(null);

  useEffect(() => {
    if (!user) { setShow(false); return; }
    // Check if user has local data that hasn't been migrated
    const hasMigrated = localStorage.getItem(`dq_migrated_${user.id}`);
    if (hasMigrated) return;

    const hasLocalData = ["dq_bankroll", "dq_betHistory", "dq_savedParlays", "dq_smart_bot"]
      .some(key => localStorage.getItem(key));
    setShow(hasLocalData);
  }, [user]);

  if (!show || !user) return null;

  const handleMigrate = async () => {
    setMigrating(true);
    const res = await migrateLocalToUser();
    setResult(res);
    localStorage.setItem(`dq_migrated_${user.id}`, "true");
    setMigrating(false);
    setTimeout(() => setShow(false), 3000);
  };

  const handleDismiss = () => {
    if (user) localStorage.setItem(`dq_migrated_${user.id}`, "skipped");
    setShow(false);
  };

  return (
    <div className="max-w-[1800px] mx-auto px-3 sm:px-4 pt-2">
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-purple/5 border border-purple/20 animate-slide-up">
        <Upload className="w-5 h-5 text-purple flex-shrink-0" />
        <div className="flex-1">
          {result ? (
            <p className="text-xs text-neon font-medium">
              Migrated {result.migrated.length} data sets to your account
            </p>
          ) : (
            <>
              <p className="text-xs text-silver font-semibold">Local data detected</p>
              <p className="text-[10px] text-mercury/60">Import your existing bankroll, bets, and picks to your new account?</p>
            </>
          )}
        </div>
        {!result && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleMigrate}
              disabled={migrating}
              className="px-3 py-1.5 rounded-lg bg-purple/15 border border-purple/25 text-purple text-[11px] font-semibold hover:bg-purple/25 transition-all flex items-center gap-1 disabled:opacity-50"
            >
              {migrating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              Import
            </button>
            <button onClick={handleDismiss} className="p-1 rounded-lg hover:bg-gunmetal/50 transition-colors">
              <X className="w-4 h-4 text-mercury/40" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
