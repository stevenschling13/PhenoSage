import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../route";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getStorageClient: vi.fn(),
}));

vi.mock("@/lib/server/auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/server/storage", () => ({
  getStorageClient: mocks.getStorageClient,
}));

function jsonRequest(body: unknown): NextRequest {
  return new Request("https://app.example.com/api/uploads/sign", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }) as NextRequest;
}

describe("POST /api/uploads/sign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.getStorageClient.mockReturnValue({ from: vi.fn() });
  });

  it("requires an authenticated session", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const res = await POST(jsonRequest({}));

    expect(res.status).toBe(401);
    expect(mocks.getStorageClient).not.toHaveBeenCalled();
  });

  it("validates required upload metadata", async () => {
    const res = await POST(jsonRequest({ plantId: "plant-1" }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "plantId, fileName, and contentType are required",
    });
  });

  it("rejects non-image content types", async () => {
    const res = await POST(
      jsonRequest({
        plantId: "plant-1",
        fileName: "notes.txt",
        contentType: "text/plain",
      }),
    );

    expect(res.status).toBe(415);
    await expect(res.json()).resolves.toEqual({
      error: "Unsupported content type",
    });
  });

  it("returns a private storage path for an allowed image upload", async () => {
    const res = await POST(
      jsonRequest({
        plantId: "plant-1",
        fileName: "canopy.webp",
        contentType: "image/webp",
      }),
    );

    expect(res.status).toBe(200);
    expect(mocks.getStorageClient).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body.storagePath).toMatch(/^plants\/plant-1\/\d+-canopy\.webp$/);
    expect(body.message).toBe("TODO: Wire Supabase Storage signed upload URL");
  });
});
