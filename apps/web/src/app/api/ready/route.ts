import { NextResponse } from "next/server";
import {
  probeAnalysisService,
  probeBlocksReadiness,
  probeSupabase,
  probeUpstash,
  type ProbeResult,
} from "@/lib/server/ready-probes";

export const runtime = "edge";

type EnvCheck = { name: string; ok: boolean; detail?: string };

function envCheck(name: string, ok: boolean, detail?: string): EnvCheck {
  const result: EnvCheck = { name, ok };
  if (detail !== undefined) result.detail = detail;
  return result;
}

/**
 * Readiness endpoint for load balancers / uptime monitors.
 *
 * Returns 200 when:
 *   - every required env var is present (existing behaviour, kept
 *     for backward compatibility with any monitor that parses
 *     `checks`)
 *   - every CONFIGURED dependency probe (supabase / upstash /
 *     analysis-service) responded successfully within its timeout
 *
 * A `not-configured` probe (e.g. Upstash absent in a preview deploy
 * using the in-memory rate-limit fallback) is REPORTED in the
 * `probes` array but does NOT fail the readiness verdict. See
 * `probeBlocksReadiness` in `ready-probes.ts`.
 *
 * Probes run in parallel via `Promise.all`; the overall route latency
 * is therefore bounded by the slowest single probe (each capped at
 * ~1.5s internally). Connection-level failures land in `detail` as
 * opaque codes only — never raw upstream error text — because this
 * endpoint is unauthenticated and any field we emit is effectively
 * public.
 */
export async function GET() {
  const checks: EnvCheck[] = [
    envCheck(
      "supabase_url",
      Boolean(process.env["NEXT_PUBLIC_SUPABASE_URL"]),
      "NEXT_PUBLIC_SUPABASE_URL",
    ),
    envCheck(
      "supabase_anon_key",
      Boolean(process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]),
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ),
    envCheck(
      "analysis_service_url",
      Boolean(process.env["ANALYSIS_SERVICE_URL"]),
      "ANALYSIS_SERVICE_URL",
    ),
    envCheck(
      "analysis_service_api_key",
      Boolean(process.env["ANALYSIS_SERVICE_API_KEY"]),
      "ANALYSIS_SERVICE_API_KEY",
    ),
  ];

  const probes: ProbeResult[] = await Promise.all([
    probeSupabase(),
    probeUpstash(),
    probeAnalysisService(),
  ]);

  const envOk = checks.every((c) => c.ok);
  const probesOk = probes.every((p) => !probeBlocksReadiness(p));
  const ok = envOk && probesOk;

  const body = {
    status: ok ? "ok" : "not_ready",
    service: "phenosage-web",
    commit:
      process.env["VERCEL_GIT_COMMIT_SHA"] ??
      process.env["GIT_COMMIT_SHA"] ??
      "unknown",
    env:
      process.env["NEXT_PUBLIC_APP_ENV"] ?? process.env.NODE_ENV ?? "unknown",
    checks,
    probes,
    timestamp: new Date().toISOString(),
  };
  return NextResponse.json(body, { status: ok ? 200 : 503 });
}
