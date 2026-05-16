import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";

const ORIGINAL_ENV = process.env;

function request(headers?: Record<string, string>) {
  return new NextRequest("http://localhost/api/internal/ready", {
    ...(headers ? { headers } : {}),
  });
}

describe("GET /api/internal/ready", () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      READINESS_PROBE_SECRET: "probe-secret",
      NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      ANALYSIS_SERVICE_URL: "http://analysis:8000",
      ANALYSIS_SERVICE_API_KEY: "api-key",
    };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("returns 403 without the readiness secret", async () => {
    const res = GET(request());
    expect(res.status).toBe(403);
  });

  it("returns readiness checks with a bearer secret", async () => {
    const res = GET(request({ authorization: "Bearer probe-secret" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.checks.every((check: { ok: boolean }) => check.ok)).toBe(true);
  });
});
