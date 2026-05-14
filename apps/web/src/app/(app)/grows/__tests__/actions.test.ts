import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const insert = vi.fn();
  const from = vi.fn(() => ({ insert }));
  const supabaseStub = { from };
  const createSupabaseServerClient = vi.fn(async () => supabaseStub);
  const getServerUser = vi.fn(async () => ({ id: "user-1" }));
  const revalidatePath = vi.fn();
  const logServerEvent = vi.fn();
  return {
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
    mocks.insert.mockReset();
    mocks.from.mockClear();
    mocks.createSupabaseServerClient
      .mockReset()
      .mockResolvedValue(mocks.supabaseStub);
    mocks.getServerUser.mockReset().mockResolvedValue({ id: "user-1" });
    mocks.revalidatePath.mockReset();
    mocks.logServerEvent.mockReset();
  });

  it("returns success with redirectTo on a clean insert", async () => {
    mocks.insert.mockResolvedValue({ error: null });
    const result = await createGrowAction(buildFormData());
    expect(result.status).toBe("success");
    expect(result.redirectTo).toBe("/grows");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/grows");
  });

  it("returns a structured error (not throw) when supabase rejects the insert", async () => {
    mocks.insert.mockResolvedValue({
      error: { message: "duplicate key", code: "23505" },
    });
    const result = await createGrowAction(buildFormData());
    expect(result.status).toBe("error");
    expect(result.message).toContain("duplicate key");
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
});
