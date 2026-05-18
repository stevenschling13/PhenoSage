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

  it("returns 200 with service name and a parseable timestamp", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("phenosage-web");
    expect(typeof body.timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });

  it("prefers NEXT_PUBLIC_APP_ENV over NODE_ENV in the env field", async () => {
    process.env["NEXT_PUBLIC_APP_ENV"] = "preview";
    // NODE_ENV is typed read-only, so assign through a bracketed lookup.
    (process.env as Record<string, string | undefined>)["NODE_ENV"] =
      "production";
    const body = await GET().json();
    expect(body.env).toBe("preview");
  });

  it("falls back to NODE_ENV when NEXT_PUBLIC_APP_ENV is unset", async () => {
    delete process.env["NEXT_PUBLIC_APP_ENV"];
    (process.env as Record<string, string | undefined>)["NODE_ENV"] = "test";
    const body = await GET().json();
    expect(body.env).toBe("test");
  });

  it("prefers VERCEL_GIT_COMMIT_SHA over GIT_COMMIT_SHA for commit", async () => {
    process.env["VERCEL_GIT_COMMIT_SHA"] = "vercel-sha";
    process.env["GIT_COMMIT_SHA"] = "fallback-sha";
    const body = await GET().json();
    expect(body.commit).toBe("vercel-sha");
  });

  it("falls back to 'unknown' when no commit env vars are set", async () => {
    delete process.env["VERCEL_GIT_COMMIT_SHA"];
    delete process.env["GIT_COMMIT_SHA"];
    const body = await GET().json();
    expect(body.commit).toBe("unknown");
  });

  it("emits a public Cache-Control header with a stale-while-revalidate window", async () => {
    // `/api/health` is a liveness signal with no per-user data, so a
    // short shared cache is desirable — a burst of monitor hits and
    // edge-network probes shouldn't each fan out to a fresh function
    // invocation. The exact numbers (60s + 5min SWR) match the
    // policy in the route's source; if you bump them there, update
    // here too.
    const res = GET();
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=60, stale-while-revalidate=300",
    );
  });
});
