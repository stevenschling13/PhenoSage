import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const REQUIRED_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "ANALYSIS_SERVICE_URL",
  "ANALYSIS_SERVICE_API_KEY",
  "CRON_SECRET",
  "READINESS_PROBE_SECRET",
] as const;

export function GET(request: NextRequest) {
  const expected = process.env["READINESS_PROBE_SECRET"];
  const auth = request.headers.get("authorization");

  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Unauthorized" } },
      { status: 401 },
    );
  }

  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  const ok = missing.length === 0;

  return NextResponse.json(
    {
      status: ok ? "ok" : "not_ready",
      service: "phenosage-web",
      timestamp: new Date().toISOString(),
      checks: {
        required_env_present: ok,
        missing_count: missing.length,
      },
    },
    { status: ok ? 200 : 503 },
  );
}
