import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — Diamond-Quant Live",
  description: "Terms governing use of Diamond-Quant Live betting analytics.",
};

export default function TermsPage() {
  return (
    <article className="space-y-5">
      <header>
        <h1 className="text-3xl font-bold text-silver mb-2">Terms of Service</h1>
        <p className="text-xs text-mercury/60 font-mono">Last updated: April 17, 2026</p>
      </header>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-silver mt-6">1. Acceptance of Terms</h2>
        <p className="text-sm text-mercury/80 leading-relaxed">
          By accessing or using Diamond-Quant Live (&quot;the Service&quot;), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service. You must be of legal gambling age in your jurisdiction (18+ or 21+ depending on location) to use the Service.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-silver mt-6">2. Nature of the Service</h2>
        <p className="text-sm text-mercury/80 leading-relaxed">
          Diamond-Quant Live is an informational and analytical platform that aggregates publicly available sportsbook odds and applies statistical models. <strong className="text-silver">We do not accept, facilitate, or broker wagers of any kind.</strong> All betting decisions are made independently by you through third-party licensed sportsbooks.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-silver mt-6">3. No Guarantees</h2>
        <p className="text-sm text-mercury/80 leading-relaxed">
          Picks, projections, expected value calculations, and model outputs are informational only. Past performance does not guarantee future results. Gambling involves substantial risk of loss. You are solely responsible for your financial decisions.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-silver mt-6">4. User Account</h2>
        <p className="text-sm text-mercury/80 leading-relaxed">
          You are responsible for maintaining the confidentiality of your account credentials. Any data you log (bet history, bankroll) is stored to your account. You may delete your account at any time by contacting support.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-silver mt-6">5. Acceptable Use</h2>
        <ul className="text-sm text-mercury/80 leading-relaxed list-disc pl-5 space-y-1">
          <li>You will not scrape, reverse-engineer, or redistribute the Service&apos;s data or models.</li>
          <li>You will not use the Service in any jurisdiction where sports wagering is prohibited.</li>
          <li>You will not attempt to disrupt the Service or access other users&apos; data.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-silver mt-6">6. Limitation of Liability</h2>
        <p className="text-sm text-mercury/80 leading-relaxed">
          The Service is provided &quot;as is&quot; without warranty of any kind. In no event shall Diamond-Quant Live or its operators be liable for any direct, indirect, incidental, or consequential damages arising from your use of the Service, including any losses from wagers placed based on information displayed.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-silver mt-6">7. Third-Party Data</h2>
        <p className="text-sm text-mercury/80 leading-relaxed">
          Odds data is sourced from The Odds API and licensed sportsbooks. Statistical data is sourced from MLB Stats API and NBA Stats API. We are not affiliated with any sportsbook or league.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-silver mt-6">8. Changes to Terms</h2>
        <p className="text-sm text-mercury/80 leading-relaxed">
          We may update these Terms at any time. Continued use of the Service after changes constitutes acceptance. Material changes will be posted on this page with an updated &quot;Last updated&quot; date.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-silver mt-6">9. Contact</h2>
        <p className="text-sm text-mercury/80 leading-relaxed">
          Questions? Email support at the address listed in your account settings.
        </p>
      </section>
    </article>
  );
}
