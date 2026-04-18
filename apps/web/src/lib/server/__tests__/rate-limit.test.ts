import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetRateLimitStore,
  rateLimit,
  rateLimitKeyFromRequest,
} from "../rate-limit";

describe("rateLimit", () => {
  beforeEach(() => {
    __resetRateLimitStore();
  });

  it("allows up to limit requests within the window", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) {
      const r = rateLimit({
        key: "k",
        limit: 3,
        windowMs: 60_000,
        now: now + i,
      });
      expect(r.ok).toBe(true);
    }
  });

  it("denies requests past the limit", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) {
      rateLimit({ key: "k", limit: 3, windowMs: 60_000, now: now + i });
    }
    const blocked = rateLimit({
      key: "k",
      limit: 3,
      windowMs: 60_000,
      now: now + 4,
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("resets after the window elapses", () => {
    const now = 1_000_000;
    rateLimit({ key: "k", limit: 1, windowMs: 1000, now });
    const blocked = rateLimit({
      key: "k",
      limit: 1,
      windowMs: 1000,
      now: now + 500,
    });
    expect(blocked.ok).toBe(false);
    const reset = rateLimit({
      key: "k",
      limit: 1,
      windowMs: 1000,
      now: now + 2000,
    });
    expect(reset.ok).toBe(true);
  });

  it("keys are isolated", () => {
    rateLimit({ key: "a", limit: 1, windowMs: 60_000 });
    const b = rateLimit({ key: "b", limit: 1, windowMs: 60_000 });
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
