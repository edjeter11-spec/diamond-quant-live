// Server component — renders JSON-LD structured data for SEO.
// Google + Bing + DuckDuckGo will parse this and may show rich snippets
// (star ratings, FAQ accordion, product price, etc) in search results.

import { cloudGet } from "@/lib/supabase/client";

interface PropHistItem {
  result?: string;
}

// Same sample floor as components/dashboard/StatsStrip.tsx. This file feeds
// Google rich snippets, so a thin-sample percentage here gets quoted in
// search results where no caption travels with it.
const MIN_SAMPLE = 30;

async function getLiveStats() {
  try {
    const history = ((await cloudGet<PropHistItem[]>(
      "prop_pick_history_nba",
      [],
    )) ?? []) as PropHistItem[];
    const wins = history.filter((p) => p.result === "win").length;
    const losses = history.filter((p) => p.result === "loss").length;
    const total = wins + losses;
    const winRate = total > 0 ? Math.round((wins / total) * 1000) / 10 : 0;
    return { wins, losses, total, winRate };
  } catch {
    return { wins: 0, losses: 0, total: 0, winRate: 0 };
  }
}

export default async function StructuredData() {
  const stats = await getLiveStats();

  // SoftwareApplication (so Google can show price + rating)
  const app = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Quant Betting",
    description:
      "AI-powered NBA & MLB sports betting analytics. Self-evolving prop brain, live arbitrage scanner, +EV pick finder.",
    url: "https://diamond-quant-live.vercel.app",
    applicationCategory: "FinanceApplication",
    operatingSystem: "Any (Web)",
    offers: {
      "@type": "Offer",
      price: "15.00",
      priceCurrency: "USD",
      priceValidUntil: "2026-12-31",
      availability: "https://schema.org/InStock",
    },
    // Raised from 20 to MIN_SAMPLE: this rating is derived from winRate, so
    // it inherits the same sample-floor requirement as the rate itself.
    aggregateRating:
      stats.total >= MIN_SAMPLE
        ? {
            "@type": "AggregateRating",
            ratingValue: Math.min(5, 3 + (stats.winRate - 50) / 10).toFixed(1),
            reviewCount: stats.total,
            bestRating: 5,
            worstRating: 1,
          }
        : undefined,
  };

  // Organization
  const org = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Quant Betting",
    url: "https://diamond-quant-live.vercel.app",
    logo: "https://diamond-quant-live.vercel.app/apple-icon",
  };

  // FAQ
  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "How does Quant Betting make its picks?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "A self-evolving NBA prop brain trained on thousands of games projects player stats vs the line. Auto-trained nightly, auto-evolved weekly via tournament selection.",
        },
      },
      {
        "@type": "Question",
        name: "What's the win rate?",
        acceptedAnswer: {
          "@type": "Answer",
          // Below MIN_SAMPLE we state the record, not a rate — a percentage
          // in a rich snippet travels with no sample-size caption attached.
          text:
            stats.total >= MIN_SAMPLE
              ? `${stats.winRate}% on ${stats.total} graded NBA prop picks. Track record is public and verified against ESPN box scores.`
              : stats.total > 0
                ? `${stats.wins}-${stats.losses} on ${stats.total} graded NBA prop picks so far — too small a sample to quote a meaningful win rate. Track record is public and verified against ESPN box scores.`
                : "Track record is public — graded against ESPN box scores after every game.",
        },
      },
      {
        "@type": "Question",
        name: "Is there a free trial?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Yes — 7-day free trial. Cancel anytime, no credit card surprises.",
        },
      },
      {
        "@type": "Question",
        name: "What sports are covered?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "NBA player props (points, rebounds, assists) and MLB player props (strikeouts, hits, home runs, RBIs, outs, total bases, runs).",
        },
      },
    ],
  };

  // Escape `</` so a stray "</script>" in any string field can't break out
  const safeJson = (obj: unknown) =>
    JSON.stringify(obj).replace(/</g, "\\u003c");

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJson(app) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJson(org) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJson(faq) }}
      />
    </>
  );
}
