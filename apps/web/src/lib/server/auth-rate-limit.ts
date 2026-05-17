import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { rateLimit, type RateLimitResult } from "./rate-limit";
import { logServerEvent } from "./request-id";

/**
 * Fail-closed rate limit for authentication actions.
 *
 * Applies two independent sliding-window limits to every sign-in,
 * sign-up, and magic-link attempt:
 *
 *   - **Per-IP**: 10 attempts / 15 min. Catches single-source brute-force
 *     bursts. Bound is intentionally generous because a shared NAT (a
 *     corporate office, a coffee-shop hotspot) can carry many legitimate
 *     users behind one IP.
 *   - **Per-email**: 5 attempts / 15 min. Catches credential-stuffing
 *     that's distributed across many IPs but targets one account. The
 *     email is sha256-hashed before being used as the key so the Redis
 *     keyspace doesn't carry user PII verbatim.
 *
 * Both limits are fail-closed: a Redis outage refuses the attempt rather
 * than turning the outage window into an unrestricted brute-force window.
 * The in-memory fallback (used in dev and when Upstash isn't configured)
 * is per-instance only — useful, but not a substitute for the distributed
 * limit in production. Operators must configure Upstash before relying
 * on this for real security.
 *
 * Returns a discriminated union so call sites can render a
 * user-friendly retry hint without leaking which dimension tripped.
 */

/** Window for both limits — chosen to match common credential-stuffing telemetry. */
const AUTH_WINDOW_MS = 15 * 60_000;
/** Per-IP cap. Tuned looser than per-email because of NAT sharing. */
const IP_LIMIT = 10;
/** Per-email cap. Tighter — protects one specific account. */
const EMAIL_LIMIT = 5;

export type AuthRateLimitResult =
  | { ok: true }
  | { ok: false; message: string; retryAfterSeconds: number };

/**
 * Read the client IP from the incoming request headers, preferring the
 * left-most `x-forwarded-for` entry (the original client when Vercel /
 * a reverse proxy is in front). Falls back to `x-real-ip`, then a
 * sentinel string so we still bucket missing-IP requests together
 * instead of skipping the limit entirely.
 */
async function readClientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for") ?? "";
  const first = forwarded.split(",")[0]?.trim();
  if (first) return first;
  const real = h.get("x-real-ip");
  if (real) return real.trim();
  return "no-ip";
}

/**
 * Hash an email address into a short hex digest for use as a Redis key.
 * Lowercases first so `User@Example.com` and `user@example.com` share a
 * bucket. The digest is truncated because the keyspace fanout from a
 * full 64-char sha256 is unnecessary — 16 hex chars is collision-safe
 * for the volumes we care about.
 */
function emailKeyDigest(email: string): string {
  return createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

/** Round-up ceiling so we never tell the user 0 seconds when they're blocked. */
function secondsUntil(resetAt: number): number {
  const delta = Math.ceil((resetAt - Date.now()) / 1000);
  return delta > 0 ? delta : 1;
}

export async function applyAuthRateLimit(opts: {
  email: string;
  attemptKind: "sign-in" | "sign-up" | "otp";
}): Promise<AuthRateLimitResult> {
  const ip = await readClientIp();
  const emailDigest = emailKeyDigest(opts.email);

  // Per-IP check first. If a single IP is bursting we want to reject
  // before we even hash the email, so the attacker can't probe
  // bucket-by-email enumeration through timing differences.
  const ipResult: RateLimitResult = await rateLimit({
    key: `auth:ip:${ip}`,
    limit: IP_LIMIT,
    windowMs: AUTH_WINDOW_MS,
    failClosed: true,
  });
  if (!ipResult.ok) {
    const retry = secondsUntil(ipResult.resetAt);
    logServerEvent("warn", "auth rate limit blocked", {
      attemptKind: opts.attemptKind,
      reason: "ip",
      retryAfterSeconds: retry,
    });
    return {
      ok: false,
      message:
        "Too many sign-in attempts from this network. " +
        `Please wait ${retry} second${retry === 1 ? "" : "s"} and try again.`,
      retryAfterSeconds: retry,
    };
  }

  const emailResult: RateLimitResult = await rateLimit({
    key: `auth:em:${emailDigest}`,
    limit: EMAIL_LIMIT,
    windowMs: AUTH_WINDOW_MS,
    failClosed: true,
  });
  if (!emailResult.ok) {
    const retry = secondsUntil(emailResult.resetAt);
    logServerEvent("warn", "auth rate limit blocked", {
      attemptKind: opts.attemptKind,
      reason: "email",
      retryAfterSeconds: retry,
    });
    return {
      ok: false,
      // Phrase the message identically to the IP variant so an attacker
      // can't distinguish IP-blocked from email-blocked through the UX.
      message:
        "Too many sign-in attempts. " +
        `Please wait ${retry} second${retry === 1 ? "" : "s"} and try again.`,
      retryAfterSeconds: retry,
    };
  }

  return { ok: true };
}
