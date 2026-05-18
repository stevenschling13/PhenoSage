import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

const getServerSession = vi.fn();
const getServerUser = vi.fn();
const persistPlantImageUpload = vi.fn();
const rateLimit = vi.fn();
const rateLimitKeyFromRequest = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSession(...args),
  getServerUser: (...args: unknown[]) => getServerUser(...args),
}));
vi.mock("@/lib/server/plants", () => ({
  persistPlantImageUpload: (...args: unknown[]) =>
    persistPlantImageUpload(...args),
}));
vi.mock("@/lib/server/rate-limit", () => ({
  rateLimit: (...args: unknown[]) => rateLimit(...args),
  rateLimitKeyFromRequest: (...args: unknown[]) =>
    rateLimitKeyFromRequest(...args),
}));

import { POST } from "../route";

const PLANT_ID = "11111111-1111-4111-8111-111111111111";
const IMAGE_ID = "22222222-2222-4222-8222-222222222222";
const STORAGE_PATH = `${PLANT_ID}/2026-05-18-leaf.jpg`;

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/upload/finalize", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    plantId: PLANT_ID,
    imageId: IMAGE_ID,
    storagePath: STORAGE_PATH,
    ...overrides,
  };
}

const SESSION_OK = { user: { id: "u1" } } as const;

describe("POST /api/upload/finalize", () => {
  beforeEach(() => {
    (getServerSession as Mock).mockReset();
    (getServerUser as Mock).mockReset();
    (persistPlantImageUpload as Mock).mockReset();
    (rateLimit as Mock).mockReset();
    (rateLimitKeyFromRequest as Mock).mockReset();
    rateLimit.mockResolvedValue({ ok: true });
    rateLimitKeyFromRequest.mockReturnValue("k");
    getServerUser.mockResolvedValue({ id: "u1" });
    persistPlantImageUpload.mockResolvedValue({
      id: IMAGE_ID,
      plantId: PLANT_ID,
      storagePath: STORAGE_PATH,
    });
  });

  it("returns 401 when no session is present and does not touch persistence", async () => {
    getServerSession.mockResolvedValue(null);
    const res = await POST(jsonRequest(validBody()));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(persistPlantImageUpload).not.toHaveBeenCalled();
  });

  it("returns 429 with RATE_LIMITED code when the limiter denies", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    rateLimit.mockResolvedValue({ ok: false });
    const res = await POST(jsonRequest(validBody()));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(persistPlantImageUpload).not.toHaveBeenCalled();
  });

  it.each([
    ["plantId missing", { imageId: IMAGE_ID, storagePath: STORAGE_PATH }],
    ["imageId missing", { plantId: PLANT_ID, storagePath: STORAGE_PATH }],
    ["storagePath missing", { plantId: PLANT_ID, imageId: IMAGE_ID }],
    [
      "plantId not a UUID",
      { plantId: "not-a-uuid", imageId: IMAGE_ID, storagePath: STORAGE_PATH },
    ],
    [
      "imageId not a UUID",
      { plantId: PLANT_ID, imageId: "not-a-uuid", storagePath: STORAGE_PATH },
    ],
  ])(
    "returns 422 UNPROCESSABLE_ENTITY when body is invalid (%s)",
    async (_label, body) => {
      getServerSession.mockResolvedValue(SESSION_OK);
      const res = await POST(jsonRequest(body));
      expect(res.status).toBe(422);
      expect((await res.json()).error.code).toBe("UNPROCESSABLE_ENTITY");
      expect(persistPlantImageUpload).not.toHaveBeenCalled();
    },
  );

  it("returns 415 UNSUPPORTED_MEDIA_TYPE when the request is not JSON", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    const res = await POST(
      new NextRequest("http://localhost/api/upload/finalize", {
        method: "POST",
        body: "not-json",
        headers: { "content-type": "text/plain" },
      }),
    );
    expect(res.status).toBe(415);
    expect((await res.json()).error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("returns 404 NOT_FOUND when persistPlantImageUpload returns null", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    persistPlantImageUpload.mockResolvedValueOnce(null);
    const res = await POST(jsonRequest(validBody()));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("returns 201 with persisted body on success and forwards plantId + storagePath + imageId", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    const res = await POST(jsonRequest(validBody()));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toMatchObject({ id: IMAGE_ID, plantId: PLANT_ID });
    expect(persistPlantImageUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        plantId: PLANT_ID,
        imageId: IMAGE_ID,
        storagePath: STORAGE_PATH,
      }),
    );
  });

  it("only forwards optional fields when present (no undefined leaks into the call)", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    await POST(jsonRequest(validBody()));
    const call = (persistPlantImageUpload as Mock).mock.calls[0]?.[0] ?? {};
    expect(call).not.toHaveProperty("takenAt");
    expect(call).not.toHaveProperty("source");
    expect(call).not.toHaveProperty("notes");
  });

  it("forwards takenAt / source / notes when supplied", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    await POST(
      jsonRequest(
        validBody({
          takenAt: "2026-05-18T12:00:00.000Z",
          source: "camera",
          notes: "after lights-on",
        }),
      ),
    );
    expect(persistPlantImageUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        takenAt: "2026-05-18T12:00:00.000Z",
        source: "camera",
        notes: "after lights-on",
      }),
    );
  });

  it("returns 500 INTERNAL_ERROR with a generic message when persistence throws", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    persistPlantImageUpload.mockRejectedValueOnce(
      new Error("supabase connection refused"),
    );
    const res = await POST(jsonRequest(validBody()));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("Image persistence failed");
    // Underlying upstream error message must not leak to the client.
    expect(body.error.message).not.toMatch(/supabase/i);
  });
});
