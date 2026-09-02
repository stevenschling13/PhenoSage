import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-errors";
import { getOrCreateRequestId } from "@/lib/server/request-id";
import {
  verifyBearerToken,
  verifySharedSecret,
} from "@/lib/server/shared-secret";

type Check = { name: string; ok: boolean };

function authorized(request: NextRequest): boolean {
  const secret = process.env["READINESS_PROBE_SECRET"];
  if (!secret) return false;
  const bearer = request.headers.get("authorization");
  if (verifyBearerToken(bearer, secret)) return true;
  return verifySharedSecret(request.nextUrl.searchParams.get("secret"), secret);
}

export function GET(request: NextRequest) {
  const requestId = getOrCreateRequestId(request);
  if (!authorized(request)) {
    return apiError(403, "FORBIDDEN", "Forbidden", requestId);
  }

  const checks: Check[] = [
    {
      name: "supabase_url",
      ok: Boolean(process.env["NEXT_PUBLIC_SUPABASE_URL"]),
    },
    {
      name: "supabase_anon_key",
      ok: Boolean(process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"]),
    },
    {
      name: "analysis_service_url",
      ok: Boolean(process.env["ANALYSIS_SERVICE_URL"]),
    },
    {
      name: "analysis_service_api_key",
      ok: Boolean(process.env["ANALYSIS_SERVICE_API_KEY"]),
    },
  ];
  const ok = checks.every((check) => check.ok);
  return NextResponse.json(
    {
      status: ok ? "ok" : "not_ready",
      service: "phenosage-web",
      requestId,
      checks,
      commit:
        process.env["VERCEL_GIT_COMMIT_SHA"] ??
        process.env["GIT_COMMIT_SHA"] ??
        "unknown",
      env:
        process.env["NEXT_PUBLIC_APP_ENV"] ??
        process.env["NODE_ENV"] ??
        "unknown",
    },
    { status: ok ? 200 : 503 },
  );
}
