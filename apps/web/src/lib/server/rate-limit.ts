import "server-only";

/**
 * Lightweight in-memory sliding-window limiter.
 *
 * Sufficient for Vercel serverless where each instance is short-lived.
 * Upgrade to `@upstash/ratelimit` (Redis) when you need cross-instance
 * enforcement or burst protection stronger than best-effort.
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
  now?: number;
}

export function rateLimit(opts: RateLimitOptions): RateLimitResult {
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

export function rateLimitKeyFromRequest(
  request: Request,
  userId: string | null,
): string {
  if (userId) return `u:${userId}`;
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || "anonymous";
  return `ip:${ip}`;
}

/** Test-only. */
export function __resetRateLimitStore(): void {
  buckets.clear();
}
