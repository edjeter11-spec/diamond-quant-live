/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "midfield.mlbstatic.com" },
      { protocol: "https", hostname: "img.mlbstatic.com" },
      { protocol: "https", hostname: "cdn.nba.com" },
    ],
  },
};

module.exports = nextConfig;
