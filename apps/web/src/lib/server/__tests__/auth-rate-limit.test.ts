import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const rateLimit = vi.fn();
  // headers() returns a Promise<Headers>-like in Next 16; the mock
  // mirrors that shape so the production import boundary doesn't have
  // to learn about the test.
  const headersValues = new Map<string, string>();
  const headers = vi.fn(async () => ({
    get: (k: string) => headersValues.get(k.toLowerCase()) ?? null,
  }));
  const setHeader = (k: string, v: string) =>
    headersValues.set(k.toLowerCase(), v);
  const clearHeaders = () => headersValues.clear();
  const logServerEvent = vi.fn();
  return {
    rateLimit,
    headers,
    setHeader,
    clearHeaders,
    logServerEvent,
  };
});

vi.mock("../rate-limit", () => ({ rateLimit: mocks.rateLimit }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("../request-id", () => ({ logServerEvent: mocks.logServerEvent }));

import { applyAuthRateLimit } from "../auth-rate-limit";

const FIXED_NOW = 1_700_000_000_000;

beforeEach(() => {
  mocks.rateLimit.mockReset();
  mocks.clearHeaders();
  mocks.logServerEvent.mockReset();
  vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW);
});

function okResult(remaining = 9) {
  return {
    ok: true,
    remaining,
    resetAt: FIXED_NOW + 15 * 60_000,
  };
}

function blockResult(retrySeconds: number) {
  return {
    ok: false,
    remaining: 0,
    resetAt: FIXED_NOW + retrySeconds * 1000,
  };
}

describe("applyAuthRateLimit", () => {
  it("allows the attempt when both IP and email limits permit", async () => {
    mocks.setHeader("x-forwarded-for", "1.2.3.4");
    mocks.rateLimit
      .mockResolvedValueOnce(okResult())
      .mockResolvedValueOnce(okResult());
    const result = await applyAuthRateLimit({
      email: "User@Example.com",
      attemptKind: "sign-in",
    });
    expect(result).toEqual({ ok: true });
    expect(mocks.rateLimit).toHaveBeenCalledTimes(2);
    // IP key uses the raw IP.
    expect(mocks.rateLimit).toHaveBeenNthCalledWith(1, {
      key: "auth:ip:1.2.3.4",
      limit: 10,
      windowMs: 15 * 60_000,
      failClosed: true,
    });
    // Email key is a hex digest — must not include the literal email.
    const emailCall = mocks.rateLimit.mock.calls[1]?.[0];
    expect(emailCall.key).toMatch(/^auth:em:[0-9a-f]{16}$/);
    expect(emailCall.key).not.toContain("User");
    expect(emailCall.key).not.toContain("example.com");
    expect(emailCall.failClosed).toBe(true);
  });

  it("lowercases the email so case variants share a bucket", async () => {
    mocks.setHeader("x-forwarded-for", "1.2.3.4");
    mocks.rateLimit
      .mockResolvedValueOnce(okResult())
      .mockResolvedValueOnce(okResult());
    await applyAuthRateLimit({
      email: "User@Example.com",
      attemptKind: "sign-in",
    });
    const firstEmailKey = mocks.rateLimit.mock.calls[1]?.[0].key;

    mocks.rateLimit.mockClear();
    mocks.rateLimit
      .mockResolvedValueOnce(okResult())
      .mockResolvedValueOnce(okResult());
    await applyAuthRateLimit({
      email: "user@example.com",
      attemptKind: "sign-in",
    });
    const secondEmailKey = mocks.rateLimit.mock.calls[1]?.[0].key;
    expect(firstEmailKey).toBe(secondEmailKey);
  });

  it("blocks on IP saturation and never checks the email limit", async () => {
    mocks.setHeader("x-forwarded-for", "1.2.3.4");
    mocks.rateLimit.mockResolvedValueOnce(blockResult(42));
    const result = await applyAuthRateLimit({
      email: "a@b.co",
      attemptKind: "sign-in",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return; // type narrow
    expect(result.retryAfterSeconds).toBe(42);
    expect(result.message).toMatch(/from this network/i);
    expect(result.message).toMatch(/42 second/);
    // Bail before the email lookup so a single attacker can't probe
    // bucket-by-email enumeration through response timing.
    expect(mocks.rateLimit).toHaveBeenCalledTimes(1);
  });

  it("blocks on email saturation when IP is fine", async () => {
    mocks.setHeader("x-forwarded-for", "1.2.3.4");
    mocks.rateLimit
      .mockResolvedValueOnce(okResult())
      .mockResolvedValueOnce(blockResult(30));
    const result = await applyAuthRateLimit({
      email: "a@b.co",
      attemptKind: "sign-in",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.retryAfterSeconds).toBe(30);
    // The email-block message is intentionally indistinguishable from
    // the IP-block (apart from the "from this network" phrasing) so
    // the UX can't be used to enumerate which dimension is throttled.
    expect(result.message).toMatch(/30 second/);
  });

  it("uses the leftmost x-forwarded-for entry (original client)", async () => {
    mocks.setHeader("x-forwarded-for", "203.0.113.7, 10.0.0.1, 10.0.0.2");
    mocks.rateLimit
      .mockResolvedValueOnce(okResult())
      .mockResolvedValueOnce(okResult());
    await applyAuthRateLimit({ email: "a@b.co", attemptKind: "sign-in" });
    expect(mocks.rateLimit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ key: "auth:ip:203.0.113.7" }),
    );
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", async () => {
    mocks.setHeader("x-real-ip", "198.51.100.4");
    mocks.rateLimit
      .mockResolvedValueOnce(okResult())
      .mockResolvedValueOnce(okResult());
    await applyAuthRateLimit({ email: "a@b.co", attemptKind: "sign-in" });
    expect(mocks.rateLimit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ key: "auth:ip:198.51.100.4" }),
    );
  });

  it("buckets missing-IP requests under a single sentinel key", async () => {
    // No headers set — `headers().get()` returns null for both.
    mocks.rateLimit
      .mockResolvedValueOnce(okResult())
      .mockResolvedValueOnce(okResult());
    await applyAuthRateLimit({ email: "a@b.co", attemptKind: "sign-in" });
    expect(mocks.rateLimit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ key: "auth:ip:no-ip" }),
    );
  });

  it("logs a structured warn line on every block", async () => {
    mocks.setHeader("x-forwarded-for", "1.2.3.4");
    mocks.rateLimit.mockResolvedValueOnce(blockResult(5));
    await applyAuthRateLimit({ email: "a@b.co", attemptKind: "otp" });
    expect(mocks.logServerEvent).toHaveBeenCalledWith(
      "warn",
      "auth rate limit blocked",
      expect.objectContaining({
        attemptKind: "otp",
        reason: "ip",
        retryAfterSeconds: 5,
      }),
    );
  });

  it("never returns 0-second retry hints (always at least 1)", async () => {
    // resetAt exactly equal to now — round-up must yield 1 so the user
    // sees "wait 1 second" instead of "wait 0 seconds".
    mocks.setHeader("x-forwarded-for", "1.2.3.4");
    mocks.rateLimit.mockResolvedValueOnce({
      ok: false,
      remaining: 0,
      resetAt: FIXED_NOW,
    });
    const result = await applyAuthRateLimit({
      email: "a@b.co",
      attemptKind: "sign-in",
    });
    if (result.ok) throw new Error("expected block");
    expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(result.message).toMatch(/1 second\b/);
  });
});
