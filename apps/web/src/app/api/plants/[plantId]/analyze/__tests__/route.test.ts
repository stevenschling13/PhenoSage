import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

const getServerSession = vi.fn();
const getServerUser = vi.fn();
const runAndPersistPlantAnalysis = vi.fn();
const rateLimit = vi.fn();
const rateLimitKeyFromRequest = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSession(...args),
  getServerUser: (...args: unknown[]) => getServerUser(...args),
}));
vi.mock("@/lib/server/plants", () => ({
  runAndPersistPlantAnalysis: (...args: unknown[]) =>
    runAndPersistPlantAnalysis(...args),
}));
vi.mock("@/lib/server/rate-limit", () => ({
  rateLimit: (...args: unknown[]) => rateLimit(...args),
  rateLimitKeyFromRequest: (...args: unknown[]) =>
    rateLimitKeyFromRequest(...args),
}));

import { POST } from "../route";

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/plants/p1/analyze", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function makeParams(plantId: string) {
  return { params: Promise.resolve({ plantId }) };
}

const SESSION_OK = { user: { id: "u1" } } as const;

describe("POST /api/plants/[plantId]/analyze", () => {
  beforeEach(() => {
    (getServerSession as Mock).mockReset();
    (getServerUser as Mock).mockReset();
    (runAndPersistPlantAnalysis as Mock).mockReset();
    (rateLimit as Mock).mockReset();
    (rateLimitKeyFromRequest as Mock).mockReset();
    rateLimit.mockResolvedValue({ ok: true });
    rateLimitKeyFromRequest.mockReturnValue("k");
    getServerUser.mockResolvedValue({ id: "u1" });
    runAndPersistPlantAnalysis.mockResolvedValue({
      analysis: { plantId: "p1", overallHealthScore: 80 },
    });
  });

  it("returns 401 when unauthenticated", async () => {
    getServerSession.mockResolvedValue(null);
    const res = await POST(jsonRequest({}), makeParams("p1"));
    expect(res.status).toBe(401);
    expect(runAndPersistPlantAnalysis).not.toHaveBeenCalled();
  });

  it("returns 429 when rate-limited", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    rateLimit.mockResolvedValue({ ok: false });
    const res = await POST(jsonRequest({}), makeParams("p1"));
    expect(res.status).toBe(429);
    expect(runAndPersistPlantAnalysis).not.toHaveBeenCalled();
  });

  it("namespaces the rate-limit bucket per route", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    await POST(jsonRequest({}), makeParams("p1"));
    expect(rateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ key: expect.stringMatching(/^analyze:/) }),
    );
  });

  it("accepts an empty body (imageId is optional)", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    const res = await POST(jsonRequest({}), makeParams("p1"));
    expect(res.status).toBe(200);
    expect(runAndPersistPlantAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ plantId: "p1" }),
    );
  });

  it("forwards the imageId when provided", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    const res = await POST(
      jsonRequest({ imageId: "image-42" }),
      makeParams("p1"),
    );
    expect(res.status).toBe(200);
    expect(runAndPersistPlantAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ plantId: "p1", imageId: "image-42" }),
    );
  });

  it("returns 400 invalid_request when mode is unknown", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    const res = await POST(jsonRequest({ mode: "auto" }), makeParams("p1"));
    expect(res.status).toBe(400);
    const json = (await res.json()) as {
      error: string;
      issues?: Array<{ path: string }>;
    };
    expect(json.error).toBe("invalid_request");
    expect(json.issues?.some((i) => i.path === "mode")).toBe(true);
    expect(runAndPersistPlantAnalysis).not.toHaveBeenCalled();
  });

  it("returns 400 when the JSON body is malformed", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    const req = new NextRequest("http://localhost/api/plants/p1/analyze", {
      method: "POST",
      body: "not-json",
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req, makeParams("p1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_json");
  });

  it("returns 404 when the plant cannot be loaded", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    runAndPersistPlantAnalysis.mockResolvedValueOnce(null);
    const res = await POST(jsonRequest({}), makeParams("missing"));
    expect(res.status).toBe(404);
  });

  it("returns 404 when no images are available", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    runAndPersistPlantAnalysis.mockResolvedValueOnce({ analysis: null });
    const res = await POST(jsonRequest({}), makeParams("p1"));
    expect(res.status).toBe(404);
  });
});
