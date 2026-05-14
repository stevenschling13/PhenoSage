import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  // Bulk insert chain: .from('plants').insert(rows).select('id')  →  thenable.
  // Make `select` a thenable that resolves to whatever the test queued.
  const insertSelectResult = vi.fn();

  const growBuilder = {
    select: vi.fn(() => growBuilder),
    eq: vi.fn(() => growBuilder),
    maybeSingle,
  };

  const plantInsertBuilder = {
    select: (..._args: unknown[]) => ({
      then: (
        onFulfilled: (_v: unknown) => unknown,
        onRejected?: (_e: unknown) => unknown,
      ) => Promise.resolve(insertSelectResult()).then(onFulfilled, onRejected),
    }),
  };

  let lastInsertRows: unknown[] = [];
  const plantBuilder = {
    insert: vi.fn((rows: unknown) => {
      lastInsertRows = Array.isArray(rows) ? rows : [rows];
      return plantInsertBuilder;
    }),
    // expose last insert payload to tests
    _lastRows: () => lastInsertRows,
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
    insertSelectResult,
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
    mocks.insertSelectResult.mockReset();
    mocks.from.mockClear();
    mocks.createSupabaseServerClient
      .mockReset()
      .mockResolvedValue(mocks.supabaseStub);
    mocks.getServerUser.mockReset().mockResolvedValue({ id: "user-1" });
    mocks.revalidatePath.mockReset();
    mocks.logServerEvent.mockReset();
  });

  it("returns success with redirectTo on a clean single insert", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { id: "grow-1" },
      error: null,
    });
    mocks.insertSelectResult.mockReturnValue({
      data: [{ id: "plant-9" }],
      error: null,
    });
    const result = await createPlantAction(buildFormData());
    expect(result.status).toBe("success");
    expect(result.redirectTo).toBe("/plants/plant-9");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/plants");
  });

  it("bulk-creates N plants with zero-padded numeric suffixes and redirects to the registry", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { id: "grow-1" },
      error: null,
    });
    mocks.insertSelectResult.mockReturnValue({
      data: [
        { id: "p-01" },
        { id: "p-02" },
        { id: "p-03" },
        { id: "p-04" },
        { id: "p-05" },
      ],
      error: null,
    });
    const result = await createPlantAction(
      buildFormData({ count: "5", name: "Plant" }),
    );
    expect(result.status).toBe("success");
    expect(result.redirectTo).toBe("/grows?just_added=5&growId=grow-1");
    expect(result.message).toMatch(/5 plants created/i);

    // Verify the insert payload had the auto-numbered names.
    const rows = (
      mocks.plantBuilder as unknown as {
        _lastRows: () => Array<{ name: string }>;
      }
    )._lastRows();
    expect(rows.map((r) => r.name)).toEqual([
      "Plant 1",
      "Plant 2",
      "Plant 3",
      "Plant 4",
      "Plant 5",
    ]);
  });

  it("zero-pads to two digits when bulk count >= 10", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { id: "grow-1" },
      error: null,
    });
    mocks.insertSelectResult.mockReturnValue({
      data: Array.from({ length: 10 }, (_, i) => ({ id: `p-${i + 1}` })),
      error: null,
    });
    await createPlantAction(buildFormData({ count: "10", name: "NL" }));
    const rows = (
      mocks.plantBuilder as unknown as {
        _lastRows: () => Array<{ name: string }>;
      }
    )._lastRows();
    expect(rows.map((r) => r.name)).toEqual([
      "NL 01",
      "NL 02",
      "NL 03",
      "NL 04",
      "NL 05",
      "NL 06",
      "NL 07",
      "NL 08",
      "NL 09",
      "NL 10",
    ]);
  });

  it("rejects bulk count above the cap", async () => {
    const result = await createPlantAction(
      buildFormData({ count: "100", name: "Plant" }),
    );
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.count).toBeTruthy();
    expect(mocks.maybeSingle).not.toHaveBeenCalled();
  });

  it("rejects non-numeric count input", async () => {
    const result = await createPlantAction(
      buildFormData({ count: "abc", name: "Plant" }),
    );
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.count).toBeTruthy();
  });

  it("flags an overly long name prefix that would break the 120-char cap when suffixed", async () => {
    const longName = "x".repeat(118);
    const result = await createPlantAction(
      buildFormData({ count: "5", name: longName }),
    );
    expect(result.status).toBe("error");
    expect(result.fieldErrors?.name).toBeTruthy();
  });

  it("returns a bulk-tailored duplicate-name message on 23505 when count > 1", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { id: "grow-1" },
      error: null,
    });
    mocks.insertSelectResult.mockReturnValue({
      data: null,
      error: { message: "dup", code: "23505" },
    });
    const result = await createPlantAction(
      buildFormData({ count: "3", name: "Plant" }),
    );
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/generated plant names already exists/i);
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
    mocks.insertSelectResult.mockReturnValue({
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
