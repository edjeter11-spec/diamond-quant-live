import Link from "next/link";
import { Diamond, ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-void flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-neon/20 to-electric/20 border border-neon/25 flex items-center justify-center mx-auto mb-6">
          <Diamond className="w-8 h-8 text-neon" />
        </div>
        <p className="text-6xl font-bold text-silver tracking-tighter mb-2">404</p>
        <h1 className="text-xl font-semibold text-silver mb-2">Page not found</h1>
        <p className="text-sm text-mercury/70 mb-6">
          The pick you&apos;re looking for didn&apos;t cover the spread. Let&apos;s get you back to the board.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-neon/15 border border-neon/30 text-neon text-sm font-semibold hover:bg-neon/25 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
