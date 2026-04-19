import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { getServerUser, authorizePlantAccess, createSignedUploadUrl } =
  vi.hoisted(() => ({
    getServerUser: vi.fn(),
    authorizePlantAccess: vi.fn(),
    createSignedUploadUrl: vi.fn(),
  }));

vi.mock("@/lib/server/auth", () => ({
  getServerUser,
  getServerSession: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/lib/server/authorization", () => ({
  authorizePlantAccess,
  authorizeGrowAccess: vi.fn(),
}));
vi.mock("@/lib/server/storage", () => ({
  getStorageClient: () => ({
    from: () => ({ createSignedUploadUrl }),
  }),
}));

import { POST } from "../route";

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/uploads/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/uploads/sign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    getServerUser.mockResolvedValue(null);
    const res = await POST(
      req({
        plantId: "11111111-1111-1111-1111-111111111111",
        contentType: "image/jpeg",
      }) as unknown as import("next/server").NextRequest,
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 for malformed body (missing plantId)", async () => {
    getServerUser.mockResolvedValue({ id: "u1", email: "a@b" });
    const res = await POST(
      req({
        contentType: "image/jpeg",
      }) as unknown as import("next/server").NextRequest,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-uuid plantId", async () => {
    getServerUser.mockResolvedValue({ id: "u1" });
    const res = await POST(
      req({
        plantId: "not-a-uuid",
        contentType: "image/jpeg",
      }) as unknown as import("next/server").NextRequest,
    );
    expect(res.status).toBe(400);
  });

  it("returns 415 for disallowed content types", async () => {
    getServerUser.mockResolvedValue({ id: "u1" });
    const res = await POST(
      req({
        plantId: "11111111-1111-1111-1111-111111111111",
        contentType: "application/pdf",
      }) as unknown as import("next/server").NextRequest,
    );
    expect(res.status).toBe(415);
  });

  it("returns 404 when the user cannot access the plant", async () => {
    getServerUser.mockResolvedValue({ id: "u1" });
    authorizePlantAccess.mockResolvedValue(null);
    const res = await POST(
      req({
        plantId: "11111111-1111-1111-1111-111111111111",
        contentType: "image/jpeg",
      }) as unknown as import("next/server").NextRequest,
    );
    expect(res.status).toBe(404);
  });

  it("returns a signed upload URL on success", async () => {
    getServerUser.mockResolvedValue({ id: "u1" });
    authorizePlantAccess.mockResolvedValue({
      plantId: "11111111-1111-1111-1111-111111111111",
      growId: "22222222-2222-2222-2222-222222222222",
      strain: "Blue Dream",
      name: "Plant 1",
    });
    createSignedUploadUrl.mockResolvedValue({
      data: { signedUrl: "https://s.example/upload?t=abc", token: "tok-xyz" },
      error: null,
    });
    const res = await POST(
      req({
        plantId: "11111111-1111-1111-1111-111111111111",
        contentType: "image/jpeg",
        fileName: "IMG 12/34 weird!.JPG",
      }) as unknown as import("next/server").NextRequest,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      bucket: string;
      storagePath: string;
      signedUrl: string;
      token: string;
    };
    expect(body.bucket).toBe("plant-images");
    expect(body.signedUrl).toContain("upload");
    expect(body.token).toBe("tok-xyz");
    expect(body.storagePath).toContain(
      "22222222-2222-2222-2222-222222222222/11111111-1111-1111-1111-111111111111/",
    );
    expect(body.storagePath).not.toMatch(/[\s!]/);
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("returns 502 when Supabase returns an error", async () => {
    getServerUser.mockResolvedValue({ id: "u1" });
    authorizePlantAccess.mockResolvedValue({
      plantId: "11111111-1111-1111-1111-111111111111",
      growId: "22222222-2222-2222-2222-222222222222",
      strain: null,
      name: "P",
    });
    createSignedUploadUrl.mockResolvedValue({
      data: null,
      error: { message: "bucket not found" },
    });
    const res = await POST(
      req({
        plantId: "11111111-1111-1111-1111-111111111111",
        contentType: "image/png",
      }) as unknown as import("next/server").NextRequest,
    );
    expect(res.status).toBe(502);
  });
});
