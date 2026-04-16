import type { Metadata, Viewport } from "next";
import { AuthProvider } from "@/lib/supabase/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Diamond-Quant Live | Sports Betting Intelligence",
  description: "AI-powered MLB & NBA betting analytics with 3-model consensus, player prop projections, and self-learning brain.",
  icons: { icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>💎</text></svg>" },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "DQ Live",
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
