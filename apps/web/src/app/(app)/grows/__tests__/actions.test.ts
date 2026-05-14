import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  // The action chains .insert(...).select("id").single().
  // Build a thenable-style chain by default that yields { data: { id }, error: null }.
  const single = vi.fn();
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ insert }));
  const supabaseStub = { from };
  const createSupabaseServerClient = vi.fn(async () => supabaseStub);
  const getServerUser = vi.fn(async () => ({ id: "user-1" }));
  const revalidatePath = vi.fn();
  const logServerEvent = vi.fn();
  return {
    single,
    select,
    insert,
    from,
    supabaseStub,
    createSupabaseServerClient,
    getServerUser,
    revalidatePath,
    logServerEvent,
  };
});

vi.mock("@/lib/server/auth", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
  getServerUser: mocks.getServerUser,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/lib/server/request-id", () => ({
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
    mocks.select.mockClear();
    mocks.insert.mockClear();
    mocks.from.mockClear();
    mocks.createSupabaseServerClient
      .mockReset()
      .mockResolvedValue(mocks.supabaseStub);
    mocks.getServerUser.mockReset().mockResolvedValue({ id: "user-1" });
    mocks.revalidatePath.mockReset();
    mocks.logServerEvent.mockReset();
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
    expect(result.message).toMatch(/couldn't save the grow/i);
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
});
