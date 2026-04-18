import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "../route";

const ORIGINAL_ENV = process.env;

describe("GET /api/ready", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });
  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("returns 200 when all checks pass", async () => {
    process.env["NEXT_PUBLIC_SUPABASE_URL"] = "https://x.supabase.co";
    process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] = "anon";
    process.env["ANALYSIS_SERVICE_URL"] = "https://x.railway.app";
    process.env["ANALYSIS_SERVICE_API_KEY"] = "key";

    const res = GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("phenosage-web");
    expect(body.checks.every((c: { ok: boolean }) => c.ok)).toBe(true);
  });

  it("returns 503 when required env is missing", async () => {
    delete process.env["NEXT_PUBLIC_SUPABASE_URL"];
    delete process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
    delete process.env["ANALYSIS_SERVICE_URL"];
    delete process.env["ANALYSIS_SERVICE_API_KEY"];

    const res = GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("not_ready");
    expect(body.checks.some((c: { ok: boolean }) => !c.ok)).toBe(true);
  });
});
