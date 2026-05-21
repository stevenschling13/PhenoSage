import { describe, expect, it } from "vitest";

import {
  computeGithubSignature,
  verifyGithubSignature,
} from "../github-signature";

const SECRET = "test-github-secret-do-not-use-in-prod";

describe("verifyGithubSignature", () => {
  it("accepts a correctly signed payload", () => {
    const rawBody = JSON.stringify({ action: "opened" });
    const sig = computeGithubSignature(rawBody, SECRET);
    const result = verifyGithubSignature({
      rawBody,
      signatureHeader: sig,
      secret: SECRET,
    });
    expect(result).toEqual({ ok: true });
  });

  it("rejects when the header is missing", () => {
    expect(
      verifyGithubSignature({
        rawBody: "{}",
        signatureHeader: null,
        secret: SECRET,
      }),
    ).toEqual({ ok: false, reason: "missing_signature" });
  });

  it("rejects a header without the sha256= prefix", () => {
    expect(
      verifyGithubSignature({
        rawBody: "{}",
        signatureHeader: "deadbeef",
        secret: SECRET,
      }),
    ).toEqual({ ok: false, reason: "malformed_signature" });
  });

  it("rejects a signature computed with a different secret", () => {
    const rawBody = "{}";
    const sig = computeGithubSignature(rawBody, "other-secret");
    expect(
      verifyGithubSignature({
        rawBody,
        signatureHeader: sig,
        secret: SECRET,
      }),
    ).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a tampered body", () => {
    const rawBody = "{}";
    const sig = computeGithubSignature(rawBody, SECRET);
    expect(
      verifyGithubSignature({
        rawBody: rawBody + " ",
        signatureHeader: sig,
        secret: SECRET,
      }),
    ).toEqual({ ok: false, reason: "bad_signature" });
  });
});
