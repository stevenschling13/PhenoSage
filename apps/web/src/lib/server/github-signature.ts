import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export const GITHUB_SIGNATURE_HEADER = "x-hub-signature-256";
export const GITHUB_EVENT_HEADER = "x-github-event";
export const GITHUB_DELIVERY_HEADER = "x-github-delivery";

export type GithubSignatureFailure =
  | "missing_signature"
  | "malformed_signature"
  | "bad_signature";

export type GithubSignatureResult =
  | { ok: true }
  | { ok: false; reason: GithubSignatureFailure };

// GitHub signs webhook deliveries with HMAC-SHA256 over the raw request
// body, keyed by the secret configured on the webhook. The header value
// is the literal string "sha256=" followed by the hex digest. The body
// is signed verbatim — any re-serialization invalidates the signature,
// so callers must pass the exact bytes received.
export function computeGithubSignature(
  rawBody: string,
  secret: string,
): string {
  const digest = createHmac("sha256", secret).update(rawBody).digest("hex");
  return `sha256=${digest}`;
}

export function verifyGithubSignature(args: {
  rawBody: string;
  signatureHeader: string | null;
  secret: string;
}): GithubSignatureResult {
  const { rawBody, signatureHeader, secret } = args;
  if (!signatureHeader) return { ok: false, reason: "missing_signature" };
  if (!signatureHeader.startsWith("sha256=")) {
    return { ok: false, reason: "malformed_signature" };
  }
  const expected = computeGithubSignature(rawBody, secret);
  if (expected.length !== signatureHeader.length) {
    return { ok: false, reason: "bad_signature" };
  }
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signatureHeader, "utf8");
  if (!timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }
  return { ok: true };
}
