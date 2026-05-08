import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const limitMock = vi.fn();

// Mock Upstash modules so we can flip the distributed branch on/off
// per test without making any network calls.
vi.mock("@upstash/redis", () => ({
  Redis: class MockRedis {
    constructor(_opts: unknown) {}
  },
}));
vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class MockRatelimit {
    constructor(_opts: unknown) {}
    limit = (...args: unknown[]) => limitMock(...args);
    static slidingWindow = (limit: number, window: string) => ({
      kind: "sliding",
      limit,
      window,
    });
  },
}));

import {
  __resetRateLimitStore,
  rateLimit,
  rateLimitKeyFromRequest,
} from "../rate-limit";

describe("rateLimit (in-memory fallback)", () => {
  beforeEach(() => {
    delete process.env["UPSTASH_REDIS_REST_URL"];
    delete process.env["UPSTASH_REDIS_REST_TOKEN"];
    limitMock.mockReset();
    __resetRateLimitStore();
  });

  it("allows up to limit requests within the window", async () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) {
      const r = await rateLimit({
        key: "k",
        limit: 3,
        windowMs: 60_000,
        now: now + i,
      });
      expect(r.ok).toBe(true);
    }
  });

  it("denies requests past the limit", async () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) {
      await rateLimit({ key: "k", limit: 3, windowMs: 60_000, now: now + i });
    }
    const blocked = await rateLimit({
      key: "k",
      limit: 3,
      windowMs: 60_000,
      now: now + 4,
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("resets after the window elapses", async () => {
    const now = 1_000_000;
    await rateLimit({ key: "k", limit: 1, windowMs: 1000, now });
    const blocked = await rateLimit({
      key: "k",
      limit: 1,
      windowMs: 1000,
      now: now + 500,
    });
    expect(blocked.ok).toBe(false);
    const reset = await rateLimit({
      key: "k",
      limit: 1,
      windowMs: 1000,
      now: now + 2000,
    });
    expect(reset.ok).toBe(true);
  });

  it("keys are isolated", async () => {
    await rateLimit({ key: "a", limit: 1, windowMs: 60_000 });
    const b = await rateLimit({ key: "b", limit: 1, windowMs: 60_000 });
    expect(b.ok).toBe(true);
  });

  it("does not call Upstash when env is missing", async () => {
    await rateLimit({ key: "k", limit: 5, windowMs: 60_000 });
    expect(limitMock).not.toHaveBeenCalled();
  });
});

describe("rateLimit (distributed via Upstash)", () => {
  beforeEach(() => {
    process.env["UPSTASH_REDIS_REST_URL"] = "https://test.upstash.io";
    process.env["UPSTASH_REDIS_REST_TOKEN"] = "test-token";
    limitMock.mockReset();
    __resetRateLimitStore();
  });

  afterEach(() => {
    delete process.env["UPSTASH_REDIS_REST_URL"];
    delete process.env["UPSTASH_REDIS_REST_TOKEN"];
  });

  it("forwards calls to the Upstash limiter and surfaces success", async () => {
    limitMock.mockResolvedValueOnce({
      success: true,
      remaining: 4,
      reset: 1234,
    });
    const result = await rateLimit({ key: "k", limit: 5, windowMs: 60_000 });
    expect(result).toEqual({ ok: true, remaining: 4, resetAt: 1234 });
    expect(limitMock).toHaveBeenCalledWith("k");
  });

  it("surfaces a denial from the Upstash limiter", async () => {
    limitMock.mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: 999,
    });
    const result = await rateLimit({ key: "k", limit: 5, windowMs: 60_000 });
    expect(result).toEqual({ ok: false, remaining: 0, resetAt: 999 });
  });

  it("falls back to in-memory when the Upstash call throws", async () => {
    limitMock.mockRejectedValueOnce(new Error("redis timeout"));
    // Should fall through to in-memory and allow this first call.
    const result = await rateLimit({
      key: "k",
      limit: 1,
      windowMs: 60_000,
      now: 1_000_000,
    });
    expect(result.ok).toBe(true);
  });
});

describe("rateLimitKeyFromRequest", () => {
  it("prefers userId when provided", () => {
    const req = new Request("http://x/");
    expect(rateLimitKeyFromRequest(req, "user-123")).toBe("u:user-123");
  });

  it("falls back to x-forwarded-for IP", () => {
    const req = new Request("http://x/", {
      headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" },
    });
    expect(rateLimitKeyFromRequest(req, null)).toBe("ip:1.2.3.4");
  });

  it("falls back to anonymous when no IP is present", () => {
    const req = new Request("http://x/");
    expect(rateLimitKeyFromRequest(req, null)).toBe("ip:anonymous");
  });
});
