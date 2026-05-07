import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

const getServerSession = vi.fn();
const callAnalysisService = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSession(...args),
}));
vi.mock("@/lib/server/analysis-proxy", () => ({
  callAnalysisService: (...args: unknown[]) => callAnalysisService(...args),
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
    (callAnalysisService as Mock).mockReset();
    callAnalysisService.mockResolvedValue({});
  });

  it("returns 401 when unauthenticated", async () => {
    getServerSession.mockResolvedValue(null);
    const res = await GET(makeRequest(), makeParams("p1"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(callAnalysisService).not.toHaveBeenCalled();
  });

  it("returns the plantId in the body and proxies through callAnalysisService", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    const res = await GET(makeRequest(), makeParams("plant-xyz"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plantId).toBe("plant-xyz");
    expect(body.analysis).toBeNull();
    expect(callAnalysisService).toHaveBeenCalledTimes(1);
    expect(callAnalysisService).toHaveBeenCalledWith({
      endpoint: "/plants/plant-xyz/analysis/latest",
      method: "GET",
    });
  });
});
