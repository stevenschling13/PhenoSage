import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../route";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getDbClient: vi.fn(),
}));

vi.mock("@/lib/server/auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/server/db", () => ({
  getDbClient: mocks.getDbClient,
}));

const request = new Request(
  "https://app.example.com/api/plants/plant-1/timeline",
) as NextRequest;

describe("GET /api/plants/[plantId]/timeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.getDbClient.mockReturnValue({ from: vi.fn() });
  });

  it("requires an authenticated session", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const res = await GET(request, {
      params: Promise.resolve({ plantId: "plant-1" }),
    });

    expect(res.status).toBe(401);
    expect(mocks.getDbClient).not.toHaveBeenCalled();
  });

  it("returns the placeholder timeline payload for the requested plant", async () => {
    const res = await GET(request, {
      params: Promise.resolve({ plantId: "plant-1" }),
    });

    expect(res.status).toBe(200);
    expect(mocks.getDbClient).toHaveBeenCalledTimes(1);
    await expect(res.json()).resolves.toEqual({
      plantId: "plant-1",
      items: [],
      message: "TODO: Wire Supabase DB timeline query",
    });
  });
});
