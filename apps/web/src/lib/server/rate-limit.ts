import "server-only";
import { logServerEvent } from "./request-id";

/**
 * Sliding-window rate limiter with two backends:
 *
 *  1. **Upstash Redis** (production) — distributed across all serverless
 *     instances. Activated when both `UPSTASH_REDIS_REST_URL` and
 *     `UPSTASH_REDIS_REST_TOKEN` are set.
 *  2. **In-memory** (dev / fallback) — best-effort, per-instance. On Vercel
 *     this means the effective limit is roughly `limit × N_instances`, so it
 *     is **not** safe for production by itself.
 *
 * If the distributed backend is configured but a request to it fails, we
 * **fail open** (allow the request) and emit a structured warn log. Failing
 * closed would convert a Redis outage into a full user-visible outage of
 * every rate-limited endpoint, which is worse than a temporary loss of
 * enforcement. The warn log is the signal for on-call to investigate.
 */

interface Bucket {
  timestamps: number[];
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetAt: number;
}

export interface RateLimitOptions {
  key: string;
  limit: number;
  windowMs: number;
  /** Test-only override for `Date.now()`. Only applied to the in-memory backend. */
  now?: number;
}

function inMemoryRateLimit(opts: RateLimitOptions): RateLimitResult {
  const { key, limit, windowMs } = opts;
  const now = opts.now ?? Date.now();
  const cutoff = now - windowMs;

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { timestamps: [] };
    if (buckets.size >= MAX_BUCKETS) {
      const oldestKey = buckets.keys().next().value;
      if (oldestKey !== undefined) buckets.delete(oldestKey);
    }
    buckets.set(key, bucket);
  }

  bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);

  if (bucket.timestamps.length >= limit) {
    const oldest = bucket.timestamps[0] ?? now;
    return { ok: false, remaining: 0, resetAt: oldest + windowMs };
  }

  bucket.timestamps.push(now);
  return {
    ok: true,
    remaining: limit - bucket.timestamps.length,
    resetAt: now + windowMs,
  };
}

// ─── Distributed backend (lazy) ──────────────────────────────────────────────
//
// We lazily import `@upstash/ratelimit` so the module remains importable in
// environments where the package isn't installed (e.g. CI matrix variants)
// and so the in-memory dev path has zero runtime dependencies.

interface UpstashLimiter {
  limit: (
    _key: string,
    _opts: { rate: number },
  ) => Promise<{
    success: boolean;
    remaining: number;
    reset: number;
  }>;
}

type LimiterCacheKey = string; // `${limit}:${windowMs}`
const limiterCache = new Map<LimiterCacheKey, UpstashLimiter>();
let distributedInitState:
  | { kind: "uninitialised" }
  | { kind: "disabled" }
  | {
      kind: "ready";
      createLimiter: (_limit: number, _windowMs: number) => UpstashLimiter;
    }
  | { kind: "error" } = { kind: "uninitialised" };

async function getDistributedLimiter(
  limit: number,
  windowMs: number,
): Promise<UpstashLimiter | null> {
  if (distributedInitState.kind === "uninitialised") {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
      distributedInitState = { kind: "disabled" };
      logServerEvent("warn", "rate-limit using in-memory fallback", {
        reason: "UPSTASH_REDIS_REST_URL/TOKEN not set",
      });
    } else {
      try {
        const [{ Ratelimit }, { Redis }] = await Promise.all([
          import("@upstash/ratelimit"),
          import("@upstash/redis"),
        ]);
        const redis = new Redis({ url, token });
        distributedInitState = {
          kind: "ready",
          createLimiter: (l, w) =>
            new Ratelimit({
              redis,
              limiter: Ratelimit.slidingWindow(l, `${w} ms`),
              analytics: false,
              prefix: "phenosage:rl",
            }) as unknown as UpstashLimiter,
        };
      } catch (err) {
        distributedInitState = { kind: "error" };
        logServerEvent("warn", "rate-limit distributed init failed", {
          error: err instanceof Error ? err.message : "unknown_error",
        });
      }
    }
  }

  if (distributedInitState.kind !== "ready") return null;

  const cacheKey: LimiterCacheKey = `${limit}:${windowMs}`;
  let limiter = limiterCache.get(cacheKey);
  if (!limiter) {
    limiter = distributedInitState.createLimiter(limit, windowMs);
    limiterCache.set(cacheKey, limiter);
  }
  return limiter;
}

/**
 * Apply a sliding-window rate limit to `opts.key`.
 *
 * Returns a `RateLimitResult` with `ok=false` when the limit is exceeded.
 * Uses Upstash Redis when configured (cross-instance, production-safe) and
 * an in-memory map otherwise. On Redis errors, fails open and logs.
 */
export async function rateLimit(
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  // The `now` override is a test seam for the in-memory backend only.
  // Distributed mode always uses real time on the Redis side.
  if (opts.now !== undefined) {
    return inMemoryRateLimit(opts);
  }

  const distributed = await getDistributedLimiter(opts.limit, opts.windowMs);
  if (!distributed) {
    return inMemoryRateLimit(opts);
  }

  try {
    const res = await distributed.limit(opts.key, { rate: 1 });
    return {
      ok: res.success,
      remaining: res.remaining,
      resetAt: res.reset,
    };
  } catch (err) {
    // Fail open. Losing a Redis call must not take down user-facing routes.
    logServerEvent("warn", "rate-limit distributed call failed; failing open", {
      key: opts.key,
      error: err instanceof Error ? err.message : "unknown_error",
    });
    return {
      ok: true,
      remaining: opts.limit,
      resetAt: Date.now() + opts.windowMs,
    };
  }
}

export function rateLimitKeyFromRequest(
  request: Request,
  userId: string | null,
): string {
  if (userId) return `u:${userId}`;
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || "anonymous";
  return `ip:${ip}`;
}

/** Test-only. Resets both backends and forces re-init on next call. */
export function __resetRateLimitStore(): void {
  buckets.clear();
  limiterCache.clear();
  distributedInitState = { kind: "uninitialised" };
}
