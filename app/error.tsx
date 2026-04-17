"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw, ArrowLeft } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global error:", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-void flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center">
        <div className="w-16 h-16 rounded-2xl bg-danger/10 border border-danger/25 flex items-center justify-center mx-auto mb-6">
          <AlertTriangle className="w-8 h-8 text-danger" />
        </div>
        <h1 className="text-xl font-semibold text-silver mb-2">Something broke</h1>
        <p className="text-sm text-mercury/70 mb-2">
          We hit an unexpected error. Try reloading — if it keeps happening, take a screenshot and tell us.
        </p>
        {error?.digest && (
          <p className="text-[10px] text-mercury/40 font-mono mb-6">ref: {error.digest}</p>
        )}
        <div className="flex items-center justify-center gap-3 mt-6">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-neon/15 border border-neon/30 text-neon text-sm font-semibold hover:bg-neon/25 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Try Again
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gunmetal/50 border border-slate/30 text-mercury text-sm hover:bg-gunmetal/70 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
