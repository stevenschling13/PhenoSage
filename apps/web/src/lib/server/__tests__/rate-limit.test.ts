import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetRateLimitStore,
  rateLimit,
  rateLimitKeyFromRequest,
} from "../rate-limit";

describe("rateLimit (in-memory backend)", () => {
  beforeEach(() => {
    __resetRateLimitStore();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
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

// ─── Distributed (Upstash) backend ──────────────────────────────────────────
//
// We mock both `@upstash/ratelimit` and `@upstash/redis` so the test runs
// without any network calls. The mock is hoisted by Vitest so it applies
// before the dynamic imports inside `getDistributedLimiter`.

const limitMock = vi.fn();

vi.mock("@upstash/ratelimit", () => {
  class Ratelimit {
    static slidingWindow(_limit: number, _window: string) {
      return { name: "slidingWindow" };
    }
    constructor(_opts: unknown) {}
    limit(...args: unknown[]) {
      return limitMock(...args);
    }
  }
  return { Ratelimit };
});

vi.mock("@upstash/redis", () => {
  class Redis {
    constructor(_opts: unknown) {}
  }
  return { Redis };
});

describe("rateLimit (distributed backend)", () => {
  beforeEach(() => {
    __resetRateLimitStore();
    limitMock.mockReset();
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.example";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token-xyz";
  });

  afterEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  it("delegates to Upstash and surfaces success", async () => {
    limitMock.mockResolvedValue({
      success: true,
      remaining: 4,
      reset: 1_700_000_000,
    });
    const r = await rateLimit({ key: "u:1", limit: 5, windowMs: 60_000 });
    expect(r).toEqual({
      ok: true,
      remaining: 4,
      resetAt: 1_700_000_000,
    });
    expect(limitMock).toHaveBeenCalledWith("u:1", { rate: 1 });
  });

  it("denies when Upstash reports the limit exhausted", async () => {
    limitMock.mockResolvedValue({
      success: false,
      remaining: 0,
      reset: 1_700_000_000,
    });
    const r = await rateLimit({ key: "u:1", limit: 5, windowMs: 60_000 });
    expect(r.ok).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it("fails open if the Upstash call throws", async () => {
    limitMock.mockRejectedValue(new Error("ECONNRESET"));
    const r = await rateLimit({ key: "u:1", limit: 5, windowMs: 60_000 });
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(5);
  });

  it("does not call Upstash when the test `now` override is supplied", async () => {
    const r = await rateLimit({
      key: "u:1",
      limit: 5,
      windowMs: 60_000,
      now: 1,
    });
    expect(r.ok).toBe(true);
    expect(limitMock).not.toHaveBeenCalled();
  });
});
