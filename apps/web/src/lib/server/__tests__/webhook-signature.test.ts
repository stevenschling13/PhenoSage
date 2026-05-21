import { describe, expect, it } from "vitest";

import {
  MAX_SIGNATURE_AGE_SECONDS,
  computeWebhookSignature,
  verifyWebhookSignature,
} from "../webhook-signature";

const SECRET = "test-secret-do-not-use-in-prod";

function signedHeaders(rawBody: string, secret = SECRET, nowMs = Date.now()) {
  const ts = String(Math.floor(nowMs / 1000));
  return {
    timestamp: ts,
    signature: computeWebhookSignature(rawBody, ts, secret),
  };
}

describe("verifyWebhookSignature", () => {
  it("accepts a correctly signed payload", () => {
    const rawBody = JSON.stringify({ jobId: "abc", status: "succeeded" });
    const { timestamp, signature } = signedHeaders(rawBody);
    const result = verifyWebhookSignature({
      rawBody,
      signatureHeader: signature,
      timestampHeader: timestamp,
      secret: SECRET,
    });
    expect(result).toEqual({ ok: true });
  });

  it("rejects when the signature header is missing", () => {
    const result = verifyWebhookSignature({
      rawBody: "{}",
      signatureHeader: null,
      timestampHeader: String(Math.floor(Date.now() / 1000)),
      secret: SECRET,
    });
    expect(result).toEqual({ ok: false, reason: "missing_signature" });
  });

  it("rejects when the timestamp header is missing", () => {
    const result = verifyWebhookSignature({
      rawBody: "{}",
      signatureHeader: "deadbeef",
      timestampHeader: null,
      secret: SECRET,
    });
    expect(result).toEqual({ ok: false, reason: "missing_timestamp" });
  });

  it("rejects a malformed timestamp", () => {
    const result = verifyWebhookSignature({
      rawBody: "{}",
      signatureHeader: "deadbeef",
      timestampHeader: "not-a-number",
      secret: SECRET,
    });
    expect(result).toEqual({ ok: false, reason: "malformed_timestamp" });
  });

  it("rejects a stale timestamp outside the replay window", () => {
    const rawBody = JSON.stringify({ jobId: "abc" });
    const nowMs = Date.now();
    // Sign with a timestamp far in the past.
    const stale = nowMs - (MAX_SIGNATURE_AGE_SECONDS + 60) * 1000;
    const { timestamp, signature } = signedHeaders(rawBody, SECRET, stale);
    const result = verifyWebhookSignature({
      rawBody,
      signatureHeader: signature,
      timestampHeader: timestamp,
      secret: SECRET,
      now: () => nowMs,
    });
    expect(result).toEqual({ ok: false, reason: "stale_timestamp" });
  });

  it("rejects a signature computed with a different secret", () => {
    const rawBody = JSON.stringify({ jobId: "abc" });
    const { timestamp, signature } = signedHeaders(rawBody, "other-secret");
    const result = verifyWebhookSignature({
      rawBody,
      signatureHeader: signature,
      timestampHeader: timestamp,
      secret: SECRET,
    });
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a tampered body", () => {
    const rawBody = JSON.stringify({ jobId: "abc" });
    const { timestamp, signature } = signedHeaders(rawBody);
    const result = verifyWebhookSignature({
      rawBody: rawBody + " ",
      signatureHeader: signature,
      timestampHeader: timestamp,
      secret: SECRET,
    });
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a tampered timestamp (replay with fresh ts)", () => {
    const rawBody = JSON.stringify({ jobId: "abc" });
    const { timestamp, signature } = signedHeaders(rawBody);
    const replayTs = String(Number.parseInt(timestamp, 10) + 1);
    const result = verifyWebhookSignature({
      rawBody,
      signatureHeader: signature,
      timestampHeader: replayTs,
      secret: SECRET,
    });
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });
});
