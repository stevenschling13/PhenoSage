import "server-only";
import { randomInt } from "node:crypto";
import { logServerEvent } from "./request-id";

/**
 * Reusable upstream-call policy: timeout + bounded retry with full-jitter
 * exponential backoff + uniform error classification.
 *
 * Inspired by AWS Well-Architected reliability guidance and the Azure
 * Retry pattern. Centralising the policy keeps every upstream call (analysis
 * service, model provider, future Supabase admin calls) consistent — there
 * is exactly one place to tune timeouts, log fields, and retry semantics.
 *
 * Safety rules baked into this utility:
 *   - Default `maxAttempts` is 1. Retries are opt-in.
 *   - `maxAttempts > 1` requires `idempotent === true` OR an `idempotencyKey`.
 *     Retrying a non-idempotent POST without one would create duplicate
 *     side effects on the upstream — we throw a programmer error instead.
 *   - Only timeouts, transport-level network errors, and configured retryable
 *     HTTP statuses are retried. 4xx (except the explicitly-listed retryable
 *     ones) and configuration/auth errors are surfaced immediately.
 *   - Backoff uses full jitter: `delay = random(0, min(maxDelay, base*2^n))`.
 *   - Respects an upstream `Retry-After` header (seconds or HTTP-date) when
 *     the wrapped function provides it on the thrown error.
 *   - Never logs request bodies or response bodies — only structured fields.
 */

export type RetryableStatus = 408 | 429 | 500 | 502 | 503 | 504;

export const DEFAULT_RETRYABLE_STATUSES: readonly number[] = [
  408, 429, 500, 502, 503, 504,
];

export type UpstreamErrorCode =
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_RATE_LIMITED"
  | "UPSTREAM_UNAVAILABLE"
  | "UPSTREAM_BAD_RESPONSE"
  | "UPSTREAM_NETWORK_ERROR";

export interface ResilienceOptions {
  /** Stable, low-cardinality name for logs/spans (e.g. "analysis-service"). */
  operation: string;
  /** Correlation id propagated through logs and OTel attributes. */
  requestId: string;
  /** Per-attempt deadline. The wrapped fn receives a signal that aborts at this. */
  timeoutMs: number;
  /** Total attempts including the first. Default 1 (no retry). */
  maxAttempts?: number;
  /** Initial backoff before the second attempt, in ms. Default 200ms. */
  baseDelayMs?: number;
  /** Cap on a single backoff sleep. Default 4_000ms. */
  maxDelayMs?: number;
  /**
   * Caller asserts the operation is naturally idempotent (e.g. GET, or a
   * POST whose persistence layer dedupes). Required if `maxAttempts > 1`
   * unless `idempotencyKey` is provided.
   */
  idempotent?: boolean;
  /** Caller-provided idempotency key. Presence implies retry-safety. */
  idempotencyKey?: string;
  /** Override the default retryable status set. */
  retryStatuses?: readonly number[];
  /** External cancellation. Combined with the per-attempt timeout signal. */
  signal?: AbortSignal;
  /** Test seam: deterministic jitter. Defaults to a crypto-backed RNG. */
  random?: () => number;
  /** Test seam: deterministic sleep. Defaults to setTimeout. */
  sleep?: (_ms: number) => Promise<void>;
}

/**
 * Structured upstream-call failure. Route handlers map this to one of the
 * standard `ApiErrorCode` values when surfacing to the browser — never echo
 * `cause` or any field other than `code`/`requestId` to the client.
 */
export class UpstreamError extends Error {
  readonly code: UpstreamErrorCode;
  readonly status: number | undefined;
  readonly retryable: boolean;
  readonly requestId: string;
  readonly operation: string;
  readonly attempt: number;
  /** When the upstream returned `Retry-After`, seconds until safe to retry. */
  readonly retryAfterSeconds: number | undefined;

  constructor(init: {
    code: UpstreamErrorCode;
    message: string;
    operation: string;
    requestId: string;
    attempt: number;
    retryable: boolean;
    status?: number;
    retryAfterSeconds?: number;
    cause?: unknown;
  }) {
    super(init.message, init.cause !== undefined ? { cause: init.cause } : {});
    this.name = "UpstreamError";
    this.code = init.code;
    this.operation = init.operation;
    this.requestId = init.requestId;
    this.attempt = init.attempt;
    this.retryable = init.retryable;
    this.status = init.status;
    this.retryAfterSeconds = init.retryAfterSeconds;
  }
}

/**
 * Helpers callers may throw inside `fn` to signal upstream classification
 * cleanly. If the wrapped function throws an `UpstreamError` directly,
 * `withResilience` will respect its `retryable` flag and `retryAfterSeconds`.
 */
export function isUpstreamError(err: unknown): err is UpstreamError {
  return err instanceof UpstreamError;
}

interface InternalAttemptResult<T> {
  ok: true;
  value: T;
}
interface InternalAttemptError {
  ok: false;
  error: UpstreamError;
}

const TRANSPORT_ERROR_RE =
  /(fetch failed|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ENOTFOUND|ETIMEDOUT|EPIPE|socket hang up|network)/i;

function classifyThrow(
  err: unknown,
  operation: string,
  requestId: string,
  attempt: number,
): UpstreamError {
  if (err instanceof UpstreamError) return err;
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      // Distinguish a true upstream-timeout from a caller-cancelled abort.
      // Both bail out — but only timeout is `retryable`.
      const isTimeout = err.name === "TimeoutError";
      return new UpstreamError({
        code: isTimeout ? "UPSTREAM_TIMEOUT" : "UPSTREAM_NETWORK_ERROR",
        message: isTimeout
          ? `${operation} timed out`
          : `${operation} aborted by caller`,
        operation,
        requestId,
        attempt,
        retryable: isTimeout,
        cause: err,
      });
    }
    if (TRANSPORT_ERROR_RE.test(err.message)) {
      return new UpstreamError({
        code: "UPSTREAM_NETWORK_ERROR",
        message: `${operation} network error`,
        operation,
        requestId,
        attempt,
        retryable: true,
        cause: err,
      });
    }
    return new UpstreamError({
      code: "UPSTREAM_BAD_RESPONSE",
      message: `${operation} failed`,
      operation,
      requestId,
      attempt,
      retryable: false,
      cause: err,
    });
  }
  return new UpstreamError({
    code: "UPSTREAM_BAD_RESPONSE",
    message: `${operation} failed (non-Error throw)`,
    operation,
    requestId,
    attempt,
    retryable: false,
  });
}

function combineSignals(
  caller: AbortSignal | undefined,
  timeout: AbortSignal,
): AbortSignal {
  if (!caller) return timeout;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([caller, timeout]);
  }
  // Fallback for older runtimes: forward the caller abort onto the timeout
  // controller manually. We can't introspect `timeout`'s controller, so we
  // create a new combined controller.
  const combined = new AbortController();
  const onAbort = (reason: unknown) => combined.abort(reason);
  if (caller.aborted) combined.abort(caller.reason);
  if (timeout.aborted) combined.abort(timeout.reason);
  caller.addEventListener("abort", () => onAbort(caller.reason), {
    once: true,
  });
  timeout.addEventListener("abort", () => onAbort(timeout.reason), {
    once: true,
  });
  return combined.signal;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Crypto-backed [0,1) RNG. We don't need cryptographic randomness for
 * jitter — `Math.random` would be fine — but the repo's `check-code-scanning`
 * guardrail bans `Math.random` so we use a small wrapper around
 * `crypto.randomInt`.
 */
function defaultRandom(): number {
  // randomInt(max) returns [0, max). 2^31 fits comfortably in a JS number
  // and gives ~9 decimal digits of precision, which is plenty for jitter.
  return randomInt(0, 0x7fffffff) / 0x7fffffff;
}

/**
 * Run `fn` with a per-attempt timeout and (when allowed) bounded jittered
 * retries. On exhaustion, throws a single `UpstreamError`.
 *
 * The wrapped function receives the current attempt number (1-indexed) and
 * a per-attempt `AbortSignal` that fires at `timeoutMs`. The function should
 * pass that signal to `fetch`/SDK calls to enforce the deadline.
 */
export async function withResilience<T>(
  fn: (_attempt: number, _signal: AbortSignal) => Promise<T>,
  options: ResilienceOptions,
): Promise<T> {
  const {
    operation,
    requestId,
    timeoutMs,
    maxAttempts = 1,
    baseDelayMs = 200,
    maxDelayMs = 4_000,
    idempotent = false,
    idempotencyKey,
    retryStatuses = DEFAULT_RETRYABLE_STATUSES,
    signal,
    random = defaultRandom,
    sleep = defaultSleep,
  } = options;

  if (maxAttempts < 1) {
    throw new Error(
      `withResilience: maxAttempts must be >= 1 (operation=${operation})`,
    );
  }
  if (maxAttempts > 1 && !idempotent && !idempotencyKey) {
    // Programmer error — fail loud rather than silently duplicate side
    // effects on the upstream.
    throw new Error(
      `withResilience: maxAttempts > 1 requires idempotent=true or an idempotencyKey (operation=${operation})`,
    );
  }

  let lastError: UpstreamError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await runOnce<T>(fn, {
      operation,
      requestId,
      timeoutMs,
      attempt,
      callerSignal: signal,
      retryStatuses,
    });

    if (result.ok) return result.value;
    lastError = result.error;

    const isLast = attempt === maxAttempts;
    const canRetry = result.error.retryable && !isLast;

    if (!canRetry) {
      logServerEvent("error", "upstream call failed", {
        requestId,
        operation,
        attempt,
        maxAttempts,
        timeoutMs,
        upstreamCode: result.error.code,
        upstreamStatus: result.error.status,
        retryable: result.error.retryable,
        idempotent: Boolean(idempotent || idempotencyKey),
      });
      throw result.error;
    }

    const backoff = computeBackoff({
      attempt,
      baseDelayMs,
      maxDelayMs,
      retryAfterSeconds: result.error.retryAfterSeconds,
      random,
    });

    logServerEvent("warn", "upstream call retrying", {
      requestId,
      operation,
      attempt,
      maxAttempts,
      timeoutMs,
      upstreamCode: result.error.code,
      upstreamStatus: result.error.status,
      backoffMs: backoff,
    });

    await sleep(backoff);
  }

  // Defensive: loop must always either return or throw.
  throw (
    lastError ??
    new UpstreamError({
      code: "UPSTREAM_BAD_RESPONSE",
      message: `${operation} exhausted retries with no recorded error`,
      operation,
      requestId,
      attempt: maxAttempts,
      retryable: false,
    })
  );
}

async function runOnce<T>(
  fn: (_attempt: number, _signal: AbortSignal) => Promise<T>,
  ctx: {
    operation: string;
    requestId: string;
    timeoutMs: number;
    attempt: number;
    callerSignal: AbortSignal | undefined;
    retryStatuses: readonly number[];
  },
): Promise<InternalAttemptResult<T> | InternalAttemptError> {
  const timeoutSignal = AbortSignal.timeout(ctx.timeoutMs);
  const signal = combineSignals(ctx.callerSignal, timeoutSignal);

  try {
    const value = await fn(ctx.attempt, signal);
    return { ok: true, value };
  } catch (err) {
    const upstream = classifyThrow(
      err,
      ctx.operation,
      ctx.requestId,
      ctx.attempt,
    );

    // Allow callers that throw `UpstreamError` with a `status` to opt that
    // status into retry via the configured retryStatuses (lets HTTP-aware
    // wrappers like analysis-proxy keep their own status detection logic).
    if (
      upstream.status !== undefined &&
      ctx.retryStatuses.includes(upstream.status) &&
      !upstream.retryable
    ) {
      return {
        ok: false,
        error: new UpstreamError({
          code: statusToCode(upstream.status),
          message: upstream.message,
          operation: ctx.operation,
          requestId: ctx.requestId,
          attempt: ctx.attempt,
          retryable: true,
          status: upstream.status,
          ...(upstream.retryAfterSeconds !== undefined
            ? { retryAfterSeconds: upstream.retryAfterSeconds }
            : {}),
          cause: upstream.cause,
        }),
      };
    }

    return { ok: false, error: upstream };
  }
}

function statusToCode(status: number): UpstreamErrorCode {
  if (status === 408 || status === 504) return "UPSTREAM_TIMEOUT";
  if (status === 429) return "UPSTREAM_RATE_LIMITED";
  if (status >= 500) return "UPSTREAM_UNAVAILABLE";
  return "UPSTREAM_BAD_RESPONSE";
}

function computeBackoff(args: {
  attempt: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryAfterSeconds: number | undefined;
  random: () => number;
}): number {
  // Honor explicit Retry-After when the upstream told us to wait.
  if (
    args.retryAfterSeconds !== undefined &&
    Number.isFinite(args.retryAfterSeconds) &&
    args.retryAfterSeconds > 0
  ) {
    return Math.min(args.maxDelayMs, Math.ceil(args.retryAfterSeconds * 1000));
  }
  // Full jitter: random(0, min(maxDelay, base * 2^(attempt-1))). attempt is
  // 1-indexed and represents the attempt that just failed; we sleep before
  // the next one.
  const exp = args.baseDelayMs * Math.pow(2, args.attempt - 1);
  const ceiling = Math.min(args.maxDelayMs, exp);
  return Math.floor(args.random() * ceiling);
}
