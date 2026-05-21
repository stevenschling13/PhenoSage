import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export const WEBHOOK_SIGNATURE_HEADER = "x-phenosage-signature";
export const WEBHOOK_TIMESTAMP_HEADER = "x-phenosage-timestamp";

// Reject payloads whose timestamp drifts more than this from server clock.
// Bounded replay window — long enough to absorb modest clock skew between
// Railway and Vercel, short enough that a leaked signature can't be reused
// indefinitely if disclosed in a log line.
export const MAX_SIGNATURE_AGE_SECONDS = 300;

export type SignatureVerificationFailure =
  | "missing_signature"
  | "missing_timestamp"
  | "malformed_timestamp"
  | "stale_timestamp"
  | "bad_signature";

export type SignatureVerificationResult =
  | { ok: true }
  | { ok: false; reason: SignatureVerificationFailure };

interface VerifyArgs {
  rawBody: string;
  signatureHeader: string | null;
  timestampHeader: string | null;
  secret: string;
  now?: () => number;
}

// Signature shape: hex(HMAC_SHA256(secret, `${timestamp}.${rawBody}`)).
// The timestamp is part of the signed payload so replaying with a fresh
// timestamp header invalidates the signature.
export function computeWebhookSignature(
  rawBody: string,
  timestamp: string,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
}

export function verifyWebhookSignature(
  args: VerifyArgs,
): SignatureVerificationResult {
  const { rawBody, signatureHeader, timestampHeader, secret } = args;
  if (!signatureHeader) return { ok: false, reason: "missing_signature" };
  if (!timestampHeader) return { ok: false, reason: "missing_timestamp" };

  const ts = Number.parseInt(timestampHeader, 10);
  if (!Number.isFinite(ts) || String(ts) !== timestampHeader.trim()) {
    return { ok: false, reason: "malformed_timestamp" };
  }

  const nowSec = Math.floor((args.now?.() ?? Date.now()) / 1000);
  if (Math.abs(nowSec - ts) > MAX_SIGNATURE_AGE_SECONDS) {
    return { ok: false, reason: "stale_timestamp" };
  }

  const expected = computeWebhookSignature(rawBody, timestampHeader, secret);
  const provided = signatureHeader.trim();
  if (expected.length !== provided.length) {
    return { ok: false, reason: "bad_signature" };
  }
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (!timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }
  return { ok: true };
}
