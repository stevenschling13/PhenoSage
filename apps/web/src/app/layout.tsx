import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { SkipLink } from "@/components/app-shell/skip-link";
import { ThemeScript } from "@/components/app-shell/theme-script";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "PhenoSage — AI Grow Operating System",
    template: "%s · PhenoSage",
  },
  description:
    "AI-powered cannabis grow OS. Visual plant analysis, longitudinal tracking, proactive alerts, and a grow-aware copilot.",
  applicationName: "PhenoSage",
  authors: [{ name: "PhenoSage" }],
  formatDetection: { email: false, telephone: false, address: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#EFEAD9" },
    { media: "(prefers-color-scheme: dark)", color: "#0D120D" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <SkipLink />
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
