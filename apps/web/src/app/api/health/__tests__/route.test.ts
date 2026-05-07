import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "../route";

const ORIGINAL_ENV = process.env;

describe("GET /api/health", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("returns public liveness metadata without requiring auth", async () => {
    process.env["NEXT_PUBLIC_APP_ENV"] = "test";
    process.env["VERCEL_GIT_COMMIT_SHA"] = "abc123";

    const res = GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toMatchObject({
      status: "ok",
      service: "phenosage-web",
      env: "test",
      commit: "abc123",
    });
    expect(Date.parse(body.timestamp as string)).not.toBeNaN();
  });

  it("falls back when deployment metadata is absent", async () => {
    delete process.env["NEXT_PUBLIC_APP_ENV"];
    delete process.env["VERCEL_GIT_COMMIT_SHA"];
    delete process.env["GIT_COMMIT_SHA"];

    const body = await GET().json();

    expect(body.env).toBe(process.env.NODE_ENV ?? "unknown");
    expect(body.commit).toBe("unknown");
  });
});
