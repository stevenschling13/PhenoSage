import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

const getServerSession = vi.fn();
const getServerUser = vi.fn();
const enqueueAnalysisJob = vi.fn();
const rateLimit = vi.fn();
const rateLimitKeyFromRequest = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSession(...args),
  getServerUser: (...args: unknown[]) => getServerUser(...args),
}));
vi.mock("@/lib/server/analysis-jobs", () => ({
  enqueueAnalysisJob: (...args: unknown[]) => enqueueAnalysisJob(...args),
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
const PLANT_ID = "11111111-1111-4111-8111-111111111111";
const IMAGE_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";

describe("POST /api/plants/[plantId]/analyze", () => {
  beforeEach(() => {
    (getServerSession as Mock).mockReset();
    (getServerUser as Mock).mockReset();
    (enqueueAnalysisJob as Mock).mockReset();
    (rateLimit as Mock).mockReset();
    (rateLimitKeyFromRequest as Mock).mockReset();
    rateLimit.mockReturnValue({ ok: true });
    rateLimitKeyFromRequest.mockReturnValue("k");
    getServerUser.mockResolvedValue({ id: "u1" });
  });

  it("returns 401 when no session is present", async () => {
    getServerSession.mockResolvedValue(null);
    const res = await POST(
      jsonRequest({ imageId: IMAGE_ID }),
      makeParams(PLANT_ID),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatchObject({
      code: "UNAUTHORIZED",
      message: "Unauthorized",
    });
    expect(enqueueAnalysisJob).not.toHaveBeenCalled();
  });

  it("returns 429 when rate-limited", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    rateLimit.mockReturnValue({ ok: false });
    const res = await POST(
      jsonRequest({ imageId: IMAGE_ID }),
      makeParams(PLANT_ID),
    );
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.message).toMatch(/Too many/);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(enqueueAnalysisJob).not.toHaveBeenCalled();
  });

  it("returns 422 when the request body is invalid", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    const res = await POST(jsonRequest({}), makeParams(PLANT_ID));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("UNPROCESSABLE_ENTITY");
    expect(enqueueAnalysisJob).not.toHaveBeenCalled();
  });

  it("returns 404 when the plant image does not exist or access is denied", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    enqueueAnalysisJob.mockResolvedValue(null);
    const res = await POST(
      jsonRequest({ imageId: IMAGE_ID }),
      makeParams(PLANT_ID),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toBe("Plant image not found or access denied");
  });

  it("returns the queued analysis job when it succeeds", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    enqueueAnalysisJob.mockResolvedValue({
      id: JOB_ID,
      status: "queued",
      plantId: PLANT_ID,
      imageId: IMAGE_ID,
    });
    const res = await POST(
      jsonRequest({ imageId: IMAGE_ID }),
      makeParams(PLANT_ID),
    );
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.data.job_id).toBe(JOB_ID);
    expect(body.data.status).toBe("queued");
    expect(enqueueAnalysisJob).toHaveBeenCalledWith({
      plantId: PLANT_ID,
      imageId: IMAGE_ID,
    });
  });

  it("returns 400 for malformed JSON", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    const res = await POST(rawRequest("{not json"), makeParams(PLANT_ID));
    expect(res.status).toBe(400);
    expect(enqueueAnalysisJob).not.toHaveBeenCalled();
  });

  it("returns 500 with a safe generic message when the analysis throws", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    // The underlying error mentions an upstream — must NOT leak to the
    // client envelope. The browser should only see the generic message.
    enqueueAnalysisJob.mockRejectedValue(
      new Error("openai down: fetch failed at https://api.openai.com"),
    );
    const res = await POST(
      jsonRequest({ imageId: IMAGE_ID }),
      makeParams(PLANT_ID),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("Plant analysis failed. Please try again.");
    // Critical: the raw upstream message is NOT echoed back.
    expect(JSON.stringify(body)).not.toMatch(/openai down/);
    expect(JSON.stringify(body)).not.toMatch(/fetch failed/);
  });

  it("propagates an incoming x-request-id on the response", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    enqueueAnalysisJob.mockResolvedValue({
      id: JOB_ID,
      status: "queued",
      plantId: PLANT_ID,
      imageId: IMAGE_ID,
    });
    const res = await POST(
      jsonRequest({ imageId: IMAGE_ID }, { "x-request-id": "req-abc-123" }),
      makeParams(PLANT_ID),
    );
    expect(res.headers.get("x-request-id")).toBe("req-abc-123");
    expect((await res.json()).requestId).toBe("req-abc-123");
  });
});
