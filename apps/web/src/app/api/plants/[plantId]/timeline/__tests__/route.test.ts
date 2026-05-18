import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

const getServerSession = vi.fn();
const getPlantTimeline = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSession(...args),
}));
vi.mock("@/lib/server/plants", () => ({
  getPlantTimeline: (...args: unknown[]) => getPlantTimeline(...args),
  // Re-export the constants the route handler imports for cap
  // validation; without these the route's `MAX_TIMELINE_LIMIT` lookup
  // would be undefined and the 400-message check would still pass
  // but for the wrong reason.
  DEFAULT_TIMELINE_LIMIT: 50,
  MAX_TIMELINE_LIMIT: 200,
}));

import { GET } from "../route";

function makeRequest(search?: string): NextRequest {
  const url = search
    ? `http://localhost/api/plants/p1/timeline?${search}`
    : "http://localhost/api/plants/p1/timeline";
  return new NextRequest(url);
}

function makeParams(plantId: string) {
  return { params: Promise.resolve({ plantId }) };
}

describe("GET /api/plants/[plantId]/timeline", () => {
  beforeEach(() => {
    (getServerSession as Mock).mockReset();
    (getPlantTimeline as Mock).mockReset();
  });

  it("returns 401 when unauthenticated", async () => {
    getServerSession.mockResolvedValue(null);
    const res = await GET(makeRequest(), makeParams("p1"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
    expect(getPlantTimeline).not.toHaveBeenCalled();
  });

  it("returns the plantId from the route params when authenticated", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    getPlantTimeline.mockResolvedValue({ plantId: "plant-xyz", items: [] });
    const res = await GET(makeRequest(), makeParams("plant-xyz"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plantId).toBe("plant-xyz");
    expect(Array.isArray(body.items)).toBe(true);
    // Helper now takes an options bag; when no `?limit` was supplied
    // it's invoked with an empty options object so the helper's
    // default kicks in.
    expect(getPlantTimeline).toHaveBeenCalledWith("plant-xyz", {});
  });

  it("returns 404 when the plant is missing or inaccessible", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    getPlantTimeline.mockResolvedValue(null);

    const res = await GET(makeRequest(), makeParams("missing-plant"));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Plant not found or access denied");
    expect(getPlantTimeline).toHaveBeenCalledWith("missing-plant", {});
  });

  it("returns 500 when the timeline lookup fails", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    getPlantTimeline.mockRejectedValue(new Error("database unavailable"));

    const res = await GET(makeRequest(), makeParams("plant-xyz"));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("database unavailable");
    expect(body.requestId).toEqual(expect.any(String));
  });

  // ─── Pagination contract (Phase 3.3) ────────────────────────────────

  it("passes a valid ?limit through to the helper", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    getPlantTimeline.mockResolvedValue({
      plantId: "plant-xyz",
      items: [],
      limit: 25,
      hasMore: false,
    });
    const res = await GET(makeRequest("limit=25"), makeParams("plant-xyz"));
    expect(res.status).toBe(200);
    expect(getPlantTimeline).toHaveBeenCalledWith("plant-xyz", { limit: 25 });
  });

  it.each([
    ["non-numeric", "abc"],
    ["zero", "0"],
    ["negative", "-5"],
    ["fractional", "10.5"],
    ["over the cap", "201"],
    // `parseInt("10a", 10) === 10` because parseInt does partial
    // parsing — the round-trip check catches the trailing junk that
    // would otherwise silently coerce to 10.
    ["trailing junk", "10a"],
  ])("rejects %s ?limit with 400", async (_label, raw) => {
    // Validation policy: silently coercing bad inputs would mask
    // client bugs (e.g. a forgotten Number() cast). A 400 with a
    // specific message helps the API consumer find the issue fast.
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    const res = await GET(
      makeRequest(`limit=${encodeURIComponent(raw)}`),
      makeParams("plant-xyz"),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/limit/i);
    expect(body.error).toMatch(/200/); // mentions the ceiling
    expect(getPlantTimeline).not.toHaveBeenCalled();
  });

  it("accepts the maximum allowed ?limit (off-by-one regression seal)", async () => {
    // The cap is inclusive — 200 is valid, 201 is not. Pinning the
    // boundary so a future tweak (e.g. `>` → `>=`) is caught.
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    getPlantTimeline.mockResolvedValue({
      plantId: "plant-xyz",
      items: [],
      limit: 200,
      hasMore: false,
    });
    const res = await GET(makeRequest("limit=200"), makeParams("plant-xyz"));
    expect(res.status).toBe(200);
    expect(getPlantTimeline).toHaveBeenCalledWith("plant-xyz", { limit: 200 });
  });

  it("treats an empty ?limit=  as 'no limit supplied'", async () => {
    // A client that forgets to set the value but emits the param
    // (`?limit=`) is treated identically to omitting the param —
    // helper default applies.
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    getPlantTimeline.mockResolvedValue({ plantId: "plant-xyz", items: [] });
    const res = await GET(makeRequest("limit="), makeParams("plant-xyz"));
    expect(res.status).toBe(200);
    expect(getPlantTimeline).toHaveBeenCalledWith("plant-xyz", {});
  });
});
