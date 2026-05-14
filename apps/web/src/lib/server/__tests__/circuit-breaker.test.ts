import { describe, expect, it } from "vitest";
import { CircuitBreaker, CircuitOpenError } from "../circuit-breaker";

function makeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

describe("CircuitBreaker", () => {
  it("opens after the failure threshold within the rolling window", async () => {
    const clock = makeClock();
    const cb = new CircuitBreaker("svc", {
      failureThreshold: 3,
      windowMs: 10_000,
      cooldownMs: 5_000,
      now: clock.now,
    });

    for (let i = 0; i < 3; i++) {
      await expect(
        cb.run(async () => {
          throw new Error("upstream down");
        }),
      ).rejects.toThrow(/upstream down/);
    }
    expect(cb.getState()).toBe("OPEN");
  });

  it("fails fast while OPEN with CircuitOpenError", async () => {
    const clock = makeClock();
    const cb = new CircuitBreaker("svc", {
      failureThreshold: 1,
      windowMs: 10_000,
      cooldownMs: 5_000,
      now: clock.now,
    });
    await expect(
      cb.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow(/boom/);
    expect(cb.getState()).toBe("OPEN");

    let probeRan = false;
    await expect(
      cb.run(async () => {
        probeRan = true;
        return "should not run";
      }),
    ).rejects.toBeInstanceOf(CircuitOpenError);
    expect(probeRan).toBe(false);
  });

  it("transitions OPEN → HALF_OPEN after cooldown and allows one probe", async () => {
    const clock = makeClock();
    const cb = new CircuitBreaker("svc", {
      failureThreshold: 1,
      windowMs: 10_000,
      cooldownMs: 5_000,
      now: clock.now,
    });
    await expect(
      cb.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow(/boom/);
    expect(cb.getState()).toBe("OPEN");

    clock.advance(5_000);
    expect(cb.getState()).toBe("HALF_OPEN");

    // Successful probe → CLOSED.
    const result = await cb.run(async () => "ok");
    expect(result).toBe("ok");
    expect(cb.getState()).toBe("CLOSED");
  });

  it("re-opens when the half-open probe fails", async () => {
    const clock = makeClock();
    const cb = new CircuitBreaker("svc", {
      failureThreshold: 1,
      windowMs: 10_000,
      cooldownMs: 5_000,
      now: clock.now,
    });
    await expect(
      cb.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow(/boom/);
    clock.advance(5_000);
    expect(cb.getState()).toBe("HALF_OPEN");

    await expect(
      cb.run(async () => {
        throw new Error("still down");
      }),
    ).rejects.toThrow(/still down/);
    expect(cb.getState()).toBe("OPEN");
  });

  it("only allows one in-flight call while HALF_OPEN", async () => {
    const clock = makeClock();
    const cb = new CircuitBreaker("svc", {
      failureThreshold: 1,
      windowMs: 10_000,
      cooldownMs: 5_000,
      now: clock.now,
    });
    await expect(
      cb.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow(/boom/);
    clock.advance(5_000);
    // Take the probe slot but don't resolve yet.
    cb.beforeCall();
    expect(() => cb.beforeCall()).toThrow(CircuitOpenError);
    cb.recordSuccess();
    expect(cb.getState()).toBe("CLOSED");
  });

  it("forgets failures that fall outside the rolling window", async () => {
    const clock = makeClock();
    const cb = new CircuitBreaker("svc", {
      failureThreshold: 3,
      windowMs: 1_000,
      cooldownMs: 5_000,
      now: clock.now,
    });
    // Two failures, then advance past the window, then one more failure
    // — only the last should count, so the breaker stays CLOSED.
    for (let i = 0; i < 2; i++) {
      await expect(
        cb.run(async () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow();
    }
    clock.advance(2_000);
    await expect(
      cb.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow();
    expect(cb.getState()).toBe("CLOSED");
  });
});
