import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";

const ORIGINAL_ENV = process.env;

function makeRequest(authHeader?: string): NextRequest {
  const headers = new Headers();
  if (authHeader !== undefined) headers.set("authorization", authHeader);
  return new NextRequest("http://localhost/api/internal/cron/daily-summary", {
    headers,
  });
}

describe("GET /api/internal/cron/daily-summary", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });
  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("returns 401 when CRON_SECRET is not configured", async () => {
    delete process.env["CRON_SECRET"];
    const res = await GET(makeRequest("Bearer anything"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when authorization header is missing", async () => {
    process.env["CRON_SECRET"] = "secret";
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns 401 when authorization header is wrong", async () => {
    process.env["CRON_SECRET"] = "secret";
    const res = await GET(makeRequest("Bearer not-the-secret"));
    expect(res.status).toBe(401);
  });

  it("returns 401 when authorization header is missing the Bearer prefix", async () => {
    process.env["CRON_SECRET"] = "secret";
    const res = await GET(makeRequest("secret"));
    expect(res.status).toBe(401);
  });

  it("returns 501 when authorization matches the configured secret", async () => {
    process.env["CRON_SECRET"] = "secret";
    const res = await GET(makeRequest("Bearer secret"));
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_IMPLEMENTED");
    expect(typeof body.ran).toBe("string");
    expect(Number.isNaN(Date.parse(body.ran))).toBe(false);
  });
});
