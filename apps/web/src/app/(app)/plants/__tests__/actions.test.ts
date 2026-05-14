import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const insertSingle = vi.fn();

  const growBuilder = {
    select: vi.fn(() => growBuilder),
    eq: vi.fn(() => growBuilder),
    maybeSingle,
  };
  const plantBuilder = {
    insert: vi.fn(() => plantBuilder),
    select: vi.fn(() => plantBuilder),
    single: insertSingle,
  };

  const from = vi.fn((table: string) => {
    if (table === "grows") return growBuilder;
    if (table === "plants") return plantBuilder;
    throw new Error(`unexpected table ${table}`);
  });
  const supabaseStub = { from };
  const createSupabaseServerClient = vi.fn(async () => supabaseStub);
  const getServerUser = vi.fn(async () => ({ id: "user-1" }));
  const revalidatePath = vi.fn();
  const logServerEvent = vi.fn();
  return {
    maybeSingle,
    insertSingle,
    growBuilder,
    plantBuilder,
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

import { createPlantAction } from "../actions";

function buildFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("growId", "grow-1");
  fd.set("name", "Plant Alpha");
  fd.set("strain", "");
  fd.set("batchLabel", "");
  fd.set("notes", "");
  for (const [k, v] of Object.entries(overrides)) {
    fd.set(k, v);
  }
  return fd;
}

describe("createPlantAction", () => {
  beforeEach(() => {
    mocks.maybeSingle.mockReset();
    mocks.insertSingle.mockReset();
    mocks.from.mockClear();
    mocks.createSupabaseServerClient
      .mockReset()
      .mockResolvedValue(mocks.supabaseStub);
    mocks.getServerUser.mockReset().mockResolvedValue({ id: "user-1" });
    mocks.revalidatePath.mockReset();
    mocks.logServerEvent.mockReset();
  });

  it("returns success with redirectTo on a clean insert", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { id: "grow-1" },
      error: null,
    });
    mocks.insertSingle.mockResolvedValue({
      data: { id: "plant-9" },
      error: null,
    });
    const result = await createPlantAction(buildFormData());
    expect(result.status).toBe("success");
    expect(result.redirectTo).toBe("/plants/plant-9");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/plants");
  });

  it("returns a structured error when the grow lookup fails", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: null,
      error: { message: "boom" },
    });
    const result = await createPlantAction(buildFormData());
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/couldn't verify the selected grow/i);
    expect(mocks.logServerEvent).toHaveBeenCalled();
  });

  it("returns a field error when the grow is not visible to the user", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    const result = await createPlantAction(buildFormData());
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.growId).toBeTruthy();
  });

  it("returns a friendly duplicate-name message on 23505", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { id: "grow-1" },
      error: null,
    });
    mocks.insertSingle.mockResolvedValue({
      data: null,
      error: { message: "dup", code: "23505" },
    });
    const result = await createPlantAction(buildFormData());
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/already exists/i);
  });

  it("returns a structured error (not throw) when supabase client itself throws", async () => {
    mocks.createSupabaseServerClient.mockRejectedValueOnce(
      new Error("env missing"),
    );
    const result = await createPlantAction(buildFormData());
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/couldn't save the plant/i);
    expect(mocks.logServerEvent).toHaveBeenCalled();
  });

  it("re-throws Next framework redirect signals untouched", async () => {
    const e: Error & { digest?: string } = new Error("NEXT_REDIRECT");
    e.digest = "NEXT_REDIRECT;replace;/plants/x;307;";
    mocks.createSupabaseServerClient.mockRejectedValueOnce(e);
    await expect(createPlantAction(buildFormData())).rejects.toBe(e);
  });

  it("rejects when the user is not signed in", async () => {
    mocks.getServerUser.mockResolvedValueOnce(null as never);
    const result = await createPlantAction(buildFormData());
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/signed in/i);
  });

  it("returns field errors for invalid inputs without touching supabase", async () => {
    const result = await createPlantAction(
      buildFormData({ growId: "", name: "" }),
    );
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.growId).toBeTruthy();
    expect(result.fieldErrors?.name).toBeTruthy();
    expect(mocks.maybeSingle).not.toHaveBeenCalled();
  });
});
