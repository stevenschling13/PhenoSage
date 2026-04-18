import { NextResponse } from "next/server";

export const runtime = "edge";

type Check = { name: string; ok: boolean; detail?: string };

function check(name: string, ok: boolean, detail?: string): Check {
  const result: Check = { name, ok };
  if (detail !== undefined) result.detail = detail;
  return result;
}

export function GET() {
  const checks: Check[] = [
    check(
      "supabase_url",
      Boolean(process.env["NEXT_PUBLIC_SUPABASE_URL"]),
      "NEXT_PUBLIC_SUPABASE_URL",
    ),
    check(
      "supabase_anon_key",
      Boolean(process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]),
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ),
    check(
      "analysis_service_url",
      Boolean(process.env["ANALYSIS_SERVICE_URL"]),
      "ANALYSIS_SERVICE_URL",
    ),
    check(
      "analysis_service_api_key",
      Boolean(process.env["ANALYSIS_SERVICE_API_KEY"]),
      "ANALYSIS_SERVICE_API_KEY",
    ),
  ];

  const ok = checks.every((c) => c.ok);
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
    timestamp: new Date().toISOString(),
  };
  return NextResponse.json(body, { status: ok ? 200 : 503 });
}
