import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

const getServerSession = vi.fn();
const getServerUser = vi.fn();
const rateLimit = vi.fn();
const rateLimitKeyFromRequest = vi.fn();
const getAuthorizedPlantContext = vi.fn();
const compareImages = vi.fn();
const getDbClient = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSession(...args),
  getServerUser: (...args: unknown[]) => getServerUser(...args),
}));
vi.mock("@/lib/server/rate-limit", () => ({
  rateLimit: (...args: unknown[]) => rateLimit(...args),
  rateLimitKeyFromRequest: (...args: unknown[]) =>
    rateLimitKeyFromRequest(...args),
}));
vi.mock("@/lib/server/plant-access", () => ({
  getAuthorizedPlantContext: (...args: unknown[]) =>
    getAuthorizedPlantContext(...args),
}));
vi.mock("@/lib/server/analysis-proxy", () => ({
  compareImages: (...args: unknown[]) => compareImages(...args),
}));
vi.mock("@/lib/server/db", () => ({
  getDbClient: (...args: unknown[]) => getDbClient(...args),
}));

import { POST } from "../route";
import { UpstreamError } from "@/lib/server/resilience";

const PLANT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_OK = { user: { id: "u1" } } as const;
const CONTEXT_OK = {
  userId: "u1",
  plantId: PLANT_ID,
  plantName: "Plant 1",
  strain: "Blue Dream",
  notes: null,
  growId: "g1",
  growStage: "flower",
  medium: "soil",
  lightType: "led",
  startDate: "2026-04-01",
};

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest(
    `http://localhost/api/plants/${PLANT_ID}/what-changed`,
    { method: "POST", headers },
  );
}

function makeParams(plantId: string) {
  return { params: Promise.resolve({ plantId }) };
}

function makeDb(rows: object[] | null, error: { message: string } | null) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: async () => ({ data: rows, error }),
  };
  return { from: () => builder };
}

describe("POST /api/plants/[plantId]/what-changed", () => {
  beforeEach(() => {
    (getServerSession as Mock).mockReset();
    (getServerUser as Mock).mockReset();
    (rateLimit as Mock).mockReset();
    (rateLimitKeyFromRequest as Mock).mockReset();
    (getAuthorizedPlantContext as Mock).mockReset();
    (compareImages as Mock).mockReset();
    (getDbClient as Mock).mockReset();
    rateLimit.mockReturnValue({ ok: true });
    rateLimitKeyFromRequest.mockReturnValue("k");
    getServerUser.mockResolvedValue({ id: "u1" });
  });

  it("returns 401 when unauthenticated", async () => {
    getServerSession.mockResolvedValue(null);
    const res = await POST(makeRequest(), makeParams(PLANT_ID));
    expect(res.status).toBe(401);
    expect(compareImages).not.toHaveBeenCalled();
  });

  it("returns 400 when plant id is not a uuid", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    const res = await POST(makeRequest(), makeParams("not-a-uuid"));
    expect(res.status).toBe(400);
  });

  it("returns 429 when rate-limited", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    rateLimit.mockReturnValue({ ok: false });
    const res = await POST(makeRequest(), makeParams(PLANT_ID));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
  });

  it("returns 404 when the plant is not accessible", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    getAuthorizedPlantContext.mockResolvedValue(null);
    const res = await POST(makeRequest(), makeParams(PLANT_ID));
    expect(res.status).toBe(404);
    expect(compareImages).not.toHaveBeenCalled();
  });

  it("returns 422 when there is only one stored image", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    getAuthorizedPlantContext.mockResolvedValue(CONTEXT_OK);
    getDbClient.mockReturnValue(
      makeDb(
        [
          {
            id: "i1",
            storage_path: "plants/x/i1.jpg",
            taken_at: null,
            created_at: "2026-05-19",
          },
        ],
        null,
      ),
    );
    const res = await POST(makeRequest(), makeParams(PLANT_ID));
    expect(res.status).toBe(422);
    expect(compareImages).not.toHaveBeenCalled();
  });

  it("returns 500 when the image query fails", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    getAuthorizedPlantContext.mockResolvedValue(CONTEXT_OK);
    getDbClient.mockReturnValue(makeDb(null, { message: "db down" }));
    const res = await POST(makeRequest(), makeParams(PLANT_ID));
    expect(res.status).toBe(500);
    expect(compareImages).not.toHaveBeenCalled();
  });

  it("returns the comparison on the happy path", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    getAuthorizedPlantContext.mockResolvedValue(CONTEXT_OK);
    getDbClient.mockReturnValue(
      makeDb(
        [
          {
            id: "i-current",
            storage_path: "plants/x/current.jpg",
            taken_at: null,
            created_at: "2026-05-19",
          },
          {
            id: "i-prev",
            storage_path: "plants/x/prev.jpg",
            taken_at: null,
            created_at: "2026-05-17",
          },
        ],
        null,
      ),
    );
    compareImages.mockResolvedValue({
      plantId: PLANT_ID,
      imageIdCurrent: "i-current",
      imageIdPrevious: "i-prev",
      summary: "Visible flower development.",
      bullets: ["More flower sites.", "Slightly darker leaves."],
      uniformityDelta: "improved",
      confidence: 0.78,
      analyzedAt: "2026-05-19T00:00:00Z",
      modelVersion: "gpt-4o-test",
    });

    const res = await POST(makeRequest(), makeParams(PLANT_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.imageIdCurrent).toBe("i-current");
    expect(body.data.imageIdPrevious).toBe("i-prev");
    expect(body.data.bullets).toHaveLength(2);
    expect(compareImages).toHaveBeenCalledTimes(1);
    const firstCall = (compareImages as Mock).mock.calls[0];
    expect(firstCall).toBeDefined();
    const args = firstCall![0] as {
      storagePathCurrent: string;
      storagePathPrevious: string;
      growContext: { strain?: string; stage?: string };
    };
    expect(args.storagePathCurrent).toBe("plants/x/current.jpg");
    expect(args.storagePathPrevious).toBe("plants/x/prev.jpg");
    expect(args.growContext.strain).toBe("Blue Dream");
    expect(args.growContext.stage).toBe("flower");
  });

  it("maps an upstream-unavailable error to 503", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    getAuthorizedPlantContext.mockResolvedValue(CONTEXT_OK);
    getDbClient.mockReturnValue(
      makeDb(
        [
          {
            id: "i-current",
            storage_path: "plants/x/current.jpg",
            taken_at: null,
            created_at: "2026-05-19",
          },
          {
            id: "i-prev",
            storage_path: "plants/x/prev.jpg",
            taken_at: null,
            created_at: "2026-05-17",
          },
        ],
        null,
      ),
    );
    compareImages.mockRejectedValue(
      new UpstreamError({
        code: "UPSTREAM_UNAVAILABLE",
        message: "analysis dead",
        operation: "analysis-service",
        requestId: "r",
        attempt: 1,
        retryable: false,
      }),
    );
    const res = await POST(makeRequest(), makeParams(PLANT_ID));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("UPSTREAM_UNAVAILABLE");
  });
});
