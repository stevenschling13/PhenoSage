import "server-only";
import { logServerEvent } from "./request-id";

/**
 * In-memory circuit breaker for upstream dependencies.
 *
 * MVP scope: per-instance (per-Lambda / per-Vercel-function-invocation
 * worker). On serverless this means the breaker resets across cold starts,
 * which is acceptable for the initial hardening tier — it still protects a
 * warm instance from retry-storming a known-bad upstream during a single
 * request burst, and `CONFIGURATION_ERROR` paths bail out before a breaker
 * is even consulted.
 *
 * Future: lift state into Redis / Upstash so all warm instances share it.
 *
 * States (Azure Circuit Breaker pattern):
 *   - CLOSED: requests pass through, failures are counted in a rolling
 *     window. When `failureThreshold` is reached within `windowMs`, the
 *     breaker opens.
 *   - OPEN: every request fails fast. After `cooldownMs` the breaker
 *     transitions to HALF_OPEN and allows exactly one probe.
 *   - HALF_OPEN: a single probe is allowed through. If it succeeds the
 *     breaker closes; if it fails the breaker reopens for another
 *     `cooldownMs`.
 */

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  windowMs?: number;
  cooldownMs?: number;
  /** Test seam. */
  now?: () => number;
}

export class CircuitOpenError extends Error {
  readonly key: string;
  readonly retryAfterSeconds: number;
  constructor(key: string, retryAfterSeconds: number) {
    super(`Circuit ${key} is OPEN; failing fast.`);
    this.name = "CircuitOpenError";
    this.key = key;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

interface BreakerState {
  state: CircuitState;
  failures: number[]; // failure timestamps within the current rolling window
  openedAt: number | null;
  halfOpenInFlight: boolean;
}

const DEFAULTS = {
  failureThreshold: 5,
  windowMs: 60_000,
  cooldownMs: 30_000,
};

export class CircuitBreaker {
  private readonly key: string;
  private readonly opts: Required<Omit<CircuitBreakerOptions, "now">>;
  private readonly now: () => number;
  private state: BreakerState = {
    state: "CLOSED",
    failures: [],
    openedAt: null,
    halfOpenInFlight: false,
  };

  constructor(key: string, options: CircuitBreakerOptions = {}) {
    this.key = key;
    this.opts = {
      failureThreshold: options.failureThreshold ?? DEFAULTS.failureThreshold,
      windowMs: options.windowMs ?? DEFAULTS.windowMs,
      cooldownMs: options.cooldownMs ?? DEFAULTS.cooldownMs,
    };
    this.now = options.now ?? Date.now;
  }

  /** For tests / introspection. */
  getState(): CircuitState {
    this.advance();
    return this.state.state;
  }

  /**
   * Throws `CircuitOpenError` if the breaker is open. While HALF_OPEN, the
   * first caller per cooldown window is allowed through as the probe;
   * concurrent callers fail fast.
   */
  beforeCall(): void {
    this.advance();
    if (this.state.state === "OPEN") {
      const elapsed = this.now() - (this.state.openedAt ?? this.now());
      const remaining = Math.max(
        0,
        Math.ceil((this.opts.cooldownMs - elapsed) / 1000),
      );
      throw new CircuitOpenError(this.key, remaining);
    }
    if (this.state.state === "HALF_OPEN") {
      if (this.state.halfOpenInFlight) {
        throw new CircuitOpenError(
          this.key,
          Math.ceil(this.opts.cooldownMs / 1000),
        );
      }
      this.state.halfOpenInFlight = true;
    }
  }

  recordSuccess(): void {
    if (this.state.state === "HALF_OPEN") {
      logServerEvent("info", "circuit closed after successful probe", {
        circuit: this.key,
      });
      this.state = {
        state: "CLOSED",
        failures: [],
        openedAt: null,
        halfOpenInFlight: false,
      };
      return;
    }
    // Healthy call in CLOSED: clear the rolling window.
    this.state.failures = [];
  }

  recordFailure(): void {
    const ts = this.now();
    if (this.state.state === "HALF_OPEN") {
      logServerEvent("warn", "circuit reopened after failed probe", {
        circuit: this.key,
      });
      this.state = {
        state: "OPEN",
        failures: [],
        openedAt: ts,
        halfOpenInFlight: false,
      };
      return;
    }
    if (this.state.state === "OPEN") {
      // Shouldn't really happen because beforeCall() would have thrown.
      this.state.openedAt = ts;
      return;
    }
    // CLOSED: append, prune outside the window, decide whether to open.
    this.state.failures.push(ts);
    const cutoff = ts - this.opts.windowMs;
    this.state.failures = this.state.failures.filter((t) => t >= cutoff);
    if (this.state.failures.length >= this.opts.failureThreshold) {
      logServerEvent("error", "circuit opened due to failure threshold", {
        circuit: this.key,
        failures: this.state.failures.length,
        windowMs: this.opts.windowMs,
        cooldownMs: this.opts.cooldownMs,
      });
      this.state = {
        state: "OPEN",
        failures: [],
        openedAt: ts,
        halfOpenInFlight: false,
      };
    }
  }

  /** Run `fn` under the breaker. Convenience wrapper. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    this.beforeCall();
    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure();
      throw err;
    }
  }

  /** Move OPEN → HALF_OPEN once cooldown has elapsed. */
  private advance(): void {
    if (
      this.state.state === "OPEN" &&
      this.state.openedAt !== null &&
      this.now() - this.state.openedAt >= this.opts.cooldownMs
    ) {
      logServerEvent("info", "circuit half-open after cooldown", {
        circuit: this.key,
      });
      this.state = {
        state: "HALF_OPEN",
        failures: [],
        openedAt: this.state.openedAt,
        halfOpenInFlight: false,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Process-local registry. One breaker per upstream `key`.
// ---------------------------------------------------------------------------

const REGISTRY = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(
  key: string,
  options?: CircuitBreakerOptions,
): CircuitBreaker {
  let breaker = REGISTRY.get(key);
  if (!breaker) {
    breaker = new CircuitBreaker(key, options);
    REGISTRY.set(key, breaker);
  }
  return breaker;
}

/** Test-only: drop all breaker state. */
export function __resetCircuitBreakers(): void {
  REGISTRY.clear();
}
