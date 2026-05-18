import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

const getServerSession = vi.fn();
const getServerUser = vi.fn();
const signPlantImageUrl = vi.fn();
const rateLimit = vi.fn();
const rateLimitKeyFromRequest = vi.fn();
const logServerEvent = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSession(...args),
  getServerUser: (...args: unknown[]) => getServerUser(...args),
}));
vi.mock("@/lib/server/plants", () => ({
  signPlantImageUrl: (...args: unknown[]) => signPlantImageUrl(...args),
}));
vi.mock("@/lib/server/rate-limit", () => ({
  rateLimit: (...args: unknown[]) => rateLimit(...args),
  rateLimitKeyFromRequest: (...args: unknown[]) =>
    rateLimitKeyFromRequest(...args),
}));
vi.mock("@/lib/server/request-id", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/server/request-id")
  >("@/lib/server/request-id");
  return {
    ...actual,
    logServerEvent: (...args: unknown[]) => logServerEvent(...args),
  };
});

import { POST } from "../route";

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/uploads/refresh", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const SESSION_OK = { user: { id: "u1" } } as const;

describe("POST /api/uploads/refresh", () => {
  beforeEach(() => {
    (getServerSession as Mock).mockReset();
    (getServerUser as Mock).mockReset();
    (signPlantImageUrl as Mock).mockReset();
    (rateLimit as Mock).mockReset();
    (rateLimitKeyFromRequest as Mock).mockReset();
    (logServerEvent as Mock).mockReset();
    rateLimit.mockResolvedValue({ ok: true });
    rateLimitKeyFromRequest.mockReturnValue("k");
    getServerUser.mockResolvedValue({ id: "u1" });
  });

  it("returns 401 when no session is present", async () => {
    getServerSession.mockResolvedValue(null);
    const res = await POST(jsonRequest({ plantId: "p1", imageId: "i1" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Unauthorized");
    expect(signPlantImageUrl).not.toHaveBeenCalled();
  });

  it("returns 429 when the per-user rate limit denies the request", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    rateLimit.mockResolvedValueOnce({ ok: false, remaining: 0, resetAt: 0 });
    const res = await POST(jsonRequest({ plantId: "p1", imageId: "i1" }));
    expect(res.status).toBe(429);
    expect(signPlantImageUrl).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON body", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    const req = new NextRequest("http://localhost/api/uploads/refresh", {
      method: "POST",
      body: "{not-json",
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/valid JSON/);
  });

  it.each([
    ["plantId", { imageId: "i1" }],
    ["imageId", { plantId: "p1" }],
  ])("returns 400 when %s is missing", async (_field, body) => {
    getServerSession.mockResolvedValue(SESSION_OK);
    const res = await POST(jsonRequest(body));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/required/);
    expect(signPlantImageUrl).not.toHaveBeenCalled();
  });

  it("returns 404 when the helper denies access (auth or missing image collapse together)", async () => {
    // The helper returns null both when the caller isn't authorized
    // for the plant AND when the imageId doesn't belong to the plant.
    // The route must NOT distinguish them in the response so an
    // attacker cannot probe imageId existence.
    getServerSession.mockResolvedValue(SESSION_OK);
    signPlantImageUrl.mockResolvedValueOnce(null);
    const res = await POST(jsonRequest({ plantId: "p1", imageId: "i1" }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/not found or access denied/i);
  });

  it("returns a fresh signed URL on success", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    signPlantImageUrl.mockResolvedValueOnce({
      signedUrl: "https://example.com/refreshed.png?token=new",
      expiresAt: "2026-05-18T01:00:00.000Z",
    });
    const res = await POST(
      jsonRequest({ plantId: "p1", imageId: "i1", expiresInSeconds: 600 }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.signedUrl).toBe("https://example.com/refreshed.png?token=new");
    expect(body.expiresAt).toBe("2026-05-18T01:00:00.000Z");
    expect(signPlantImageUrl).toHaveBeenCalledWith({
      plantId: "p1",
      imageId: "i1",
      expiresInSeconds: 600,
    });
  });

  it("omits expiresInSeconds from the helper call when the client sends a non-numeric value", async () => {
    // Bad-shape input shouldn't reach the helper as something
    // surprising. We strip it so the helper picks its default.
    getServerSession.mockResolvedValue(SESSION_OK);
    signPlantImageUrl.mockResolvedValueOnce({
      signedUrl: "https://example.com/x",
      expiresAt: "2026-05-18T01:00:00.000Z",
    });
    await POST(
      jsonRequest({
        plantId: "p1",
        imageId: "i1",
        expiresInSeconds: "ten minutes",
      }),
    );
    const call = (signPlantImageUrl as Mock).mock.calls[0]?.[0];
    expect(call).not.toHaveProperty("expiresInSeconds");
  });

  it("returns 500 and logs structured error when the helper throws", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    signPlantImageUrl.mockRejectedValueOnce(new Error("boom"));
    const res = await POST(jsonRequest({ plantId: "p1", imageId: "i1" }));
    expect(res.status).toBe(500);
    expect(logServerEvent).toHaveBeenCalledWith(
      "error",
      "signed url refresh failed",
      expect.objectContaining({
        plantId: "p1",
        imageId: "i1",
        error: "boom",
      }),
    );
  });
});
