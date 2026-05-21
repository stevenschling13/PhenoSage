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

  // ───────────────────────────────────────────────────────────────────────
  // Conditional production rules (Phase 2.1)
  // ───────────────────────────────────────────────────────────────────────

  it("does NOT require SENTRY_DSN outside production", () => {
    // Dev / preview deploys (or the empty default) should be unaffected
    // so contributors don't need to mint a Sentry project to run the
    // app locally.
    const env = baseValidEnv();
    delete env["SENTRY_DSN"];
    delete env["NEXT_PUBLIC_APP_ENV"];
    expect(getServerEnvErrors(env)).toEqual([]);

    env["NEXT_PUBLIC_APP_ENV"] = "preview";
    expect(getServerEnvErrors(env)).toEqual([]);
  });

  it("requires SENTRY_DSN when NEXT_PUBLIC_APP_ENV=production", () => {
    // The cost of letting prod go dark (no error tracking, no perf
    // traces) is much higher than the cost of failing the deploy. This
    // test pins that "fail-the-deploy-fast" contract so a future
    // refactor doesn't quietly relax it.
    const env = baseValidEnv();
    delete env["SENTRY_DSN"];
    env["NEXT_PUBLIC_APP_ENV"] = "production";
    const errs = getServerEnvErrors(env);
    expect(errs.some((e) => e.includes("SENTRY_DSN"))).toBe(true);
  });

  it("validates SENTRY_DSN shape when supplied (any environment)", () => {
    // A typo'd or pasted-wrong DSN must surface immediately rather
    // than fail silently inside Sentry's SDK init.
    const env = baseValidEnv();
    env["SENTRY_DSN"] = "definitely-not-a-dsn";
    const errs = getServerEnvErrors(env);
    expect(errs.some((e) => e.includes("SENTRY_DSN"))).toBe(true);
  });

  it("accepts a well-formed SENTRY_DSN in production", () => {
    const env = baseValidEnv();
    env["NEXT_PUBLIC_APP_ENV"] = "production";
    env["SENTRY_DSN"] = "https://abc123@o4504.ingest.sentry.io/12345";
    env["ANALYSIS_WEBHOOK_SECRET"] = "prod-webhook-secret";
    expect(getServerEnvErrors(env)).toEqual([]);
  });

  it("requires ANALYSIS_WEBHOOK_SECRET when NEXT_PUBLIC_APP_ENV=production", () => {
    // The webhook is the receive-side of the async analysis loop; a
    // production deploy without the shared HMAC key can't validate
    // callbacks. Optional in dev/preview so the synchronous /analyze
    // path keeps working without a secret.
    const env = baseValidEnv();
    env["NEXT_PUBLIC_APP_ENV"] = "production";
    env["SENTRY_DSN"] = "https://abc123@o4504.ingest.sentry.io/12345";
    const errs = getServerEnvErrors(env);
    expect(errs.some((e) => e.includes("ANALYSIS_WEBHOOK_SECRET"))).toBe(true);
  });

  it("does NOT require ANALYSIS_WEBHOOK_SECRET outside production", () => {
    const env = baseValidEnv();
    delete env["ANALYSIS_WEBHOOK_SECRET"];
    expect(getServerEnvErrors(env)).toEqual([]);
    env["NEXT_PUBLIC_APP_ENV"] = "preview";
    expect(getServerEnvErrors(env)).toEqual([]);
  });
});
