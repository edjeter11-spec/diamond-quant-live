import type { MetadataRoute } from "next";

const BASE = "https://diamond-quant-live.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${BASE}/`, lastModified: now, changeFrequency: "hourly", priority: 1.0 },
    { url: `${BASE}/track-record`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${BASE}/pricing`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${BASE}/results`, lastModified: now, changeFrequency: "hourly", priority: 0.8 },
    { url: `${BASE}/brain`, lastModified: now, changeFrequency: "daily", priority: 0.7 },
    { url: `${BASE}/leaderboard`, lastModified: now, changeFrequency: "daily", priority: 0.6 },
    { url: `${BASE}/settings`, lastModified: now, changeFrequency: "monthly", priority: 0.3 },
    { url: `${BASE}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${BASE}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];
}
