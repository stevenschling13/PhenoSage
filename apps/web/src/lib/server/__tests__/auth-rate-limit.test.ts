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
    mocks.setHeader("x-real-ip", "1.2.3.4");
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
    // Email key is scoped by attempt kind so cross-action DoS is
    // isolated, and the email itself appears only as a hex digest.
    const emailCall = mocks.rateLimit.mock.calls[1]?.[0];
    expect(emailCall.key).toMatch(/^auth:em:sign-in:[0-9a-f]{16}$/);
    expect(emailCall.key).not.toContain("User");
    expect(emailCall.key).not.toContain("example.com");
    expect(emailCall.failClosed).toBe(true);
  });

  it("scopes the email key by attempt kind so cross-action DoS is isolated", async () => {
    // An attacker spamming /sign-up with a victim's email must not
    // drain that victim's /sign-in bucket. Different attemptKind →
    // different Redis key, independent budgets.
    mocks.setHeader("x-real-ip", "1.2.3.4");
    mocks.rateLimit
      .mockResolvedValueOnce(okResult())
      .mockResolvedValueOnce(okResult());
    await applyAuthRateLimit({
      email: "victim@example.com",
      attemptKind: "sign-up",
    });
    const signUpKey = mocks.rateLimit.mock.calls[1]?.[0].key;

    mocks.rateLimit.mockClear();
    mocks.rateLimit
      .mockResolvedValueOnce(okResult())
      .mockResolvedValueOnce(okResult());
    await applyAuthRateLimit({
      email: "victim@example.com",
      attemptKind: "sign-in",
    });
    const signInKey = mocks.rateLimit.mock.calls[1]?.[0].key;

    expect(signUpKey).toMatch(/^auth:em:sign-up:/);
    expect(signInKey).toMatch(/^auth:em:sign-in:/);
    expect(signUpKey).not.toBe(signInKey);
  });

  it("lowercases the email so case variants share a bucket (within one kind)", async () => {
    mocks.setHeader("x-real-ip", "1.2.3.4");
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
    mocks.setHeader("x-real-ip", "1.2.3.4");
    mocks.rateLimit.mockResolvedValueOnce(blockResult(42));
    const result = await applyAuthRateLimit({
      email: "a@b.co",
      attemptKind: "sign-in",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return; // type narrow
    expect(result.retryAfterSeconds).toBe(42);
    // Generic copy that doesn't leak which dimension tripped and that
    // reads correctly for sign-in / sign-up / otp alike.
    expect(result.message).toMatch(
      /^Too many attempts\. Please wait 42 seconds/,
    );
    expect(result.message).not.toMatch(/sign-in/i);
    expect(result.message).not.toMatch(/network/i);
    // Bail before the email lookup so a single attacker can't probe
    // bucket-by-email enumeration through response timing.
    expect(mocks.rateLimit).toHaveBeenCalledTimes(1);
  });

  it("blocks on email saturation when IP is fine, with identical wording to the IP block", async () => {
    mocks.setHeader("x-real-ip", "1.2.3.4");
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
    // Identical wording shape to the IP-block — only the seconds
    // differ — so the UX can't be used to enumerate which dimension
    // tripped.
    expect(result.message).toMatch(
      /^Too many attempts\. Please wait 30 seconds/,
    );
  });

  it("prefers x-real-ip over x-forwarded-for (spoof-resistance)", async () => {
    // On Vercel x-real-ip is set by replacement, so a client-supplied
    // value cannot smuggle past — using it first hardens the limiter
    // against header-spoofing attempts.
    mocks.setHeader("x-real-ip", "198.51.100.4");
    mocks.setHeader("x-forwarded-for", "203.0.113.7, 10.0.0.1");
    mocks.rateLimit
      .mockResolvedValueOnce(okResult())
      .mockResolvedValueOnce(okResult());
    await applyAuthRateLimit({ email: "a@b.co", attemptKind: "sign-in" });
    expect(mocks.rateLimit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ key: "auth:ip:198.51.100.4" }),
    );
  });

  it("falls back to leftmost x-forwarded-for when x-real-ip is absent", async () => {
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
    mocks.setHeader("x-real-ip", "1.2.3.4");
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
    mocks.setHeader("x-real-ip", "1.2.3.4");
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
    // Singular "second" — not "1 seconds".
    expect(result.message).toMatch(/wait 1 second\b/);
    expect(result.message).not.toMatch(/seconds/);
  });
});
