import { describe, expect, it } from "vitest";
import {
  AUTH_EMAIL_NOT_CONFIRMED,
  AUTH_GENERIC_FAILURE,
  AUTH_INVALID_CREDENTIALS,
  AUTH_MISCONFIGURED,
  AUTH_RATE_LIMITED,
  AUTH_SERVICE_UNREACHABLE,
  AUTH_USER_EXISTS,
  AuthConfigError,
  describeAuthError,
  getAuthConfigViolations,
  isNextNotFoundError,
  isNextRedirectError,
} from "../auth-errors";

describe("getAuthConfigViolations", () => {
  it("flags missing url and anon key", () => {
    expect(getAuthConfigViolations({} as NodeJS.ProcessEnv).sort()).toEqual([
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
    ]);
  });

  it("flags malformed url", () => {
    const env = {
      NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    } as unknown as NodeJS.ProcessEnv;
    expect(getAuthConfigViolations(env)).toEqual(["NEXT_PUBLIC_SUPABASE_URL"]);
  });

  it("returns empty for a well-formed config", () => {
    const env = {
      NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    } as unknown as NodeJS.ProcessEnv;
    expect(getAuthConfigViolations(env)).toEqual([]);
  });
});

describe("isNextRedirectError / isNextNotFoundError", () => {
  it("recognises redirect digests", () => {
    expect(
      isNextRedirectError({ digest: "NEXT_REDIRECT;replace;/x;307;" }),
    ).toBe(true);
    expect(isNextRedirectError({ digest: "OTHER" })).toBe(false);
    expect(isNextRedirectError(null)).toBe(false);
    expect(isNextRedirectError(new Error("boom"))).toBe(false);
  });

  it("recognises not-found digests", () => {
    expect(isNextNotFoundError({ digest: "NEXT_NOT_FOUND" })).toBe(true);
    expect(isNextNotFoundError({ digest: "x" })).toBe(false);
  });
});

describe("describeAuthError", () => {
  it("maps AuthConfigError to misconfigured copy", () => {
    expect(describeAuthError(new AuthConfigError(["FOO"]))).toBe(
      AUTH_MISCONFIGURED,
    );
  });

  it("maps AuthRetryableFetchError to unreachable copy", () => {
    expect(
      describeAuthError({ name: "AuthRetryableFetchError", message: "x" }),
    ).toBe(AUTH_SERVICE_UNREACHABLE);
  });

  it("maps a raw fetch TypeError to unreachable copy", () => {
    const err = new TypeError("fetch failed");
    expect(describeAuthError(err)).toBe(AUTH_SERVICE_UNREACHABLE);
  });

  it("maps invalid_credentials code", () => {
    expect(describeAuthError({ code: "invalid_credentials" })).toBe(
      AUTH_INVALID_CREDENTIALS,
    );
  });

  it("maps email_not_confirmed code", () => {
    expect(describeAuthError({ code: "email_not_confirmed" })).toBe(
      AUTH_EMAIL_NOT_CONFIRMED,
    );
  });

  it("maps user_already_exists code", () => {
    expect(describeAuthError({ code: "user_already_exists" })).toBe(
      AUTH_USER_EXISTS,
    );
  });

  it("maps 429 rate limiting", () => {
    expect(describeAuthError({ status: 429, message: "slow down" })).toBe(
      AUTH_RATE_LIMITED,
    );
  });

  it("falls back to message substring for legacy supabase wording", () => {
    expect(describeAuthError({ message: "Invalid login credentials" })).toBe(
      AUTH_INVALID_CREDENTIALS,
    );
    expect(describeAuthError({ message: "User already registered" })).toBe(
      AUTH_USER_EXISTS,
    );
  });

  it("returns generic copy for unknown shapes", () => {
    expect(describeAuthError(undefined)).toBe(AUTH_GENERIC_FAILURE);
    expect(describeAuthError("string")).toBe(AUTH_GENERIC_FAILURE);
    expect(describeAuthError({ name: "Random", message: "?" })).toBe(
      AUTH_GENERIC_FAILURE,
    );
  });

  it("never returns raw provider text", () => {
    const result = describeAuthError({
      name: "AuthRetryableFetchError",
      message: "TypeError: fetch failed at undici",
    });
    expect(result).not.toContain("fetch failed");
    expect(result).not.toContain("TypeError");
  });
});
