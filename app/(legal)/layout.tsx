import Link from "next/link";
import { Diamond, ArrowLeft } from "lucide-react";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-void text-silver">
      <header className="border-b border-slate/30 bg-bunker/80 backdrop-blur-lg sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-mercury hover:text-silver transition-colors">
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">Back</span>
          </Link>
          <Link href="/" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-neon/20 to-electric/20 border border-neon/25 flex items-center justify-center">
              <Diamond className="w-4 h-4 text-neon" />
            </div>
            <span className="text-sm font-bold">DQ Live</span>
          </Link>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12 prose-legal">
        {children}
      </main>
      <footer className="border-t border-slate/20 mt-12 py-6 px-4">
        <div className="max-w-3xl mx-auto flex flex-wrap items-center justify-center gap-4 text-[11px] text-mercury/50">
          <Link href="/terms" className="hover:text-mercury transition-colors">Terms</Link>
          <span>·</span>
          <Link href="/privacy" className="hover:text-mercury transition-colors">Privacy</Link>
          <span>·</span>
          <Link href="/responsible-gaming" className="hover:text-mercury transition-colors">Responsible Gaming</Link>
        </div>
      </footer>
    </div>
  );
}
