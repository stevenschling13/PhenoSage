import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../route";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  callAnalysisService: vi.fn(),
}));

vi.mock("@/lib/server/auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/server/analysis-proxy", () => ({
  callAnalysisService: mocks.callAnalysisService,
}));

const request = new Request(
  "https://app.example.com/api/plants/plant-1/analysis/latest",
) as NextRequest;

describe("GET /api/plants/[plantId]/analysis/latest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.callAnalysisService.mockResolvedValue({ analysis: null });
  });

  it("requires an authenticated session", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const res = await GET(request, {
      params: Promise.resolve({ plantId: "plant-1" }),
    });

    expect(res.status).toBe(401);
    expect(mocks.callAnalysisService).not.toHaveBeenCalled();
  });

  it("proxies the requested plant id through the analysis boundary", async () => {
    const res = await GET(request, {
      params: Promise.resolve({ plantId: "plant-1" }),
    });

    expect(res.status).toBe(200);
    expect(mocks.callAnalysisService).toHaveBeenCalledWith({
      endpoint: "/plants/plant-1/analysis/latest",
      method: "GET",
    });
    await expect(res.json()).resolves.toEqual({
      plantId: "plant-1",
      analysis: null,
      message: "TODO: Wire DB + analysis service proxy",
    });
  });
});
