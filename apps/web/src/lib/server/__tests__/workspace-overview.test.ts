import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createSupabaseServerClient = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  createSupabaseServerClient: (...args: unknown[]) =>
    createSupabaseServerClient(...args),
}));

import { getWorkspaceOverview } from "../workspace-overview";

const ORIGINAL_ENV = process.env;

type TableName = "grows" | "plant_findings" | "plant_images" | "plants";
type QueryResult = {
  data: unknown[] | null;
  error: { message: string } | null;
};

function makeSupabaseMock(results: Record<TableName, QueryResult>) {
  const from = vi.fn((table: TableName) => {
    const limit = vi.fn().mockResolvedValue(results[table]);
    const order = vi.fn(() => ({ limit }));
    const select = vi.fn(() => ({ order }));
    return { select };
  });

  return { client: { from }, from };
}

describe("getWorkspaceOverview", () => {
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

  it("returns an empty overview without constructing Supabase when env is missing", async () => {
    delete process.env["NEXT_PUBLIC_SUPABASE_URL"];

    await expect(getWorkspaceOverview()).resolves.toEqual({
      grows: [],
      openFindings: 0,
      recentActivity: {
        lastCaptureAt: null,
        lastPlantUpdateAt: null,
      },
      recentFindings: [],
      totals: {
        grows: 0,
        images: 0,
        plants: 0,
      },
    });
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("aggregates grows, plants, images, findings, and recent activity for dashboard UX", async () => {
    const { client, from } = makeSupabaseMock({
      grows: {
        data: [
          {
            id: "grow-old",
            light_type: null,
            medium: "soil",
            name: "Older tent",
            stage: "vegetative",
            start_date: "2026-03-01",
            updated_at: "2026-04-01T00:00:00Z",
          },
          {
            id: "grow-new",
            light_type: "LED",
            medium: "coco",
            name: "Flower tent",
            stage: "flower",
            start_date: "2026-04-01",
            updated_at: "2026-05-01T00:00:00Z",
          },
        ],
        error: null,
      },
      plant_findings: {
        data: [
          {
            created_at: "2026-05-03T00:00:00Z",
            grow_id: "grow-new",
            id: "finding-open",
            plant_id: "plant-new",
            resolved_at: null,
            severity: "medium",
            title: "Magnesium deficiency",
          },
          {
            created_at: "2026-05-02T00:00:00Z",
            grow_id: "grow-old",
            id: "finding-resolved",
            plant_id: "plant-missing",
            resolved_at: "2026-05-04T00:00:00Z",
            severity: "low",
            title: "Resolved pest pressure",
          },
        ],
        error: null,
      },
      plant_images: {
        data: [
          {
            created_at: "2026-05-04T00:00:00Z",
            grow_id: "grow-new",
            id: "image-1",
            plant_id: "plant-new",
          },
          {
            created_at: "2026-05-01T00:00:00Z",
            grow_id: "grow-old",
            id: "image-2",
            plant_id: "plant-old",
          },
        ],
        error: null,
      },
      plants: {
        data: [
          {
            grow_id: "grow-new",
            id: "plant-new",
            name: "Blue Dream",
            updated_at: "2026-05-05T00:00:00Z",
          },
          {
            grow_id: "grow-old",
            id: "plant-old",
            name: "Northern Lights",
            updated_at: "2026-04-15T00:00:00Z",
          },
        ],
        error: null,
      },
    });
    createSupabaseServerClient.mockResolvedValue(client);

    const overview = await getWorkspaceOverview();

    expect(from).toHaveBeenCalledTimes(4);
    expect(overview.totals).toEqual({ grows: 2, images: 2, plants: 2 });
    expect(overview.openFindings).toBe(1);
    expect(overview.recentActivity).toEqual({
      lastCaptureAt: "2026-05-04T00:00:00Z",
      lastPlantUpdateAt: "2026-05-05T00:00:00Z",
    });
    expect(overview.grows.map((grow) => grow.id)).toEqual([
      "grow-new",
      "grow-old",
    ]);
    expect(overview.grows[0]).toMatchObject({
      imageCount: 1,
      openFindingCount: 1,
      plantCount: 1,
      primaryPlantId: "plant-new",
      primaryPlantName: "Blue Dream",
    });
    // recentFindings intentionally excludes resolved findings so the
    // visible list aligns with the openFindings count badge (see
    // workspace-overview.ts: filter on !finding.resolved_at).
    expect(overview.recentFindings).toEqual([
      {
        createdAt: "2026-05-03T00:00:00Z",
        growId: "grow-new",
        id: "finding-open",
        plantId: "plant-new",
        plantName: "Blue Dream",
        severity: "medium",
        title: "Magnesium deficiency",
      },
    ]);
  });

  it("throws a stable error when a dashboard query fails", async () => {
    const { client } = makeSupabaseMock({
      grows: { data: [], error: null },
      plant_findings: { data: [], error: null },
      plant_images: { data: null, error: { message: "storage table down" } },
      plants: { data: [], error: null },
    });
    createSupabaseServerClient.mockResolvedValue(client);

    await expect(getWorkspaceOverview()).rejects.toThrow(
      "Failed to load images: storage table down",
    );
  });
});
