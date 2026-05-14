import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  // The action chains .update(...).eq(...). The eq mock receives the
  // final args and resolves with { data, error }.
  const eq = vi.fn();
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  const supabaseStub = { from };
  const createSupabaseServerClient = vi.fn(async () => supabaseStub);
  const getServerUser = vi.fn(async () => ({ id: "user-1" }));
  const revalidatePath = vi.fn();
  const logServerEvent = vi.fn();
  return {
    eq,
    update,
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

import { toggleGrowArchiveAction } from "../actions";

describe("toggleGrowArchiveAction", () => {
  beforeEach(() => {
    mocks.eq.mockReset();
    mocks.update.mockClear();
    mocks.from.mockClear();
    mocks.createSupabaseServerClient
      .mockReset()
      .mockResolvedValue(mocks.supabaseStub);
    mocks.getServerUser.mockReset().mockResolvedValue({ id: "user-1" });
    mocks.revalidatePath.mockReset();
    mocks.logServerEvent.mockReset();
  });

  it("flips is_archived to true and returns a success redirect", async () => {
    mocks.eq.mockResolvedValue({ error: null });
    const result = await toggleGrowArchiveAction("grow-1", true);

    expect(mocks.update).toHaveBeenCalledWith({ is_archived: true });
    expect(mocks.eq).toHaveBeenCalledWith("id", "grow-1");
    expect(result.status).toBe("success");
    expect(result.message).toMatch(/archived/i);
    expect(result.redirectTo).toBe("/grows/grow-1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/grows");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/grows/grow-1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("flips is_archived to false (restore) with a 'Grow restored' message", async () => {
    mocks.eq.mockResolvedValue({ error: null });
    const result = await toggleGrowArchiveAction("grow-1", false);
    expect(result.status).toBe("success");
    expect(result.message).toMatch(/restored/i);
    expect(mocks.update).toHaveBeenCalledWith({ is_archived: false });
  });

  it("surfaces a clear restore-collision message on 23505", async () => {
    // Unarchiving a grow whose name collides with another active grow
    // trips the partial UNIQUE index from migration 011.
    mocks.eq.mockResolvedValue({
      error: { code: "23505", message: "duplicate key value" },
    });
    const result = await toggleGrowArchiveAction("grow-1", false);
    expect(result.status).toBe("error");
    expect(result.message).toMatch(
      /another active grow already uses this name/i,
    );
  });

  it("surfaces a permission-denied message on RLS rejection", async () => {
    mocks.eq.mockResolvedValue({
      error: { code: "42501", message: "permission denied" },
    });
    const result = await toggleGrowArchiveAction("grow-1", true);
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/only the grow owner/i);
  });

  it("rejects unauthenticated callers without touching supabase", async () => {
    mocks.getServerUser.mockResolvedValueOnce(null as never);
    const result = await toggleGrowArchiveAction("grow-1", true);
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/signed in/i);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("rejects empty growId without touching supabase", async () => {
    const result = await toggleGrowArchiveAction("", true);
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/invalid grow id/i);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("re-throws Next framework redirect signals untouched", async () => {
    const e: Error & { digest?: string } = new Error("NEXT_REDIRECT");
    e.digest = "NEXT_REDIRECT;replace;/grows;307;";
    mocks.createSupabaseServerClient.mockRejectedValueOnce(e);
    await expect(toggleGrowArchiveAction("g", true)).rejects.toBe(e);
  });
});
