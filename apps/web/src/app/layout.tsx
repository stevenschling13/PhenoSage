import type { Metadata } from "next";
import { IBM_Plex_Mono, Manrope } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

const sans = Manrope({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
  weight: ["400", "500"],
});

const isVercelRuntime = process.env["VERCEL"] === "1";

export const metadata: Metadata = {
  title: {
    default: "PhenoSage",
    template: "%s | PhenoSage",
  },
  description:
    "Cultivation intelligence platform for serious cannabis growers. Visual diagnostics, longitudinal tracking, proactive alerts, and a grow-aware copilot in one private workspace.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={`${sans.variable} ${mono.variable} min-h-screen bg-background antialiased`}
      >
        {children}
        {isVercelRuntime ? (
          <>
            <Analytics />
            <SpeedInsights />
          </>
        ) : null}
      </body>
    </html>
  );
}
