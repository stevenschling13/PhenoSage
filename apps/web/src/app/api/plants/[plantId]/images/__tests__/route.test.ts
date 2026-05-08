import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

const getServerSession = vi.fn();
const getServerUser = vi.fn();
const persistPlantImageUpload = vi.fn();
const getPlantTimeline = vi.fn();
const rateLimit = vi.fn();
const rateLimitKeyFromRequest = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSession(...args),
  getServerUser: (...args: unknown[]) => getServerUser(...args),
}));
vi.mock("@/lib/server/plants", () => ({
  persistPlantImageUpload: (...args: unknown[]) =>
    persistPlantImageUpload(...args),
  getPlantTimeline: (...args: unknown[]) => getPlantTimeline(...args),
}));
vi.mock("@/lib/server/rate-limit", () => ({
  rateLimit: (...args: unknown[]) => rateLimit(...args),
  rateLimitKeyFromRequest: (...args: unknown[]) =>
    rateLimitKeyFromRequest(...args),
}));

import { POST } from "../route";

function jsonRequest(body: unknown): NextRequest {
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

describe("POST /api/plants/[plantId]/images", () => {
  beforeEach(() => {
    (getServerSession as Mock).mockReset();
    (getServerUser as Mock).mockReset();
    (persistPlantImageUpload as Mock).mockReset();
    (getPlantTimeline as Mock).mockReset();
    (rateLimit as Mock).mockReset();
    (rateLimitKeyFromRequest as Mock).mockReset();
    rateLimit.mockResolvedValue({ ok: true });
    rateLimitKeyFromRequest.mockReturnValue("k");
    getServerUser.mockResolvedValue({ id: "u1" });
    persistPlantImageUpload.mockResolvedValue({
      imageId: "i1",
      storagePath: "plants/p1/i1.jpg",
    });
  });

  it("returns 401 when unauthenticated", async () => {
    getServerSession.mockResolvedValue(null);
    const res = await POST(
      jsonRequest({ imageId: "i1", storagePath: "x" }),
      makeParams("p1"),
    );
    expect(res.status).toBe(401);
    expect(persistPlantImageUpload).not.toHaveBeenCalled();
  });

  it("returns 429 when rate-limited", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    rateLimit.mockResolvedValue({ ok: false });
    const res = await POST(
      jsonRequest({ imageId: "i1", storagePath: "x" }),
      makeParams("p1"),
    );
    expect(res.status).toBe(429);
  });

  it.each([
    ["imageId", { storagePath: "plants/p1/i1.jpg" }],
    ["storagePath", { imageId: "i1" }],
  ])("returns 400 when %s is missing", async (field, body) => {
    getServerSession.mockResolvedValue(SESSION_OK);
    const res = await POST(jsonRequest(body), makeParams("p1"));
    expect(res.status).toBe(400);
    const json = (await res.json()) as {
      error: string;
      issues?: Array<{ path: string }>;
    };
    expect(json.error).toBe("invalid_request");
    expect(json.issues?.some((i) => i.path === field)).toBe(true);
  });

  it("returns 400 when the body is not valid JSON", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    const req = new NextRequest("http://localhost/api/plants/p1/images", {
      method: "POST",
      body: "not-json",
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req, makeParams("p1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_json");
  });

  it("returns 201 on a valid finalize body", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    const res = await POST(
      jsonRequest({ imageId: "i1", storagePath: "plants/p1/i1.jpg" }),
      makeParams("p1"),
    );
    expect(res.status).toBe(201);
    expect(persistPlantImageUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        imageId: "i1",
        plantId: "p1",
        storagePath: "plants/p1/i1.jpg",
      }),
    );
  });

  it("returns 404 when persist returns null", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    persistPlantImageUpload.mockResolvedValueOnce(null);
    const res = await POST(
      jsonRequest({ imageId: "i1", storagePath: "plants/p1/i1.jpg" }),
      makeParams("missing"),
    );
    expect(res.status).toBe(404);
  });
});
