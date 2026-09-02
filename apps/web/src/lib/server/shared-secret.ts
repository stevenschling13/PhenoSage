import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

// Constant-time comparison for the static shared secrets that guard the
// /api/internal/* routes (cron secret, readiness probe secret, Supabase
// Database Webhook bearers). The HMAC receivers in webhook-signature.ts
// and github-signature.ts already compare digests in constant time; these
// routes compared with `!==`, which short-circuits on the first differing
// byte and is the one remaining timing side-channel on the internal
// surface.
//
// Both sides are hashed to a 32-byte SHA-256 digest before comparison.
// That is deliberate rather than a length-check-then-timingSafeEqual: the
// secrets here are operator-chosen strings of arbitrary length, so an
// early return on a length mismatch would leak the secret's length. Equal
// digest lengths also mean timingSafeEqual can never throw.
function constantTimeEquals(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

/**
 * Compare a caller-supplied secret against the configured one.
 *
 * Returns false when either side is absent, so an unset env var can never
 * authorize a request that also omits the value.
 */
export function verifySharedSecret(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!expected || !provided) return false;
  return constantTimeEquals(provided, expected);
}

/**
 * Compare an `Authorization` header against `Bearer ${expected}`.
 *
 * The whole header value is compared, so the "Bearer " prefix must match
 * exactly — same accept/reject semantics as the `!==` checks this
 * replaces, minus the early-exit timing signal.
 */
export function verifyBearerToken(
  authorizationHeader: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!expected || !authorizationHeader) return false;
  return constantTimeEquals(authorizationHeader, `Bearer ${expected}`);
}
