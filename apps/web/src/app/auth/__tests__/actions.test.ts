import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

const mocks = vi.hoisted(() => {
  const signInWithPassword = vi.fn();
  const signUp = vi.fn();
  const signInWithOtp = vi.fn();
  const signOut = vi.fn();
  const supabaseStub = {
    auth: { signInWithPassword, signUp, signInWithOtp, signOut },
  };
  const createSupabaseServerClient = vi.fn(async () => supabaseStub);
  const redirect = vi.fn((path: string) => {
    const e: Error & { digest?: string } = new Error("NEXT_REDIRECT");
    e.digest = `NEXT_REDIRECT;replace;${path};307;`;
    throw e;
  });
  // Default to allowing every attempt so the existing test cases below
  // continue to exercise the supabase-call path. The "blocks when rate
  // limit denies" cases below override the resolved value explicitly.
  // The signature is typed as the union of the production return so
  // mockResolvedValueOnce({ ok: false, ... }) typechecks alongside the
  // default `{ ok: true }`.
  type AuthRateLimitResult =
    | { ok: true }
    | { ok: false; message: string; retryAfterSeconds: number };
  const applyAuthRateLimit = vi.fn<() => Promise<AuthRateLimitResult>>(
    async () => ({ ok: true }),
  );
  return {
    signInWithPassword,
    signUp,
    signInWithOtp,
    signOut,
    createSupabaseServerClient,
    redirect,
    applyAuthRateLimit,
  };
});

const {
  signInWithPassword,
  signUp,
  signInWithOtp,
  signOut,
  createSupabaseServerClient,
  redirect,
  applyAuthRateLimit,
} = mocks;

vi.mock("@/lib/server/auth", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/server/auth-rate-limit", () => ({
  applyAuthRateLimit: mocks.applyAuthRateLimit,
}));

import {
  AUTH_INVALID_CREDENTIALS,
  AUTH_MISCONFIGURED,
  AUTH_SERVICE_UNREACHABLE,
} from "@/lib/server/auth-errors";
import {
  signInAction,
  signInWithOtpAction,
  signOutAction,
  signUpAction,
} from "../actions";

const ORIGINAL_ENV = process.env;

function fd(values: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
}

function withGoodEnv() {
  process.env["NEXT_PUBLIC_SUPABASE_URL"] = "https://x.supabase.co";
  process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] = "anon";
  process.env["NEXT_PUBLIC_APP_URL"] = "http://localhost:3000";
}

let consoleErrorSpy: Mock;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env["NEXT_PUBLIC_SUPABASE_URL"];
  delete process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
  signInWithPassword.mockReset();
  signUp.mockReset();
  signInWithOtp.mockReset();
  signOut.mockReset();
  createSupabaseServerClient.mockClear();
  redirect.mockClear();
  applyAuthRateLimit.mockClear();
  applyAuthRateLimit.mockResolvedValue({ ok: true });
  consoleErrorSpy = vi
    .spyOn(console, "error")
    .mockImplementation(() => {}) as unknown as Mock;
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  consoleErrorSpy.mockRestore?.();
});

describe("signInAction", () => {
  it("rejects an invalid email without calling Supabase", async () => {
    withGoodEnv();
    const result = await signInAction(
      null,
      fd({ email: "nope", password: "12345678" }),
    );
    expect(result).toEqual({
      ok: false,
      message: "Enter a valid email address.",
      email: "nope",
    });
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("rejects a too-short password and preserves the email", async () => {
    withGoodEnv();
    const result = await signInAction(
      null,
      fd({ email: "a@b.co", password: "short" }),
    );
    expect(result?.ok).toBe(false);
    expect(result?.email).toBe("a@b.co");
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("returns a friendly misconfigured message when env is missing", async () => {
    const result = await signInAction(
      null,
      fd({ email: "a@b.co", password: "longenough" }),
    );
    expect(result).toEqual({
      ok: false,
      message: AUTH_MISCONFIGURED,
      email: "a@b.co",
    });
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("converts a thrown fetch failure to friendly copy", async () => {
    withGoodEnv();
    signInWithPassword.mockRejectedValueOnce(new TypeError("fetch failed"));
    const result = await signInAction(
      null,
      fd({ email: "a@b.co", password: "longenough" }),
    );
    expect(result).toEqual({
      ok: false,
      message: AUTH_SERVICE_UNREACHABLE,
      email: "a@b.co",
    });
    expect(result?.message).not.toContain("fetch failed");
  });

  it("converts AuthRetryableFetchError (returned, not thrown) to friendly copy", async () => {
    withGoodEnv();
    signInWithPassword.mockResolvedValueOnce({
      error: { name: "AuthRetryableFetchError", message: "fetch failed" },
    });
    const result = await signInAction(
      null,
      fd({ email: "a@b.co", password: "longenough" }),
    );
    expect(result?.message).toBe(AUTH_SERVICE_UNREACHABLE);
  });

  it("maps invalid credentials to friendly copy and keeps the email", async () => {
    withGoodEnv();
    signInWithPassword.mockResolvedValueOnce({
      error: {
        code: "invalid_credentials",
        status: 400,
        message: "Invalid login credentials",
      },
    });
    const result = await signInAction(
      null,
      fd({ email: "a@b.co", password: "longenough" }),
    );
    expect(result?.message).toBe(AUTH_INVALID_CREDENTIALS);
    expect(result?.email).toBe("a@b.co");
  });

  it("redirects to /dashboard on success", async () => {
    withGoodEnv();
    signInWithPassword.mockResolvedValueOnce({ error: null });
    await expect(
      signInAction(null, fd({ email: "a@b.co", password: "longenough" })),
    ).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
    expect(redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("blocks the attempt when the auth rate limit denies it", async () => {
    // The rate-limit layer is the first line of defence against
    // credential stuffing — it must run before any Supabase call so
    // that an attacker can't burn through our project quota or learn
    // anything from Supabase's response timing.
    withGoodEnv();
    applyAuthRateLimit.mockResolvedValueOnce({
      ok: false,
      message:
        "Too many sign-in attempts from this network. " +
        "Please wait 42 seconds and try again.",
      retryAfterSeconds: 42,
    });
    const result = await signInAction(
      null,
      fd({ email: "a@b.co", password: "longenough" }),
    );
    expect(result?.ok).toBe(false);
    expect(result?.message).toMatch(/wait 42 second/i);
    expect(applyAuthRateLimit).toHaveBeenCalledWith({
      email: "a@b.co",
      attemptKind: "sign-in",
    });
    // Supabase must NOT be reached when the limit denies.
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });
});

describe("signUpAction", () => {
  it("returns the confirmation message when no session is created", async () => {
    withGoodEnv();
    signUp.mockResolvedValueOnce({ data: { session: null }, error: null });
    const result = await signUpAction(
      null,
      fd({ email: "a@b.co", password: "longenough" }),
    );
    expect(result?.ok).toBe(true);
    expect(result?.email).toBe("a@b.co");
    expect(result?.message).toMatch(/confirmation/i);
  });

  it("redirects to /dashboard when a session is returned", async () => {
    withGoodEnv();
    signUp.mockResolvedValueOnce({
      data: { session: { access_token: "x" } },
      error: null,
    });
    await expect(
      signUpAction(null, fd({ email: "a@b.co", password: "longenough" })),
    ).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
    expect(redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("converts fetch failure to friendly copy", async () => {
    withGoodEnv();
    signUp.mockRejectedValueOnce(new TypeError("fetch failed"));
    const result = await signUpAction(
      null,
      fd({ email: "a@b.co", password: "longenough" }),
    );
    expect(result?.message).toBe(AUTH_SERVICE_UNREACHABLE);
  });

  it("blocks the attempt when the auth rate limit denies it", async () => {
    withGoodEnv();
    applyAuthRateLimit.mockResolvedValueOnce({
      ok: false,
      message:
        "Too many sign-in attempts. Please wait 30 seconds and try again.",
      retryAfterSeconds: 30,
    });
    const result = await signUpAction(
      null,
      fd({ email: "a@b.co", password: "longenough" }),
    );
    expect(result?.ok).toBe(false);
    expect(applyAuthRateLimit).toHaveBeenCalledWith({
      email: "a@b.co",
      attemptKind: "sign-up",
    });
    expect(signUp).not.toHaveBeenCalled();
  });
});

describe("signInWithOtpAction", () => {
  it("succeeds and tells the user to check their email", async () => {
    withGoodEnv();
    signInWithOtp.mockResolvedValueOnce({ error: null });
    const result = await signInWithOtpAction(null, fd({ email: "a@b.co" }));
    expect(result?.ok).toBe(true);
    expect(result?.message).toMatch(/magic link/i);
  });

  it("rejects an invalid email without contacting Supabase", async () => {
    withGoodEnv();
    const result = await signInWithOtpAction(null, fd({ email: "x" }));
    expect(result?.ok).toBe(false);
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("blocks the attempt when the auth rate limit denies it", async () => {
    // Magic-link is the most aggressive abuse vector — no password
    // guess needed — so the rate-limit must run before any mailer call.
    withGoodEnv();
    applyAuthRateLimit.mockResolvedValueOnce({
      ok: false,
      message:
        "Too many sign-in attempts. Please wait 60 seconds and try again.",
      retryAfterSeconds: 60,
    });
    const result = await signInWithOtpAction(null, fd({ email: "a@b.co" }));
    expect(result?.ok).toBe(false);
    expect(applyAuthRateLimit).toHaveBeenCalledWith({
      email: "a@b.co",
      attemptKind: "otp",
    });
    expect(signInWithOtp).not.toHaveBeenCalled();
  });
});

describe("signOutAction", () => {
  it("redirects home even if Supabase throws", async () => {
    withGoodEnv();
    signOut.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(signOutAction()).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("redirects home on success", async () => {
    withGoodEnv();
    signOut.mockResolvedValueOnce({ error: null });
    await expect(signOutAction()).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
    expect(redirect).toHaveBeenCalledWith("/");
  });
});
