import { describe, expect, it } from "vitest";
import {
  EnvValidationError,
  assertServerEnv,
  getServerEnvErrors,
} from "../env";

function baseValidEnv(): NodeJS.ProcessEnv {
  return {
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    ANALYSIS_SERVICE_URL: "https://analysis.railway.app",
    ANALYSIS_SERVICE_API_KEY: "api-key",
    GEMINI_API_KEY: "AIzaTestAbcDefGhiJklMnoPqrStuVwx",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  } as unknown as NodeJS.ProcessEnv;
}

describe("env validation", () => {
  it("accepts a well-formed env", () => {
    expect(() => assertServerEnv(baseValidEnv())).not.toThrow();
    expect(getServerEnvErrors(baseValidEnv())).toEqual([]);
  });

  it("rejects a missing server key", () => {
    const env = baseValidEnv();
    delete env["SUPABASE_SERVICE_ROLE_KEY"];
    const errs = getServerEnvErrors(env);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("rejects malformed supabase url", () => {
    const env = baseValidEnv();
    env["NEXT_PUBLIC_SUPABASE_URL"] = "http://localhost";
    const errs = getServerEnvErrors(env);
    expect(errs.some((e) => e.includes("NEXT_PUBLIC_SUPABASE_URL"))).toBe(true);
  });

  it("rejects malformed gemini key", () => {
    const env = baseValidEnv();
    env["GEMINI_API_KEY"] = "not-a-key";
    const errs = getServerEnvErrors(env);
    expect(errs.some((e) => e.includes("GEMINI_API_KEY"))).toBe(true);
  });

  it("throws EnvValidationError with all violations", () => {
    const env = baseValidEnv();
    delete env["SUPABASE_SERVICE_ROLE_KEY"];
    delete env["ANALYSIS_SERVICE_API_KEY"];
    try {
      assertServerEnv(env);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      expect((err as EnvValidationError).violations).toHaveLength(2);
    }
  });
});
