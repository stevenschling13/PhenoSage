import "server-only";

/**
 * Response-header policy helpers for API routes.
 *
 * The headers set here are the cache-side of the security envelope:
 *
 *   - `noStore(response)` — `Cache-Control: private, no-store`. The
 *     default for any authenticated route. Intermediate proxies and
 *     shared caches MUST NOT store the response, and even
 *     well-behaved browser caches will only hold it for the current
 *     session window. This is the right default for any response
 *     that carries per-user data or that depends on a session
 *     cookie / bearer token.
 *
 *   - `publicCache(response, { maxAgeSeconds, staleWhileRevalidateSeconds })`
 *     — `Cache-Control: public, max-age=N, stale-while-revalidate=M`.
 *     For genuinely cacheable surfaces (health JSON, marketing
 *     fragments). Caller passes explicit values so we never ship a
 *     default that silently caches something user-specific.
 *
 * Both helpers mutate the response's headers in place and return the
 * same response so they can chain — the existing `attachRequestId`
 * helper has the same shape.
 */

const NO_STORE = "private, no-store";

export function noStore<T extends Response>(response: T): T {
  // Use `set`, not `append`: if a downstream wrapper has already
  // configured a Cache-Control (e.g. a streaming chat response that
  // sets `no-store, no-transform`), we leave that alone. Only an
  // unset header gets the default.
  if (!response.headers.has("cache-control")) {
    response.headers.set("cache-control", NO_STORE);
  }
  return response;
}

export interface PublicCacheOptions {
  /** `max-age` in seconds. Required; no implicit default. */
  maxAgeSeconds: number;
  /**
   * `stale-while-revalidate` in seconds. Optional. When set, the cache
   * may serve a stale response while a background revalidation
   * fetches a fresh one.
   */
  staleWhileRevalidateSeconds?: number;
}

export function publicCache<T extends Response>(
  response: T,
  options: PublicCacheOptions,
): T {
  const parts = [`public`, `max-age=${Math.floor(options.maxAgeSeconds)}`];
  if (
    options.staleWhileRevalidateSeconds !== undefined &&
    options.staleWhileRevalidateSeconds > 0
  ) {
    parts.push(
      `stale-while-revalidate=${Math.floor(options.staleWhileRevalidateSeconds)}`,
    );
  }
  // Public-cache callers ARE asserting that the response is safe to
  // share, so we overwrite any prior Cache-Control header — the
  // helper's whole job is to set it.
  response.headers.set("cache-control", parts.join(", "));
  return response;
}
