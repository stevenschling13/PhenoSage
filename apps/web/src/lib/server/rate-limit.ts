import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { logServerEvent } from "./request-id";

/**
 * Rate limiter with two backends.
 *
 * Production (Vercel, multi-lambda): Upstash Redis sliding window.
 *   Activated when both UPSTASH_REDIS_REST_URL and
 *   UPSTASH_REDIS_REST_TOKEN are set.
 *
 * Dev / test / fallback: in-process sliding window.
 *   Each lambda gets its own counter — fine for one-machine dev.
 *   Used when Upstash env is missing, and as a fail-open fallback when
 *   a Redis call throws (we never let the limiter take down the site).
 *
 * The function signature is the same in either backend; callers always
 * `await rateLimit(...)` and read `result.ok`.
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
  /** Test hook — overrides Date.now() for the in-memory backend. */
  now?: number;
}

// ── Redis singleton (lazy, env-aware) ─────────────────────────────────────

let redisClient: Redis | null | undefined; // undefined = not yet resolved

function getRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient;
  const url = process.env["UPSTASH_REDIS_REST_URL"];
  const token = process.env["UPSTASH_REDIS_REST_TOKEN"];
  if (!url || !token) {
    redisClient = null;
    return null;
  }
  try {
    redisClient = new Redis({ url, token });
  } catch (error) {
    logServerEvent("warn", "rate-limit: failed to construct Redis client", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    redisClient = null;
  }
  return redisClient;
}

// One Ratelimit instance per (limit, windowMs) tuple — re-creating per
// call would defeat the @upstash/ratelimit internal cache.
const limiterCache = new Map<string, Ratelimit>();

function getDistributedLimiter(
  redis: Redis,
  limit: number,
  windowMs: number,
): Ratelimit {
  const cacheKey = `${limit}:${windowMs}`;
  let limiter = limiterCache.get(cacheKey);
  if (!limiter) {
    // Upstash duration syntax: "<n> <unit>". Convert ms → s, floor at 1s.
    const seconds = Math.max(1, Math.ceil(windowMs / 1000));
    limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, `${seconds} s` as `${number} s`),
      prefix: "phenosage:rl",
      analytics: false,
    });
    limiterCache.set(cacheKey, limiter);
  }
  return limiter;
}

// ── In-memory fallback (sliding window) ───────────────────────────────────

function inMemoryLimit(opts: RateLimitOptions): RateLimitResult {
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

// ── Public API ────────────────────────────────────────────────────────────

export async function rateLimit(
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  const redis = getRedis();
  if (redis) {
    try {
      const limiter = getDistributedLimiter(redis, opts.limit, opts.windowMs);
      const result = await limiter.limit(opts.key);
      return {
        ok: result.success,
        remaining: result.remaining,
        resetAt: result.reset,
      };
    } catch (error) {
      // Fail open with a loud log — never silently disable the limiter,
      // but never let a Redis hiccup take down the site either.
      logServerEvent("warn", "rate-limit: redis call failed; falling back", {
        key: opts.key,
        error: error instanceof Error ? error.message : "unknown_error",
      });
      // fall through to in-memory
    }
  }
  return inMemoryLimit(opts);
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

/** Test-only. Resets in-memory state and the lazy Redis singleton. */
export function __resetRateLimitStore(): void {
  buckets.clear();
  limiterCache.clear();
  redisClient = undefined;
}
