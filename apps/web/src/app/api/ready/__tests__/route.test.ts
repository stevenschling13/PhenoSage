import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";

const ORIGINAL_ENV = process.env;

describe("GET /api/ready", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    process.env["READINESS_PROBE_SECRET"] = "secret";
    process.env["CRON_SECRET"] = "cron";
  });
  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("returns 401 without auth", async () => {
    const res = GET(new NextRequest("http://localhost/api/ready"));
    expect(res.status).toBe(401);
  });

  it("returns 200 when all checks pass", async () => {
    process.env["NEXT_PUBLIC_SUPABASE_URL"] = "https://x.supabase.co";
    process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] = "anon";
    process.env["ANALYSIS_SERVICE_URL"] = "https://x.railway.app";
    process.env["ANALYSIS_SERVICE_API_KEY"] = "key";

    const req = new NextRequest("http://localhost/api/ready", {
      headers: { authorization: "Bearer secret" },
    });
    const res = GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("phenosage-web");
  });
});
