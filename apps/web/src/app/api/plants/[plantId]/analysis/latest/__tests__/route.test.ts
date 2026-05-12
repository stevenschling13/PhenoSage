import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

const getServerSession = vi.fn();
const getLatestPlantAnalysis = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSession(...args),
}));
vi.mock("@/lib/server/plants", () => ({
  getLatestPlantAnalysis: (...args: unknown[]) =>
    getLatestPlantAnalysis(...args),
}));

import { GET } from "../route";

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/plants/p1/analysis/latest");
}

function makeParams(plantId: string) {
  return { params: Promise.resolve({ plantId }) };
}

describe("GET /api/plants/[plantId]/analysis/latest", () => {
  beforeEach(() => {
    (getServerSession as Mock).mockReset();
    (getLatestPlantAnalysis as Mock).mockReset();
  });

  it("returns 401 when unauthenticated", async () => {
    getServerSession.mockResolvedValue(null);
    const res = await GET(makeRequest(), makeParams("p1"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
    expect(getLatestPlantAnalysis).not.toHaveBeenCalled();
  });

  it("returns plantId and null analysis when none is found", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    getLatestPlantAnalysis.mockResolvedValue(null);
    const res = await GET(makeRequest(), makeParams("plant-xyz"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plantId).toBe("plant-xyz");
    expect(body.analysis).toBeNull();
    expect(getLatestPlantAnalysis).toHaveBeenCalledWith("plant-xyz");
  });

  it("returns the analysis payload when present", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    getLatestPlantAnalysis.mockResolvedValue({ score: 0.87 });
    const res = await GET(makeRequest(), makeParams("plant-xyz"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plantId).toBe("plant-xyz");
    expect(body.analysis).toEqual({ score: 0.87 });
  });

  it("returns 500 when the latest analysis lookup fails", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    getLatestPlantAnalysis.mockRejectedValue(new Error("read failed"));

    const res = await GET(makeRequest(), makeParams("plant-xyz"));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("read failed");
    expect(body.requestId).toEqual(expect.any(String));
  });
});
