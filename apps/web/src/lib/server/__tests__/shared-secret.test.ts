import { describe, expect, it } from "vitest";

import { verifyBearerToken, verifySharedSecret } from "../shared-secret";

const SECRET = "test-cron-secret-do-not-use-in-prod";

describe("verifySharedSecret", () => {
  it("accepts an exact match", () => {
    expect(verifySharedSecret(SECRET, SECRET)).toBe(true);
  });

  it("rejects a different value of the same length", () => {
    const sameLength = "x".repeat(SECRET.length);
    expect(sameLength).toHaveLength(SECRET.length);
    expect(verifySharedSecret(sameLength, SECRET)).toBe(false);
  });

  it("rejects a value that differs only in the final byte", () => {
    expect(verifySharedSecret(`${SECRET.slice(0, -1)}X`, SECRET)).toBe(false);
  });

  it("rejects a prefix of the secret", () => {
    expect(verifySharedSecret(SECRET.slice(0, 10), SECRET)).toBe(false);
  });

  it("rejects the secret with trailing whitespace", () => {
    expect(verifySharedSecret(`${SECRET} `, SECRET)).toBe(false);
  });

  it("is case-sensitive", () => {
    expect(verifySharedSecret(SECRET.toUpperCase(), SECRET)).toBe(false);
  });

  it("rejects when the configured secret is unset", () => {
    expect(verifySharedSecret(SECRET, undefined)).toBe(false);
    expect(verifySharedSecret(SECRET, null)).toBe(false);
    expect(verifySharedSecret(SECRET, "")).toBe(false);
  });

  it("rejects when the caller supplies nothing", () => {
    expect(verifySharedSecret(undefined, SECRET)).toBe(false);
    expect(verifySharedSecret(null, SECRET)).toBe(false);
    expect(verifySharedSecret("", SECRET)).toBe(false);
  });

  it("rejects when both sides are empty", () => {
    expect(verifySharedSecret("", "")).toBe(false);
  });
});

describe("verifyBearerToken", () => {
  it("accepts a correctly formed bearer header", () => {
    expect(verifyBearerToken(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("rejects the bare secret without the Bearer prefix", () => {
    expect(verifyBearerToken(SECRET, SECRET)).toBe(false);
  });

  it("rejects a wrong token behind a valid prefix", () => {
    expect(verifyBearerToken("Bearer not-the-secret", SECRET)).toBe(false);
  });

  it("is case-sensitive on the scheme", () => {
    expect(verifyBearerToken(`bearer ${SECRET}`, SECRET)).toBe(false);
  });

  it("rejects extra whitespace after the scheme", () => {
    expect(verifyBearerToken(`Bearer  ${SECRET}`, SECRET)).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifyBearerToken(null, SECRET)).toBe(false);
    expect(verifyBearerToken(undefined, SECRET)).toBe(false);
    expect(verifyBearerToken("", SECRET)).toBe(false);
  });

  it("rejects every header shape when the secret is unset", () => {
    expect(verifyBearerToken("Bearer ", undefined)).toBe(false);
    expect(verifyBearerToken("Bearer undefined", undefined)).toBe(false);
    expect(verifyBearerToken("Bearer ", "")).toBe(false);
  });
});
