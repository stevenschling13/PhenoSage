import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  // The action chains .insert(...).select("id").abortSignal(...).single().
  // Build a thenable-style chain by default that yields { data: { id }, error: null }.
  const single = vi.fn();
  const abortSignal = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ abortSignal }));
  const insert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ insert }));
  const supabaseStub = { from };
  const createSupabaseServerClient = vi.fn(async () => supabaseStub);
  const getServerUser = vi.fn(async () => ({ id: "user-1" }));
  const revalidatePath = vi.fn();
  const logServerEvent = vi.fn();
  const headersGet = vi.fn((_name: string): string | null => null);
  const headers = vi.fn(async () => ({ get: headersGet }));
  // Rate limit defaults to ok=true; individual tests can override.
  const rateLimit = vi.fn(async () => ({
    ok: true,
    remaining: 99,
    resetAt: Date.now() + 60_000,
  }));
  return {
    abortSignal,
    createSupabaseServerClient,
    from,
    getServerUser,
    headers,
    headersGet,
    insert,
    logServerEvent,
    rateLimit,
    revalidatePath,
    select,
    single,
    supabaseStub,
  };
});

vi.mock("@/lib/server/auth", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
  getServerUser: mocks.getServerUser,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("next/headers", () => ({
  headers: mocks.headers,
}));

vi.mock("@/lib/server/rate-limit", () => ({
  rateLimit: mocks.rateLimit,
}));

vi.mock("@/lib/server/request-id", () => ({
  REQUEST_ID_HEADER: "x-request-id",
  logServerEvent: mocks.logServerEvent,
}));

import { createGrowAction } from "../actions";

function buildFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("name", "North Tent A");
  fd.set("description", "");
  fd.set("stage", "seedling");
  fd.set("medium", "soil");
  fd.set("lightType", "led");
  fd.set("startDate", "2025-01-01");
  fd.set("targetHarvestDate", "");
  for (const [k, v] of Object.entries(overrides)) {
    fd.set(k, v);
  }
  return fd;
}

describe("createGrowAction", () => {
  beforeEach(() => {
    mocks.single.mockReset();
    mocks.abortSignal.mockClear();
    mocks.select.mockClear();
    mocks.insert.mockClear();
    mocks.from.mockClear();
    mocks.createSupabaseServerClient
      .mockReset()
      .mockResolvedValue(mocks.supabaseStub);
    mocks.getServerUser.mockReset().mockResolvedValue({ id: "user-1" });
    mocks.revalidatePath.mockReset();
    mocks.logServerEvent.mockReset();
    mocks.headersGet.mockReset().mockReturnValue(null);
    mocks.headers
      .mockReset()
      .mockResolvedValue({ get: mocks.headersGet } as never);
    // Default: every rateLimit() call passes. Tests that exercise the
    // limit override this per call.
    mocks.rateLimit.mockReset().mockResolvedValue({
      ok: true,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });
  });

  it("returns success and redirects to the new grow's detail page", async () => {
    mocks.single.mockResolvedValue({
      data: { id: "grow-new-123" },
      error: null,
    });
    const result = await createGrowAction(buildFormData());
    expect(result.status).toBe("success");
    // Redirect now lands on /grows/[id] so the user sees the grow they
    // just created. useActionWithRecovery's fallbackUrl=/grows covers
    // the case where the detail page is unreachable.
    expect(result.redirectTo).toBe("/grows/grow-new-123?just_created=1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/grows");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/plants");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("url-encodes the grow id so unusual characters don't break the redirect", async () => {
    mocks.single.mockResolvedValue({
      data: { id: "abc/def?weird" },
      error: null,
    });
    const result = await createGrowAction(buildFormData());
    expect(result.redirectTo).toBe("/grows/abc%2Fdef%3Fweird?just_created=1");
  });

  it("rejects descriptions longer than 2,000 characters as a fieldError", async () => {
    const result = await createGrowAction(
      buildFormData({ description: "x".repeat(2_001) }),
    );
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.description).toMatch(/2000 characters/i);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("accepts descriptions exactly at the 2,000-character limit", async () => {
    mocks.single.mockResolvedValue({
      data: { id: "g-ok" },
      error: null,
    });
    const result = await createGrowAction(
      buildFormData({ description: "x".repeat(2_000) }),
    );
    expect(result.status).toBe("success");
  });

  it("rejects start dates more than a day in the future", async () => {
    const tooFar = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const result = await createGrowAction(buildFormData({ startDate: tooFar }));
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.startDate).toMatch(/day in the future/i);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("allows historical start dates (data-entry catching up after the cycle began)", async () => {
    mocks.single.mockResolvedValue({
      data: { id: "g-old" },
      error: null,
    });
    const result = await createGrowAction(
      buildFormData({ startDate: "2020-01-01" }),
    );
    expect(result.status).toBe("success");
  });

  it("surfaces a friendly duplicate-name message on 23505 without leaking raw error text", async () => {
    mocks.single.mockResolvedValue({
      data: null,
      error: { message: "duplicate key value", code: "23505" },
    });
    const result = await createGrowAction(buildFormData());
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/grow with that name already exists/i);
    expect(result.message).not.toContain("duplicate key value");
  });

  it("returns a structured error (not throw) when supabase rejects the insert", async () => {
    mocks.single.mockResolvedValue({
      data: null,
      error: { message: "permission denied", code: "42501" },
    });
    const result = await createGrowAction(buildFormData());
    expect(result.status).toBe("error");
    // 42501 → RLS / permission denied. The message is intentionally
    // specific so the user knows to sign in again rather than retrying
    // blindly. See POSTGRES_ERROR_COPY in actions.ts for full mapping.
    expect(result.message).toMatch(/permission|sign in again/i);
  });

  it("returns a structured error (not throw) when supabase client itself throws", async () => {
    mocks.createSupabaseServerClient.mockRejectedValueOnce(
      new Error("env missing"),
    );
    const result = await createGrowAction(buildFormData());
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/couldn't save the grow/i);
    expect(mocks.logServerEvent).toHaveBeenCalled();
  });

  it("re-throws Next framework redirect signals untouched", async () => {
    const e: Error & { digest?: string } = new Error("NEXT_REDIRECT");
    e.digest = "NEXT_REDIRECT;replace;/grows;307;";
    mocks.createSupabaseServerClient.mockRejectedValueOnce(e);
    await expect(createGrowAction(buildFormData())).rejects.toBe(e);
  });

  it("rejects when the user is not signed in", async () => {
    mocks.getServerUser.mockResolvedValueOnce(null as never);
    const result = await createGrowAction(buildFormData());
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/signed in/i);
  });

  it("returns field errors for invalid inputs without touching supabase", async () => {
    const result = await createGrowAction(
      buildFormData({ name: "", stage: "bogus", startDate: "not-a-date" }),
    );
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.name).toBeTruthy();
    expect(result.fieldErrors?.stage).toBeTruthy();
    expect(result.fieldErrors?.startDate).toBeTruthy();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("falls back to /grows when the insert returns no row (defensive)", async () => {
    mocks.single.mockResolvedValue({ data: null, error: null });
    const result = await createGrowAction(buildFormData());
    expect(result.status).toBe("error");
  });

  it("blocks duplicate submissions with a friendly idempotency message when the 2s window is exhausted", async () => {
    // First rateLimit() call (idempotency window) returns blocked.
    mocks.rateLimit.mockResolvedValueOnce({
      ok: false,
      remaining: 0,
      resetAt: Date.now() + 2_000,
    });
    const result = await createGrowAction(buildFormData());
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/already saving/i);
    // Insert never even runs — no DB cycles wasted on duplicates.
    expect(mocks.insert).not.toHaveBeenCalled();
    // First failed call is logged with the idempotency reason for triage.
    expect(mocks.logServerEvent).toHaveBeenCalledWith(
      "warn",
      expect.stringMatching(/idempotency/i),
      expect.objectContaining({ userId: "user-1" }),
    );
  });

  it("blocks runaway create-grow spam with the 60s abuse cap", async () => {
    // First rateLimit() call (idempotency) passes; second (abuse cap) blocks.
    mocks.rateLimit
      .mockResolvedValueOnce({
        ok: true,
        remaining: 0,
        resetAt: Date.now() + 2_000,
      })
      .mockResolvedValueOnce({
        ok: false,
        remaining: 0,
        resetAt: Date.now() + 60_000,
      });
    const result = await createGrowAction(buildFormData());
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/slow down|too many|lot of/i);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("maps Postgres 42501 (RLS denied) to a sign-in-again message without leaking provider text", async () => {
    mocks.single.mockResolvedValue({
      data: null,
      error: { message: "permission denied for table grows", code: "42501" },
    });
    const result = await createGrowAction(buildFormData());
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/permission|sign in again/i);
    expect(result.message).not.toContain("permission denied for table");
  });

  it("maps Postgres 23514 (check constraint) to a friendly invalid-value message", async () => {
    mocks.single.mockResolvedValue({
      data: null,
      error: {
        message: 'new row for relation "grows" violates check constraint',
        code: "23514",
      },
    });
    const result = await createGrowAction(buildFormData());
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/isn't valid|valid for this field/i);
    expect(result.message).not.toContain("check constraint");
  });

  it("maps Postgres 23502 (not-null) to a 'required field is missing' message — schema-drift backstop", async () => {
    mocks.single.mockResolvedValue({
      data: null,
      error: {
        message: 'null value in column "name" violates not-null constraint',
        code: "23502",
      },
    });
    const result = await createGrowAction(buildFormData());
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/required field/i);
    expect(result.message).not.toContain("null value");
  });

  it("maps Postgres 40P01 (deadlock) to a retryable 'try again' message", async () => {
    mocks.single.mockResolvedValue({
      data: null,
      error: { message: "deadlock detected", code: "40P01" },
    });
    const result = await createGrowAction(buildFormData());
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/busy|try again/i);
  });

  it("maps Postgres 08006 (connection failure) to a 'database unreachable' message", async () => {
    mocks.single.mockResolvedValue({
      data: null,
      error: {
        message: "connection failure: connection refused",
        code: "08006",
      },
    });
    const result = await createGrowAction(buildFormData());
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/couldn't reach the database|try again/i);
  });

  it("surfaces a 'took longer than expected' message when the supabase call aborts (timeout path)", async () => {
    // Simulate AbortSignal.timeout firing — supabase-js converts this to
    // a thrown DOMException with name "TimeoutError".
    const timeoutErr = Object.assign(new Error("The operation was aborted"), {
      name: "TimeoutError",
    });
    mocks.single.mockRejectedValue(timeoutErr);
    const result = await createGrowAction(buildFormData());
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/took longer|input is preserved/i);
    // The structured log captures isTimeout for triage dashboards.
    expect(mocks.logServerEvent).toHaveBeenCalledWith(
      "error",
      expect.stringMatching(/threw/i),
      expect.objectContaining({ isTimeout: true, errorName: "TimeoutError" }),
    );
  });

  it("returns a structured error (does NOT throw) when getServerUser itself throws — defends against AuthConfigError leaking to the server-component boundary", async () => {
    mocks.getServerUser.mockRejectedValueOnce(
      Object.assign(new Error("Auth is misconfigured"), {
        name: "AuthConfigError",
      }),
    );
    const result = await createGrowAction(buildFormData());
    expect(result.status).toBe("error");
    // The user gets the "temporarily unavailable" copy specific to
    // the auth-config branch, not the generic save-failure copy.
    expect(result.message).toMatch(/temporarily unavailable|try again/i);
    expect(mocks.logServerEvent).toHaveBeenCalledWith(
      "error",
      expect.stringMatching(/top-level threw/i),
      expect.objectContaining({ errorName: "AuthConfigError" }),
    );
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("returns a structured error when rateLimit throws (Redis blowup) instead of leaking a server-component error", async () => {
    mocks.rateLimit.mockRejectedValueOnce(new Error("redis ECONNRESET"));
    const result = await createGrowAction(buildFormData());
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/refresh|sign in|try once more/i);
    expect(mocks.logServerEvent).toHaveBeenCalledWith(
      "error",
      expect.stringMatching(/top-level threw/i),
      expect.objectContaining({ userId: "user-1" }),
    );
  });

  it("propagates the incoming x-request-id header into structured failure logs for cross-system correlation", async () => {
    mocks.headersGet.mockImplementation((name: string) =>
      name === "x-request-id" ? "req-abc-123" : null,
    );
    mocks.single.mockResolvedValue({
      data: null,
      error: { message: "duplicate key value", code: "23505" },
    });
    await createGrowAction(buildFormData());
    expect(mocks.logServerEvent).toHaveBeenCalledWith(
      "error",
      expect.any(String),
      expect.objectContaining({ requestId: "req-abc-123" }),
    );
  });
});
