import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "PhenoSage",
    template: "%s | PhenoSage",
  },
  description:
    "AI-powered cannabis grow operating system. Professional plant analysis, timeline tracking, proactive alerts, and grow-aware chatbot.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background antialiased">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
