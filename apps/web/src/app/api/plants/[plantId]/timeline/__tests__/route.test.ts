import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

const getServerSession = vi.fn();
const getDbClient = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSession(...args),
}));
vi.mock("@/lib/server/db", () => ({
  getDbClient: (...args: unknown[]) => getDbClient(...args),
}));

import { GET } from "../route";

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/plants/p1/timeline");
}

function makeParams(plantId: string) {
  return { params: Promise.resolve({ plantId }) };
}

describe("GET /api/plants/[plantId]/timeline", () => {
  beforeEach(() => {
    (getServerSession as Mock).mockReset();
    (getDbClient as Mock).mockReset();
    getDbClient.mockReturnValue({ __db: true });
  });

  it("returns 401 when unauthenticated", async () => {
    getServerSession.mockResolvedValue(null);
    const res = await GET(makeRequest(), makeParams("p1"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(getDbClient).not.toHaveBeenCalled();
  });

  it("returns the plantId from the route params when authenticated", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    const res = await GET(makeRequest(), makeParams("plant-xyz"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plantId).toBe("plant-xyz");
    expect(Array.isArray(body.items)).toBe(true);
    expect(getDbClient).toHaveBeenCalledTimes(1);
  });
});
