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
  return {
    signInWithPassword,
    signUp,
    signInWithOtp,
    signOut,
    createSupabaseServerClient,
    redirect,
  };
});

const {
  signInWithPassword,
  signUp,
  signInWithOtp,
  signOut,
  createSupabaseServerClient,
  redirect,
} = mocks;

vi.mock("@/lib/server/auth", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

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
