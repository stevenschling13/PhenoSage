import { describe, it, expect, vi, beforeEach } from "vitest";

const { getServerUser, authorizePlantAccess, dbState } = vi.hoisted(() => ({
  getServerUser: vi.fn(),
  authorizePlantAccess: vi.fn(),
  dbState: {
    images: [] as Array<Record<string, unknown>>,
    observations: [] as Array<Record<string, unknown>>,
    findings: [] as Array<Record<string, unknown>>,
  } as {
    images: Array<Record<string, unknown>>;
    observations: Array<Record<string, unknown>>;
    findings: Array<Record<string, unknown>>;
    error?: string;
  },
}));

vi.mock("@/lib/server/auth", () => ({ getServerUser }));
vi.mock("@/lib/server/authorization", () => ({ authorizePlantAccess }));
vi.mock("@/lib/server/db", () => ({
  getDbClient: () => ({
    from(table: string) {
      const rows =
        table === "plant_images"
          ? dbState.images
          : table === "plant_observations"
            ? dbState.observations
            : dbState.findings;
      const result = {
        data: rows,
        error: dbState.error ? { message: dbState.error } : null,
      };
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => Promise.resolve(result),
      };
      return chain;
    },
  }),
}));

import { GET } from "../route";

function req(): Request {
  return new Request("http://localhost/api/plants/p/timeline", {
    method: "GET",
  });
}

async function callGet(plantId: string) {
  return GET(req() as unknown as import("next/server").NextRequest, {
    params: Promise.resolve({ plantId }),
  });
}

describe("GET /api/plants/[plantId]/timeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.images = [];
    dbState.observations = [];
    dbState.findings = [];
    delete dbState.error;
  });

  it("returns 401 when unauthenticated", async () => {
    getServerUser.mockResolvedValue(null);
    const res = await callGet("11111111-1111-1111-1111-111111111111");
    expect(res.status).toBe(401);
  });

  it("returns 404 when user cannot access the plant", async () => {
    getServerUser.mockResolvedValue({ id: "u1" });
    authorizePlantAccess.mockResolvedValue(null);
    const res = await callGet("11111111-1111-1111-1111-111111111111");
    expect(res.status).toBe(404);
  });

  it("returns empty items when no records exist", async () => {
    getServerUser.mockResolvedValue({ id: "u1" });
    authorizePlantAccess.mockResolvedValue({
      plantId: "11111111-1111-1111-1111-111111111111",
      growId: "22222222-2222-2222-2222-222222222222",
      strain: null,
      name: "P",
    });
    const res = await callGet("11111111-1111-1111-1111-111111111111");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: unknown[];
      counts: { images: number };
    };
    expect(body.items).toEqual([]);
    expect(body.counts.images).toBe(0);
  });

  it("merges and orders populated records by date desc", async () => {
    getServerUser.mockResolvedValue({ id: "u1" });
    authorizePlantAccess.mockResolvedValue({
      plantId: "p",
      growId: "g",
      strain: null,
      name: "P",
    });
    dbState.images = [
      {
        id: "img1",
        storage_path: "g/p/1.jpg",
        taken_at: "2026-04-10T12:00:00Z",
        source: "upload",
        notes: null,
        created_at: "2026-04-10T12:00:00Z",
      },
    ];
    dbState.observations = [
      {
        id: "obs1",
        observed_at: "2026-04-12T12:00:00Z",
        height_cm: 30,
        notes: "growing",
        created_at: "2026-04-12T12:00:00Z",
      },
    ];
    dbState.findings = [
      {
        id: "f1",
        category: "positive",
        severity: "info",
        title: "Healthy",
        description: "Looks good",
        recommendation: null,
        image_id: "img1",
        created_at: "2026-04-11T12:00:00Z",
      },
    ];
    const res = await callGet("11111111-1111-1111-1111-111111111111");
    const body = (await res.json()) as {
      items: Array<{ kind: string; at: string }>;
    };
    expect(body.items).toHaveLength(3);
    expect(body.items[0]?.kind).toBe("observation");
    expect(body.items[1]?.kind).toBe("finding");
    expect(body.items[2]?.kind).toBe("image");
  });
});
