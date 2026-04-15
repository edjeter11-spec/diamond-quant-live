import type { Metadata, Viewport } from "next";
import { AuthProvider } from "@/lib/supabase/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Diamond-Quant Live | MLB Betting Intelligence",
  description: "Real-time MLB betting analytics, arbitrage detection, and quantitative modeling for sharp sports bettors.",
  icons: { icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>💎</text></svg>" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
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
