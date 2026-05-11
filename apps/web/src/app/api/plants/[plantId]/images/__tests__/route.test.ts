import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

const getServerSession = vi.fn();
const getServerUser = vi.fn();
const getPlantTimeline = vi.fn();
const persistPlantImageUpload = vi.fn();
const rateLimit = vi.fn();
const rateLimitKeyFromRequest = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSession(...args),
  getServerUser: (...args: unknown[]) => getServerUser(...args),
}));
vi.mock("@/lib/server/plants", () => ({
  getPlantTimeline: (...args: unknown[]) => getPlantTimeline(...args),
  persistPlantImageUpload: (...args: unknown[]) =>
    persistPlantImageUpload(...args),
}));
vi.mock("@/lib/server/rate-limit", () => ({
  rateLimit: (...args: unknown[]) => rateLimit(...args),
  rateLimitKeyFromRequest: (...args: unknown[]) =>
    rateLimitKeyFromRequest(...args),
}));

import { GET, POST } from "../route";

function makeGetRequest() {
  return new NextRequest("http://localhost/api/plants/p1/images");
}

function makePostRequest(body: unknown) {
  return new NextRequest("http://localhost/api/plants/p1/images", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function makeParams(plantId: string) {
  return { params: Promise.resolve({ plantId }) };
}

const SESSION_OK = { user: { id: "u1" } } as const;

describe("GET /api/plants/[plantId]/images", () => {
  beforeEach(() => {
    (getServerSession as Mock).mockReset();
    (getPlantTimeline as Mock).mockReset();
  });

  it("returns 401 when unauthenticated", async () => {
    getServerSession.mockResolvedValue(null);
    const res = await GET(makeGetRequest(), makeParams("p1"));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Unauthorized");
    expect(getPlantTimeline).not.toHaveBeenCalled();
  });

  it("returns 404 when the plant does not exist or access denied", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    getPlantTimeline.mockResolvedValue(null);
    const res = await GET(makeGetRequest(), makeParams("missing"));
    expect(res.status).toBe(404);
  });

  it("returns only timeline items of type 'image'", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    getPlantTimeline.mockResolvedValue({
      plantId: "plant-xyz",
      items: [
        { type: "image", id: "i1" },
        { type: "analysis", id: "a1" },
        { type: "image", id: "i2" },
        { type: "note", id: "n1" },
      ],
    });
    const res = await GET(makeGetRequest(), makeParams("plant-xyz"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plantId).toBe("plant-xyz");
    expect(body.images).toEqual([
      { type: "image", id: "i1" },
      { type: "image", id: "i2" },
    ]);
  });

  it("returns an empty array when the timeline has no images", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    getPlantTimeline.mockResolvedValue({ plantId: "p1", items: [] });
    const res = await GET(makeGetRequest(), makeParams("p1"));
    expect(res.status).toBe(200);
    expect((await res.json()).images).toEqual([]);
  });

  it("returns 500 when the timeline lookup throws", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    getPlantTimeline.mockRejectedValue(new Error("db down"));
    const res = await GET(makeGetRequest(), makeParams("p1"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("db down");
  });
});

describe("POST /api/plants/[plantId]/images", () => {
  beforeEach(() => {
    (getServerSession as Mock).mockReset();
    (getServerUser as Mock).mockReset();
    (persistPlantImageUpload as Mock).mockReset();
    (rateLimit as Mock).mockReset();
    (rateLimitKeyFromRequest as Mock).mockReset();
    rateLimit.mockReturnValue({ ok: true });
    rateLimitKeyFromRequest.mockReturnValue("k");
    getServerUser.mockResolvedValue({ id: "u1" });
  });

  it("returns 401 when unauthenticated", async () => {
    getServerSession.mockResolvedValue(null);
    const res = await POST(
      makePostRequest({ imageId: "i1", storagePath: "plants/p1/i1.jpg" }),
      makeParams("p1"),
    );
    expect(res.status).toBe(401);
    expect(persistPlantImageUpload).not.toHaveBeenCalled();
  });

  it("returns 429 when rate-limited", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    rateLimit.mockReturnValue({ ok: false });
    const res = await POST(
      makePostRequest({ imageId: "i1", storagePath: "plants/p1/i1.jpg" }),
      makeParams("p1"),
    );
    expect(res.status).toBe(429);
    expect(persistPlantImageUpload).not.toHaveBeenCalled();
  });

  it.each([
    ["imageId", { storagePath: "plants/p1/i1.jpg" }],
    ["storagePath", { imageId: "i1" }],
    ["both", {}],
  ])("returns 400 when %s missing", async (_field, body) => {
    getServerSession.mockResolvedValue(SESSION_OK);
    const res = await POST(makePostRequest(body), makeParams("p1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/required/);
  });

  it("returns 404 when plant not found", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    persistPlantImageUpload.mockResolvedValue(null);
    const res = await POST(
      makePostRequest({ imageId: "i1", storagePath: "plants/p1/i1.jpg" }),
      makeParams("missing"),
    );
    expect(res.status).toBe(404);
  });

  it("returns 201 with the persisted record on success", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    persistPlantImageUpload.mockResolvedValue({
      imageId: "i1",
      storagePath: "plants/plant-xyz/i1.jpg",
    });
    const res = await POST(
      makePostRequest({
        imageId: "i1",
        storagePath: "plants/plant-xyz/i1.jpg",
        takenAt: "2024-01-02T03:04:05Z",
        source: "camera",
        notes: "first leaf",
      }),
      makeParams("plant-xyz"),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.imageId).toBe("i1");
    expect(persistPlantImageUpload).toHaveBeenCalledWith({
      imageId: "i1",
      plantId: "plant-xyz",
      storagePath: "plants/plant-xyz/i1.jpg",
      takenAt: "2024-01-02T03:04:05Z",
      source: "camera",
      notes: "first leaf",
    });
  });

  it("omits optional fields from the persistence call when not provided", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    persistPlantImageUpload.mockResolvedValue({ imageId: "i1" });
    await POST(
      makePostRequest({ imageId: "i1", storagePath: "plants/p1/i1.jpg" }),
      makeParams("p1"),
    );
    const callArg = (persistPlantImageUpload as Mock).mock.calls[0]?.[0];
    expect(callArg).not.toHaveProperty("takenAt");
    expect(callArg).not.toHaveProperty("source");
    expect(callArg).not.toHaveProperty("notes");
    expect(callArg?.plantId).toBe("p1");
  });

  it("returns 500 when persistence throws", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    persistPlantImageUpload.mockRejectedValue(new Error("storage failed"));
    const res = await POST(
      makePostRequest({ imageId: "i1", storagePath: "plants/p1/i1.jpg" }),
      makeParams("p1"),
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("storage failed");
  });
});
