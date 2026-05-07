import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "../route";

const ORIGINAL_ENV = process.env;

function request(authorization?: string): NextRequest {
  const init: RequestInit = {};
  if (authorization) {
    init.headers = { authorization };
  }
  return new Request(
    "https://app.example.com/api/internal/cron/daily-summary",
    init,
  ) as NextRequest;
}

describe("GET /api/internal/cron/daily-summary", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, CRON_SECRET: "cron-secret" };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("rejects requests without the configured bearer secret", async () => {
    const res = await GET(request("Bearer wrong"));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("rejects requests when CRON_SECRET is not configured", async () => {
    delete process.env["CRON_SECRET"];

    const res = await GET(request("Bearer cron-secret"));

    expect(res.status).toBe(401);
  });

  it("returns a successful placeholder response for authorized cron invocations", async () => {
    const res = await GET(request("Bearer cron-secret"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: "ok",
      message: "TODO: Implement daily summary generation",
    });
    expect(Date.parse(body.ran as string)).not.toBeNaN();
  });
});
