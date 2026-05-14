import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/admin",
          "/settings",
          "/slip/",
        ],
      },
    ],
    sitemap: "https://diamond-quant-live.vercel.app/sitemap.xml",
    host: "https://diamond-quant-live.vercel.app",
  };
}
