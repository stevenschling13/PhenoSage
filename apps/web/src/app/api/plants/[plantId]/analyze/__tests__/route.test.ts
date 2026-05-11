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

function jsonRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/plants/p1/analyze", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });
}

function rawRequest(body: string, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/plants/p1/analyze", {
    method: "POST",
    body,
    headers: { "content-type": "application/json", ...headers },
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
    rateLimit.mockReturnValue({ ok: true });
    rateLimitKeyFromRequest.mockReturnValue("k");
    getServerUser.mockResolvedValue({ id: "u1" });
  });

  it("returns 401 when no session is present", async () => {
    getServerSession.mockResolvedValue(null);
    const res = await POST(jsonRequest({}), makeParams("p1"));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Unauthorized");
    expect(runAndPersistPlantAnalysis).not.toHaveBeenCalled();
  });

  it("returns 429 when rate-limited", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    rateLimit.mockReturnValue({ ok: false });
    const res = await POST(jsonRequest({}), makeParams("p1"));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/Too many/);
    expect(runAndPersistPlantAnalysis).not.toHaveBeenCalled();
  });

  it("returns 404 when the plant does not exist or access is denied", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    runAndPersistPlantAnalysis.mockResolvedValue(null);
    const res = await POST(jsonRequest({}), makeParams("missing"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Plant not found or access denied");
  });

  it("returns 404 when the plant has no images to analyze", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    runAndPersistPlantAnalysis.mockResolvedValue({ analysis: null });
    const res = await POST(jsonRequest({}), makeParams("p1"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/No plant images/);
  });

  it("returns the analysis when it succeeds", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    runAndPersistPlantAnalysis.mockResolvedValue({
      analysis: { id: "a1", score: 0.9 },
    });
    const res = await POST(
      jsonRequest({ imageId: "img-1" }),
      makeParams("plant-xyz"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.analysis).toEqual({ id: "a1", score: 0.9 });
    expect(runAndPersistPlantAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ plantId: "plant-xyz", imageId: "img-1" }),
    );
  });

  it("does not forward imageId when omitted from the body", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    runAndPersistPlantAnalysis.mockResolvedValue({
      analysis: { id: "a2" },
    });
    const res = await POST(jsonRequest({}), makeParams("p1"));
    expect(res.status).toBe(200);
    const callArg = (runAndPersistPlantAnalysis as Mock).mock.calls[0]?.[0];
    expect(callArg).not.toHaveProperty("imageId");
    expect(callArg?.plantId).toBe("p1");
    expect(callArg?.requestId).toBeTypeOf("string");
  });

  it("treats an unparseable JSON body as empty (no imageId)", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    runAndPersistPlantAnalysis.mockResolvedValue({ analysis: { id: "a3" } });
    const res = await POST(rawRequest("{not json"), makeParams("p1"));
    expect(res.status).toBe(200);
    const callArg = (runAndPersistPlantAnalysis as Mock).mock.calls[0]?.[0];
    expect(callArg).not.toHaveProperty("imageId");
  });

  it("returns 500 with the error message when the analysis throws", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    runAndPersistPlantAnalysis.mockRejectedValue(new Error("openai down"));
    const res = await POST(jsonRequest({}), makeParams("p1"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("openai down");
  });

  it("propagates an incoming x-request-id on the response", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    runAndPersistPlantAnalysis.mockResolvedValue({ analysis: { id: "a4" } });
    const res = await POST(
      jsonRequest({}, { "x-request-id": "req-abc-123" }),
      makeParams("p1"),
    );
    expect(res.headers.get("x-request-id")).toBe("req-abc-123");
    expect((await res.json()).requestId).toBe("req-abc-123");
  });
});
