import type { Metadata, Viewport } from "next";
import { AuthProvider } from "@/lib/supabase/auth";
import "./globals.css";

const SITE_URL = "https://diamond-quant-live.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Diamond-Quant Live — Sports Betting Intelligence",
    template: "%s | Diamond-Quant Live",
  },
  description: "AI-powered MLB & NBA betting analytics — 3-model consensus, live +EV picks, player prop projections, arbitrage scanner, and a self-learning brain.",
  keywords: ["sports betting", "MLB", "NBA", "expected value", "arbitrage", "player props", "parlay", "quant"],
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "DQ Live",
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "Diamond-Quant Live",
    title: "Diamond-Quant Live — Sports Betting Intelligence",
    description: "Quant-driven +EV sports picks across 10+ sportsbooks. Live arbs, player props, and a self-learning brain.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Diamond-Quant Live",
    description: "Quant-driven +EV sports picks across 10+ sportsbooks.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#00ff88",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-void text-silver antialiased">
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
