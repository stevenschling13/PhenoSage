import { NextResponse } from "next/server";
import { publicCache } from "@/lib/server/response-headers";

export const runtime = "edge";

/**
 * Lightweight liveness signal. Returns the build's deploy metadata
 * with **no** dependency probes — that's `/api/ready`'s job, which
 * the load balancer should call instead when it wants to know whether
 * we can serve traffic.
 *
 * We allow a short public cache (60s with a 5-minute SWR window) so a
 * burst of healthcheck hits — Vercel's edge + uptime monitors + the
 * occasional curl from on-call — can be served without forcing a
 * fresh function invocation each time. The body carries no
 * user-specific data, only deploy metadata; safe to share at the CDN
 * tier.
 */
export function GET() {
  const response = NextResponse.json({
    status: "ok",
    service: "phenosage-web",
    env:
      process.env["NEXT_PUBLIC_APP_ENV"] ?? process.env.NODE_ENV ?? "unknown",
    commit:
      process.env["VERCEL_GIT_COMMIT_SHA"] ??
      process.env["GIT_COMMIT_SHA"] ??
      "unknown",
    timestamp: new Date().toISOString(),
  });
  return publicCache(response, {
    maxAgeSeconds: 60,
    staleWhileRevalidateSeconds: 300,
  });
}
