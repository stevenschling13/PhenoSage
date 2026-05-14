import { describe, expect, it, vi } from "vitest";
import { UpstreamError, withResilience } from "../resilience";

const baseOpts = {
  operation: "test-op",
  requestId: "req_test",
  timeoutMs: 50,
  random: () => 0.5,
  // Skip real waiting in tests so backoff doesn't slow the suite.
  sleep: () => Promise.resolve(),
};

describe("withResilience", () => {
  it("returns the value on first-attempt success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withResilience(fn, baseOpts);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("classifies AbortSignal.timeout as UPSTREAM_TIMEOUT", async () => {
    // Simulate a fetch that never resolves before the per-attempt deadline.
    const fn = vi.fn(
      (_attempt: number, signal: AbortSignal) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            const err = new Error("operation timed out");
            err.name = "TimeoutError";
            reject(err);
          });
        }),
    );
    await expect(
      withResilience(fn, { ...baseOpts, timeoutMs: 10 }),
    ).rejects.toMatchObject({
      name: "UpstreamError",
      code: "UPSTREAM_TIMEOUT",
      retryable: true,
    });
  });

  it("retries a 503 when idempotent=true and eventually succeeds", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 3) {
        throw new UpstreamError({
          code: "UPSTREAM_UNAVAILABLE",
          message: "boom",
          operation: "test-op",
          requestId: "req_test",
          attempt: calls,
          retryable: true,
          status: 503,
        });
      }
      return "ok";
    });
    const result = await withResilience(fn, {
      ...baseOpts,
      maxAttempts: 3,
      idempotent: true,
    });
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("respects a 429 Retry-After while still capping attempts", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fn = vi.fn(async (attempt: number) => {
      throw new UpstreamError({
        code: "UPSTREAM_RATE_LIMITED",
        message: "slow down",
        operation: "test-op",
        requestId: "req_test",
        attempt,
        retryable: true,
        status: 429,
        retryAfterSeconds: 1,
      });
    });
    await expect(
      withResilience(fn, {
        ...baseOpts,
        sleep,
        maxAttempts: 2,
        idempotent: true,
      }),
    ).rejects.toMatchObject({ code: "UPSTREAM_RATE_LIMITED" });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    // Retry-After=1s but maxDelayMs default is 4000 — should sleep 1000ms.
    expect(sleep.mock.calls[0]?.[0]).toBe(1000);
  });

  it("does NOT retry a 401", async () => {
    const fn = vi.fn(async () => {
      throw new UpstreamError({
        code: "UPSTREAM_BAD_RESPONSE",
        message: "auth",
        operation: "test-op",
        requestId: "req_test",
        attempt: 1,
        retryable: false,
        status: 401,
      });
    });
    await expect(
      withResilience(fn, { ...baseOpts, maxAttempts: 3, idempotent: true }),
    ).rejects.toMatchObject({ status: 401 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws a programmer error when maxAttempts > 1 without idempotency", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(
      withResilience(fn, { ...baseOpts, maxAttempts: 3 }),
    ).rejects.toThrow(/idempotent=true or an idempotencyKey/);
    expect(fn).not.toHaveBeenCalled();
  });

  it("uses full-jitter backoff bounded by maxDelayMs", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const fn = vi.fn(async (attempt: number) => {
      calls += 1;
      throw new UpstreamError({
        code: "UPSTREAM_UNAVAILABLE",
        message: "down",
        operation: "test-op",
        requestId: "req_test",
        attempt,
        retryable: true,
        status: 503,
      });
    });
    await expect(
      withResilience(fn, {
        operation: "test-op",
        requestId: "req_test",
        timeoutMs: 50,
        maxAttempts: 4,
        idempotent: true,
        baseDelayMs: 100,
        maxDelayMs: 2000,
        // Always pick the upper bound of the jitter window for an
        // assertable check that we never exceed maxDelayMs.
        random: () => 0.999,
        sleep: (ms: number) => {
          sleeps.push(ms);
          return Promise.resolve();
        },
      }),
    ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    expect(calls).toBe(4);
    // 3 backoffs between 4 attempts. Each must be <= maxDelayMs.
    expect(sleeps).toHaveLength(3);
    for (const s of sleeps) {
      expect(s).toBeLessThanOrEqual(2000);
      expect(s).toBeGreaterThanOrEqual(0);
    }
    // Backoff should grow (or saturate) — never decrease.
    expect(sleeps[0]).toBeLessThanOrEqual(sleeps[1]!);
    expect(sleeps[1]).toBeLessThanOrEqual(sleeps[2]!);
  });

  it("treats unknown errors with 'fetch failed' as retryable network errors", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 2) throw new Error("fetch failed");
      return "ok";
    });
    const result = await withResilience(fn, {
      ...baseOpts,
      maxAttempts: 2,
      idempotent: true,
    });
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("does not retry an arbitrary throw (treated as non-retryable bad response)", async () => {
    const fn = vi.fn(async () => {
      throw new Error("some sync logic bug");
    });
    await expect(
      withResilience(fn, { ...baseOpts, maxAttempts: 3, idempotent: true }),
    ).rejects.toMatchObject({ code: "UPSTREAM_BAD_RESPONSE" });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
