import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  // The action chains .update(...).eq(...). The eq mock receives the
  // final args and resolves with { data, error }.
  const eq = vi.fn();
  const update = vi.fn(() => ({ eq }));
  // delete chain: .delete().eq(...) — separate eq mock so individual
  // tests can resolve it without affecting the update path.
  const eqDelete = vi.fn();
  const del = vi.fn(() => ({ eq: eqDelete }));
  // select chain: .select(cols).eq(col, val).maybeSingle()
  const maybeSingle = vi.fn();
  const eqSelect = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq: eqSelect }));
  const from = vi.fn(() => ({ update, delete: del, select }));
  const supabaseStub = { from };
  const createSupabaseServerClient = vi.fn(async () => supabaseStub);
  const getServerUser = vi.fn(async () => ({ id: "user-1" }));
  const revalidatePath = vi.fn();
  const logServerEvent = vi.fn();
  return {
    eq,
    update,
    eqDelete,
    del,
    maybeSingle,
    eqSelect,
    select,
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

import {
  advanceGrowStageAction,
  deleteGrowAction,
  toggleGrowArchiveAction,
  updateGrowAction,
} from "../actions";

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

// ─────────────────────────────────────────────────────────────────────
// Helper: mint a FormData with sensible defaults for updateGrowAction.
// Tests override individual fields via the `overrides` object.
function makeUpdateForm(
  overrides: Partial<Record<string, string>> = {},
): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    name: "Tent A",
    description: "Notes",
    stage: "vegetative",
    medium: "soil",
    lightType: "led",
    startDate: "2024-01-01",
    targetHarvestDate: "2024-04-01",
    ...overrides,
  };
  for (const [k, v] of Object.entries(base)) {
    fd.set(k, v);
  }
  return fd;
}

function resetAllMocks() {
  mocks.eq.mockReset();
  mocks.update.mockClear();
  mocks.eqDelete.mockReset();
  mocks.del.mockClear();
  mocks.maybeSingle.mockReset();
  mocks.eqSelect.mockClear();
  mocks.select.mockClear();
  mocks.from.mockClear();
  mocks.createSupabaseServerClient
    .mockReset()
    .mockResolvedValue(mocks.supabaseStub);
  mocks.getServerUser.mockReset().mockResolvedValue({ id: "user-1" });
  mocks.revalidatePath.mockReset();
  mocks.logServerEvent.mockReset();
}

describe("updateGrowAction", () => {
  beforeEach(resetAllMocks);

  it("writes the new fields and returns a success redirect", async () => {
    mocks.eq.mockResolvedValue({ error: null });
    const result = await updateGrowAction("grow-1", makeUpdateForm());

    expect(mocks.from).toHaveBeenCalledWith("grows");
    expect(mocks.update).toHaveBeenCalledWith({
      description: "Notes",
      light_type: "led",
      medium: "soil",
      name: "Tent A",
      stage: "vegetative",
      start_date: "2024-01-01",
      target_harvest_date: "2024-04-01",
    });
    expect(mocks.eq).toHaveBeenCalledWith("id", "grow-1");
    expect(result.status).toBe("success");
    expect(result.redirectTo).toBe("/grows/grow-1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/grows");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/grows/grow-1");
  });

  it("collects field-level validation errors without touching supabase", async () => {
    const fd = makeUpdateForm({
      name: "",
      stage: "not-a-stage",
      startDate: "not-a-date",
    });
    const result = await updateGrowAction("grow-1", fd);
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.name).toMatch(/required/i);
    expect(result.fieldErrors?.stage).toMatch(/valid grow stage/i);
    expect(result.fieldErrors?.startDate).toMatch(/valid start date/i);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("maps 23505 to a name field error", async () => {
    mocks.eq.mockResolvedValue({
      error: { code: "23505", message: "duplicate key value" },
    });
    const result = await updateGrowAction("grow-1", makeUpdateForm());
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.name).toMatch(/already uses this name/i);
  });

  it("maps 42501 to an owner-only message", async () => {
    mocks.eq.mockResolvedValue({
      error: { code: "42501", message: "permission denied" },
    });
    const result = await updateGrowAction("grow-1", makeUpdateForm());
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/only the grow owner/i);
  });

  it("rejects unauthenticated callers without touching supabase", async () => {
    mocks.getServerUser.mockResolvedValueOnce(null as never);
    const result = await updateGrowAction("grow-1", makeUpdateForm());
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/signed in/i);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("re-throws Next framework redirect signals untouched", async () => {
    const e: Error & { digest?: string } = new Error("NEXT_REDIRECT");
    e.digest = "NEXT_REDIRECT;replace;/grows;307;";
    mocks.createSupabaseServerClient.mockRejectedValueOnce(e);
    await expect(updateGrowAction("g", makeUpdateForm())).rejects.toBe(e);
  });
});

describe("advanceGrowStageAction", () => {
  beforeEach(resetAllMocks);

  it("updates the stage and revalidates", async () => {
    mocks.eq.mockResolvedValue({ error: null });
    const result = await advanceGrowStageAction("grow-1", "flower");
    expect(mocks.update).toHaveBeenCalledWith({ stage: "flower" });
    expect(mocks.eq).toHaveBeenCalledWith("id", "grow-1");
    expect(result.status).toBe("success");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/grows/grow-1");
  });

  it("rejects an unknown stage without touching supabase", async () => {
    const result = await advanceGrowStageAction(
      "grow-1",
      "not-a-stage" as never,
    );
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/valid grow stage/i);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("maps 42501 to an owner-only message", async () => {
    mocks.eq.mockResolvedValue({
      error: { code: "42501", message: "permission denied" },
    });
    const result = await advanceGrowStageAction("grow-1", "flower");
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/only the grow owner/i);
  });

  it("rejects unauthenticated callers", async () => {
    mocks.getServerUser.mockResolvedValueOnce(null as never);
    const result = await advanceGrowStageAction("grow-1", "flower");
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/signed in/i);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe("deleteGrowAction", () => {
  beforeEach(resetAllMocks);

  it("deletes the row when the typed name matches and returns redirectTo", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { id: "grow-1", name: "Tent A", owner_id: "user-1" },
      error: null,
    });
    mocks.eqDelete.mockResolvedValue({ error: null });

    const result = await deleteGrowAction("grow-1", "tent a");

    expect(mocks.select).toHaveBeenCalledWith("id,name,owner_id");
    expect(mocks.eqSelect).toHaveBeenCalledWith("id", "grow-1");
    expect(mocks.del).toHaveBeenCalled();
    expect(mocks.eqDelete).toHaveBeenCalledWith("id", "grow-1");
    expect(result.status).toBe("success");
    expect(result.redirectTo).toBe("/grows?deleted=1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/grows");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("rejects when the typed name doesn't match the grow", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { id: "grow-1", name: "Tent A", owner_id: "user-1" },
      error: null,
    });
    const result = await deleteGrowAction("grow-1", "Tent B");
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/doesn't match/i);
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it("returns success no-op when the grow row is missing (already deleted or RLS-hidden)", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    const result = await deleteGrowAction("grow-1", "Tent A");
    expect(result.status).toBe("success");
    expect(result.redirectTo).toBe("/grows?deleted=1");
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it("rejects non-owners even if RLS would allow read (members)", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { id: "grow-1", name: "Tent A", owner_id: "someone-else" },
      error: null,
    });
    const result = await deleteGrowAction("grow-1", "Tent A");
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/only the grow owner/i);
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it("maps 42501 from delete to an owner-only message", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { id: "grow-1", name: "Tent A", owner_id: "user-1" },
      error: null,
    });
    mocks.eqDelete.mockResolvedValue({
      error: { code: "42501", message: "permission denied" },
    });
    const result = await deleteGrowAction("grow-1", "Tent A");
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/only the grow owner/i);
  });

  it("rejects empty confirm name without touching supabase", async () => {
    const result = await deleteGrowAction("grow-1", "   ");
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/type the grow name/i);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callers without touching supabase", async () => {
    mocks.getServerUser.mockResolvedValueOnce(null as never);
    const result = await deleteGrowAction("grow-1", "Tent A");
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/signed in/i);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("re-throws Next framework redirect signals untouched", async () => {
    const e: Error & { digest?: string } = new Error("NEXT_REDIRECT");
    e.digest = "NEXT_REDIRECT;replace;/grows;307;";
    mocks.createSupabaseServerClient.mockRejectedValueOnce(e);
    await expect(deleteGrowAction("g", "x")).rejects.toBe(e);
  });
});
