import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

const getServerSession = vi.fn();
const getServerUser = vi.fn();
const rateLimit = vi.fn();
const rateLimitKeyFromRequest = vi.fn();
const getAuthorizedPlantContext = vi.fn();
const preflightImage = vi.fn();
const getDbClient = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSession(...args),
  getServerUser: (...args: unknown[]) => getServerUser(...args),
}));
vi.mock("@/lib/server/rate-limit", () => ({
  rateLimit: (...args: unknown[]) => rateLimit(...args),
  rateLimitKeyFromRequest: (...args: unknown[]) =>
    rateLimitKeyFromRequest(...args),
}));
vi.mock("@/lib/server/plant-access", () => ({
  getAuthorizedPlantContext: (...args: unknown[]) =>
    getAuthorizedPlantContext(...args),
}));
vi.mock("@/lib/server/analysis-proxy", () => ({
  preflightImage: (...args: unknown[]) => preflightImage(...args),
}));
vi.mock("@/lib/server/db", () => ({
  getDbClient: (...args: unknown[]) => getDbClient(...args),
}));

import { POST } from "../route";
import { UpstreamError } from "@/lib/server/resilience";

const PLANT_ID = "11111111-1111-4111-8111-111111111111";
const IMAGE_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_OK = { user: { id: "u1" } } as const;
const CONTEXT_OK = {
  userId: "u1",
  plantId: PLANT_ID,
  plantName: "Plant 1",
  strain: null,
  notes: null,
  growId: "g1",
  growStage: null,
  medium: null,
  lightType: null,
  startDate: null,
};

function jsonRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost/api/plants/${PLANT_ID}/preflight`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });
}

function makeParams(plantId: string) {
  return { params: Promise.resolve({ plantId }) };
}

function makeDb(row: object | null, error: { message: string } | null) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => ({ data: row, error }),
  };
  return { from: () => builder };
}

describe("POST /api/plants/[plantId]/preflight", () => {
  beforeEach(() => {
    (getServerSession as Mock).mockReset();
    (getServerUser as Mock).mockReset();
    (rateLimit as Mock).mockReset();
    (rateLimitKeyFromRequest as Mock).mockReset();
    (getAuthorizedPlantContext as Mock).mockReset();
    (preflightImage as Mock).mockReset();
    (getDbClient as Mock).mockReset();
    rateLimit.mockReturnValue({ ok: true });
    rateLimitKeyFromRequest.mockReturnValue("k");
    getServerUser.mockResolvedValue({ id: "u1" });
  });

  it("returns 401 when unauthenticated", async () => {
    getServerSession.mockResolvedValue(null);
    const res = await POST(
      jsonRequest({ imageId: IMAGE_ID }),
      makeParams(PLANT_ID),
    );
    expect(res.status).toBe(401);
    expect(preflightImage).not.toHaveBeenCalled();
  });

  it("returns 400 when plant id is not a uuid", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    const res = await POST(
      jsonRequest({ imageId: IMAGE_ID }),
      makeParams("not-a-uuid"),
    );
    expect(res.status).toBe(400);
  });

  it("returns 429 when rate-limited", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    rateLimit.mockReturnValue({ ok: false });
    const res = await POST(
      jsonRequest({ imageId: IMAGE_ID }),
      makeParams(PLANT_ID),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("15");
  });

  it("returns 422 when the body is missing imageId", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    const res = await POST(jsonRequest({}), makeParams(PLANT_ID));
    expect(res.status).toBe(422);
    expect(preflightImage).not.toHaveBeenCalled();
  });

  it("returns 404 when the plant is not accessible", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    getAuthorizedPlantContext.mockResolvedValue(null);
    const res = await POST(
      jsonRequest({ imageId: IMAGE_ID }),
      makeParams(PLANT_ID),
    );
    expect(res.status).toBe(404);
    expect(preflightImage).not.toHaveBeenCalled();
  });

  it("returns 404 when the image does not belong to the plant", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    getAuthorizedPlantContext.mockResolvedValue(CONTEXT_OK);
    getDbClient.mockReturnValue(makeDb(null, null));
    const res = await POST(
      jsonRequest({ imageId: IMAGE_ID }),
      makeParams(PLANT_ID),
    );
    expect(res.status).toBe(404);
    expect(preflightImage).not.toHaveBeenCalled();
  });

  it("returns the preflight result on the happy path", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    getAuthorizedPlantContext.mockResolvedValue(CONTEXT_OK);
    getDbClient.mockReturnValue(
      makeDb(
        {
          id: IMAGE_ID,
          storage_path: `plants/${PLANT_ID}/img.jpg`,
        },
        null,
      ),
    );
    preflightImage.mockResolvedValue({
      plantId: PLANT_ID,
      imageId: IMAGE_ID,
      ok: false,
      reason: "too_dark",
      hint: "Too dark.",
    });

    const res = await POST(
      jsonRequest({ imageId: IMAGE_ID }),
      makeParams(PLANT_ID),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.reason).toBe("too_dark");
    expect(body.data.ok).toBe(false);
    expect(preflightImage).toHaveBeenCalledWith(
      expect.objectContaining({
        plantId: PLANT_ID,
        imageId: IMAGE_ID,
        storagePath: `plants/${PLANT_ID}/img.jpg`,
      }),
    );
  });

  it("maps UPSTREAM_UNAVAILABLE to 503", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    getAuthorizedPlantContext.mockResolvedValue(CONTEXT_OK);
    getDbClient.mockReturnValue(
      makeDb(
        { id: IMAGE_ID, storage_path: `plants/${PLANT_ID}/img.jpg` },
        null,
      ),
    );
    preflightImage.mockRejectedValue(
      new UpstreamError({
        code: "UPSTREAM_UNAVAILABLE",
        message: "analysis dead",
        operation: "analysis-service",
        requestId: "r",
        attempt: 1,
        retryable: false,
      }),
    );
    const res = await POST(
      jsonRequest({ imageId: IMAGE_ID }),
      makeParams(PLANT_ID),
    );
    expect(res.status).toBe(503);
  });

  it("returns 500 when the image lookup itself errors", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    getAuthorizedPlantContext.mockResolvedValue(CONTEXT_OK);
    getDbClient.mockReturnValue(makeDb(null, { message: "db down" }));
    const res = await POST(
      jsonRequest({ imageId: IMAGE_ID }),
      makeParams(PLANT_ID),
    );
    expect(res.status).toBe(500);
    expect(preflightImage).not.toHaveBeenCalled();
  });
});
