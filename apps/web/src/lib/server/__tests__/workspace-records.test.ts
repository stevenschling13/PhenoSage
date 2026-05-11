import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createSupabaseServerClient = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  createSupabaseServerClient: (...args: unknown[]) =>
    createSupabaseServerClient(...args),
}));

import {
  listAccessibleGrows,
  listAccessiblePlants,
} from "../workspace-records";

const ORIGINAL_ENV = process.env;

type QueryResult = {
  data: unknown[] | null;
  error: { message: string } | null;
};

function makeSupabaseMock(result: QueryResult) {
  const limit = vi.fn().mockResolvedValue(result);
  const order = vi.fn(() => ({ limit }));
  const select = vi.fn(() => ({ order }));
  const from = vi.fn(() => ({ select }));

  return { client: { from }, from, limit, order, select };
}

describe("workspace-records", () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    };
    createSupabaseServerClient.mockReset();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("returns empty grow and plant lists when Supabase public env is absent", async () => {
    delete process.env["NEXT_PUBLIC_SUPABASE_URL"];
    delete process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];

    await expect(listAccessibleGrows()).resolves.toEqual([]);
    await expect(listAccessiblePlants()).resolves.toEqual([]);
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("maps accessible grow rows into UI-friendly records", async () => {
    const { client, from, limit, order, select } = makeSupabaseMock({
      data: [
        {
          id: "grow-1",
          light_type: "LED",
          medium: "coco",
          name: "Flower tent",
          stage: "flower",
          start_date: "2026-04-01",
          updated_at: "2026-05-01T00:00:00Z",
        },
      ],
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    await expect(listAccessibleGrows()).resolves.toEqual([
      {
        id: "grow-1",
        lightType: "LED",
        medium: "coco",
        name: "Flower tent",
        stage: "flower",
        startDate: "2026-04-01",
        updatedAt: "2026-05-01T00:00:00Z",
      },
    ]);
    expect(from).toHaveBeenCalledWith("grows");
    expect(select).toHaveBeenCalledWith(
      "id,name,stage,medium,light_type,start_date,updated_at",
    );
    expect(order).toHaveBeenCalledWith("updated_at", { ascending: false });
    expect(limit).toHaveBeenCalledWith(100);
  });

  it("maps accessible plant rows and preserves missing grow joins as null", async () => {
    const { client } = makeSupabaseMock({
      data: [
        {
          batch_label: "A",
          grow_id: "grow-1",
          grows: [{ id: "grow-1", name: "Veg tent", stage: "vegetative" }],
          id: "plant-1",
          name: "Blue Dream #1",
          notes: "Lower canopy yellowing",
          strain: "Blue Dream",
          updated_at: "2026-05-02T00:00:00Z",
        },
        {
          batch_label: null,
          grow_id: "grow-2",
          grows: null,
          id: "plant-2",
          name: "Mystery",
          notes: null,
          strain: null,
          updated_at: "2026-05-01T00:00:00Z",
        },
      ],
      error: null,
    });
    createSupabaseServerClient.mockResolvedValue(client);

    await expect(listAccessiblePlants()).resolves.toEqual([
      {
        batchLabel: "A",
        grow: { id: "grow-1", name: "Veg tent", stage: "vegetative" },
        growId: "grow-1",
        id: "plant-1",
        name: "Blue Dream #1",
        notes: "Lower canopy yellowing",
        strain: "Blue Dream",
        updatedAt: "2026-05-02T00:00:00Z",
      },
      {
        batchLabel: null,
        grow: null,
        growId: "grow-2",
        id: "plant-2",
        name: "Mystery",
        notes: null,
        strain: null,
        updatedAt: "2026-05-01T00:00:00Z",
      },
    ]);
  });

  it("throws a stable grow-loading error when Supabase returns an error", async () => {
    const { client } = makeSupabaseMock({
      data: null,
      error: { message: "database unavailable" },
    });
    createSupabaseServerClient.mockResolvedValue(client);

    await expect(listAccessibleGrows()).rejects.toThrow(
      "Failed to load grows: database unavailable",
    );
  });
});
