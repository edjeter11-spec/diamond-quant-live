import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Diamond-Quant Live",
  description: "How Diamond-Quant Live collects, uses, and protects your data.",
};

export default function PrivacyPage() {
  return (
    <article className="space-y-5">
      <header>
        <h1 className="text-3xl font-bold text-silver mb-2">Privacy Policy</h1>
        <p className="text-xs text-mercury/60 font-mono">Last updated: April 17, 2026</p>
      </header>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-silver mt-6">What we collect</h2>
        <ul className="text-sm text-mercury/80 leading-relaxed list-disc pl-5 space-y-1">
          <li><strong className="text-silver">Account data:</strong> email address, authentication tokens (via Supabase).</li>
          <li><strong className="text-silver">Usage data:</strong> your bankroll, logged bets, parlays, preferences. Stored to your account so they sync across devices.</li>
          <li><strong className="text-silver">Diagnostic data:</strong> standard server logs (IP, user agent, timestamps) retained 30 days for security and debugging.</li>
          <li><strong className="text-silver">Uploaded images:</strong> bet-slip screenshots are sent to Google Gemini for OCR and are <em>not</em> stored on our servers after parsing.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-silver mt-6">What we don&apos;t collect</h2>
        <ul className="text-sm text-mercury/80 leading-relaxed list-disc pl-5 space-y-1">
          <li>Payment or financial information — we don&apos;t process payments.</li>
          <li>Sportsbook login credentials — we never ask for them.</li>
          <li>Your real-world wagers — only what you voluntarily log.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-silver mt-6">How we use data</h2>
        <p className="text-sm text-mercury/80 leading-relaxed">
          Your data is used solely to provide the Service: storing your bankroll, syncing your bets across devices, training self-learning models in the aggregate, and sending you notifications you&apos;ve opted into. We do not sell user data.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-silver mt-6">Third-party services</h2>
        <ul className="text-sm text-mercury/80 leading-relaxed list-disc pl-5 space-y-1">
          <li><strong className="text-silver">Supabase:</strong> auth + data storage.</li>
          <li><strong className="text-silver">Vercel:</strong> application hosting.</li>
          <li><strong className="text-silver">Google Gemini:</strong> bet-slip OCR (images processed, not retained).</li>
          <li><strong className="text-silver">The Odds API:</strong> sportsbook odds feed.</li>
          <li><strong className="text-silver">MLB / NBA Stats APIs:</strong> team and player statistics.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-silver mt-6">Your rights</h2>
        <ul className="text-sm text-mercury/80 leading-relaxed list-disc pl-5 space-y-1">
          <li><strong className="text-silver">Access:</strong> request a copy of your data.</li>
          <li><strong className="text-silver">Deletion:</strong> delete your account and all associated data at any time.</li>
          <li><strong className="text-silver">Portability:</strong> export your bet history as CSV (Bankroll tab &rarr; Export).</li>
          <li><strong className="text-silver">Opt-out:</strong> disable notifications and cloud sync in settings.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-silver mt-6">Cookies</h2>
        <p className="text-sm text-mercury/80 leading-relaxed">
          We use only essential cookies required for authentication and session management. We do not use third-party advertising or tracking cookies.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-silver mt-6">Changes</h2>
        <p className="text-sm text-mercury/80 leading-relaxed">
          Material changes to this policy will be posted here with an updated date. Continued use after changes indicates acceptance.
        </p>
      </section>
    </article>
  );
}
