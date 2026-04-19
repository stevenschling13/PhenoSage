import { describe, it, expect, vi, beforeEach } from "vitest";

const { getServerUser, authorizePlantAccess, analysisRow, findingsRows } =
  vi.hoisted(() => ({
    getServerUser: vi.fn(),
    authorizePlantAccess: vi.fn(),
    analysisRow: { row: null as Record<string, unknown> | null },
    findingsRows: { rows: [] as Array<Record<string, unknown>> },
  }));

vi.mock("@/lib/server/auth", () => ({ getServerUser }));
vi.mock("@/lib/server/authorization", () => ({ authorizePlantAccess }));
vi.mock("@/lib/server/db", () => ({
  getDbClient: () => ({
    from(table: string) {
      if (table === "plant_analyses") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: () =>
            Promise.resolve({ data: analysisRow.row, error: null }),
        };
        return chain;
      }
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => Promise.resolve({ data: findingsRows.rows, error: null }),
      };
      return chain;
    },
  }),
}));

import { GET } from "../route";

function req(): Request {
  return new Request("http://localhost/api/plants/p/analysis/latest", {
    method: "GET",
  });
}

async function callGet(plantId: string) {
  return GET(req() as unknown as import("next/server").NextRequest, {
    params: Promise.resolve({ plantId }),
  });
}

describe("GET /api/plants/[plantId]/analysis/latest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    analysisRow.row = null;
    findingsRows.rows = [];
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

  it("returns analysis null when no record exists", async () => {
    getServerUser.mockResolvedValue({ id: "u1" });
    authorizePlantAccess.mockResolvedValue({
      plantId: "p",
      growId: "g",
      strain: null,
      name: "P",
    });
    const res = await callGet("11111111-1111-1111-1111-111111111111");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { analysis: null };
    expect(body.analysis).toBeNull();
  });

  it("maps a persisted analysis and its findings", async () => {
    getServerUser.mockResolvedValue({ id: "u1" });
    authorizePlantAccess.mockResolvedValue({
      plantId: "p",
      growId: "g",
      strain: null,
      name: "P",
    });
    analysisRow.row = {
      id: "a1",
      plant_id: "p",
      image_id: "img1",
      overall_health_score: 82.5,
      summary: "Healthy",
      compared_to_image_id: null,
      comparison_summary: null,
      model_version: "gpt-4o-v1",
      analyzed_at: "2026-04-12T00:00:00Z",
    };
    findingsRows.rows = [
      {
        category: "nutrient_deficiency",
        severity: "low",
        title: "Mild N",
        description: "Some yellow",
        recommendation: "Feed more N",
      },
    ];
    const res = await callGet("11111111-1111-1111-1111-111111111111");
    const body = (await res.json()) as {
      analysis: {
        overallHealthScore: number;
        findings: Array<{ recommendation?: string }>;
      };
    };
    expect(body.analysis.overallHealthScore).toBe(82.5);
    expect(body.analysis.findings[0]?.recommendation).toBe("Feed more N");
  });
});
