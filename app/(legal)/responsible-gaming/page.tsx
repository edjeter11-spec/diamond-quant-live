import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Responsible Gaming — Diamond-Quant Live",
  description: "Play smart. Set limits. Get help when you need it.",
};

export default function ResponsibleGamingPage() {
  return (
    <article className="space-y-5">
      <header>
        <h1 className="text-3xl font-bold text-silver mb-2">Responsible Gaming</h1>
        <p className="text-sm text-mercury/70 leading-relaxed">
          Sports betting can be enjoyable — but only when you&apos;re in control. Here&apos;s how to keep it that way, and where to get help if you can&apos;t.
        </p>
      </header>

      <section className="rounded-xl border border-amber/25 bg-amber/5 p-4">
        <p className="text-sm font-semibold text-amber mb-1">You must be of legal gambling age.</p>
        <p className="text-xs text-mercury/70">
          This Service is intended for users 21+ in the United States (or 18+ where locally permitted). Underage use is prohibited.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-silver mt-6">Our commitments</h2>
        <ul className="text-sm text-mercury/80 leading-relaxed list-disc pl-5 space-y-1">
          <li>We never market to minors or vulnerable populations.</li>
          <li>We don&apos;t accept or broker wagers — all betting happens through licensed sportsbooks of your choice.</li>
          <li>We surface expected-value math and bankroll tools so you can make informed decisions, not chase losses.</li>
          <li>Our Kelly calculator defaults to fractional Kelly and warns against staking more than 5% of bankroll.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-silver mt-6">Set limits before you bet</h2>
        <ul className="text-sm text-mercury/80 leading-relaxed list-disc pl-5 space-y-1">
          <li><strong className="text-silver">Bankroll:</strong> only bet money you can comfortably lose.</li>
          <li><strong className="text-silver">Per-bet size:</strong> cap any single bet at 2–5% of bankroll.</li>
          <li><strong className="text-silver">Time:</strong> set a session length and walk away when it&apos;s up.</li>
          <li><strong className="text-silver">Chasing:</strong> never increase stakes to &quot;win back&quot; losses.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-silver mt-6">Warning signs</h2>
        <p className="text-sm text-mercury/80 leading-relaxed">
          If betting is affecting your finances, sleep, relationships, or work — or if you&apos;re hiding it from people close to you — it&apos;s time to talk to someone. These free, confidential resources can help.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-silver mt-6">Get help</h2>
        <div className="space-y-3">
          <div className="rounded-xl border border-slate/25 bg-gunmetal/30 p-4">
            <p className="text-sm font-semibold text-silver">National Problem Gambling Helpline (US)</p>
            <p className="text-xs text-mercury/70 mt-0.5">24/7, free, confidential</p>
            <p className="text-lg font-mono font-bold text-neon mt-2">1-800-GAMBLER (1-800-426-2537)</p>
            <p className="text-xs text-electric/80 mt-1">Text: 800GAM · Chat: ncpgambling.org/chat</p>
          </div>
          <div className="rounded-xl border border-slate/25 bg-gunmetal/30 p-4">
            <p className="text-sm font-semibold text-silver">Gamblers Anonymous</p>
            <p className="text-xs text-mercury/70 mt-0.5">Peer-support meetings worldwide</p>
            <p className="text-sm text-electric mt-1">gamblersanonymous.org</p>
          </div>
          <div className="rounded-xl border border-slate/25 bg-gunmetal/30 p-4">
            <p className="text-sm font-semibold text-silver">Self-Exclusion</p>
            <p className="text-xs text-mercury/70 mt-0.5">
              Most US states and sportsbooks offer voluntary self-exclusion programs that block you from betting for a set period.
              Ask your sportsbook or contact your state&apos;s gaming commission.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-2 mt-8">
        <p className="text-xs text-mercury/50 leading-relaxed">
          If you or someone you know has a gambling problem, call 1-800-GAMBLER. Must be 21+ (18+ in some jurisdictions). Gambling problem? Help is available.
        </p>
      </section>
    </article>
  );
}
