/**
 * @type {import('next').NextConfig}
 *
 * Security headers:
 *  - HSTS: 2y with preload
 *  - CSP: strict default-src, inline-allowed styles for Tailwind, self-only connect-src
 *    plus any configured Supabase + analysis service origins
 *  - Modern Cross-Origin policies (COOP / COEP-relaxed for images / CORP)
 *  - Referrer + Permissions Policy restricting sensors
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseOrigin(value) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function buildCSP() {
  const supabase = parseOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const appUrl = parseOrigin(process.env.NEXT_PUBLIC_APP_URL);
  const extraConnect = [supabase, appUrl].filter(Boolean).join(" ");

  const directives = [
    "default-src 'self'",
    // Next.js ships inline bootstrap + runtime chunks. 'strict-dynamic' would be
    // stricter; pending a nonce-based rollout, allow unsafe-inline for scripts.
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${extraConnect} https://vitals.vercel-insights.com`.trim(),
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ];
  return directives.join("; ");
}

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Emit a self-contained server tree under `.next/standalone` so non-Vercel
  // deploys (Docker / Railway) ship only the files Next's tracer determined
  // are reachable instead of the full pnpm workspace node_modules. Vercel
  // ignores this and bundles via its own tracer, so this is a no-op there.
  // `outputFileTracingRoot` is required in a pnpm workspace so the tracer
  // walks up out of `apps/web` and follows the workspace:* symlinks into
  // `packages/shared`.
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  serverExternalPackages: [],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/sign/**",
      },
    ],
  },
  async headers() {
    const securityHeaders = [
      { key: "Content-Security-Policy", value: buildCSP() },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value:
          "camera=(self), microphone=(), geolocation=(), browsing-topics=()",
      },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
      {
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      },
    ];
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
