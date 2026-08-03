import type { Metadata } from "next";

const SITE = "https://diamond-quant-live.vercel.app";

export const metadata: Metadata = {
  title: "Track Record — Quant Betting",
  description:
    "Public 30-day track record for our AI sports betting picks. Every MLB & NBA pick graded nightly — wins, losses, units, and full transparency.",
  alternates: { canonical: `${SITE}/results` },
  openGraph: {
    title: "Quant Betting — 30-Day Track Record",
    description:
      "Every pick logged, graded, and public. See how the quant brain is performing.",
    url: `${SITE}/results`,
    siteName: "Quant Betting",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Quant Betting — 30-Day Track Record",
    description: "Every pick logged, graded, and public.",
  },
};

async function fetchStats() {
  try {
    // Hard timeout — this runs during `next build`'s static generation too,
    // where the deployment being built isn't live yet at SITE. An unbounded
    // fetch here previously hung the Vercel build past its 60s cap.
    const res = await fetch(`${SITE}/api/results?days=30`, {
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return d.ok ? d : null;
  } catch {
    return null;
  }
}

export default async function ResultsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const stats = await fetchStats();
  const overall = stats?.overall;

  // JSON-LD structured data — helps Google understand this is a Dataset / track record
  const jsonLd: any = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "Quant Betting — Track Record",
    url: `${SITE}/results`,
    description:
      "Public track record for AI-driven sports betting picks. 30-day rolling window, all picks graded.",
    publisher: {
      "@type": "Organization",
      name: "Quant Betting",
      url: SITE,
    },
  };
  // Raised from 5 to the MIN_SAMPLE floor used in StatsStrip.tsx — this
  // description publishes a win-rate percentage to search engines, where it
  // appears with no sample-size context of its own.
  if (overall?.total >= 30) {
    jsonLd.mainEntity = {
      "@type": "Dataset",
      name: "30-Day Pick Performance",
      description: `${overall.wins} wins, ${overall.losses} losses, ${(overall.winRate * 100).toFixed(1)}% win rate, ${overall.profitUnits.toFixed(1)}u profit`,
      measurementTechnique: "Daily automated settlement against final scores",
      variableMeasured: ["win_rate", "profit_units", "total_picks"],
    };
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      {children}
    </>
  );
}
