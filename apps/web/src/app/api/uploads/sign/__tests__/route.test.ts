import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

const getServerSession = vi.fn();
const getServerUser = vi.fn();
const preparePlantImageUpload = vi.fn();
const rateLimit = vi.fn();
const rateLimitKeyFromRequest = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSession(...args),
  getServerUser: (...args: unknown[]) => getServerUser(...args),
}));
vi.mock("@/lib/server/plants", () => ({
  preparePlantImageUpload: (...args: unknown[]) =>
    preparePlantImageUpload(...args),
}));
vi.mock("@/lib/server/rate-limit", () => ({
  rateLimit: (...args: unknown[]) => rateLimit(...args),
  rateLimitKeyFromRequest: (...args: unknown[]) =>
    rateLimitKeyFromRequest(...args),
}));

import { POST } from "../route";

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/uploads/sign", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const SESSION_OK = { user: { id: "u1" } } as const;

describe("POST /api/uploads/sign", () => {
  beforeEach(() => {
    (getServerSession as Mock).mockReset();
    (getServerUser as Mock).mockReset();
    (preparePlantImageUpload as Mock).mockReset();
    (rateLimit as Mock).mockReset();
    (rateLimitKeyFromRequest as Mock).mockReset();
    rateLimit.mockReturnValue({ ok: true });
    rateLimitKeyFromRequest.mockReturnValue("k");
    getServerUser.mockResolvedValue({ id: "u1" });
    preparePlantImageUpload.mockImplementation(
      async ({ plantId, fileName }: { plantId: string; fileName: string }) => ({
        storagePath: `plants/${plantId}/${Date.now()}-${fileName}`,
        signedUrl: "https://example.com/upload",
        token: "signed-token",
      }),
    );
  });

  it("returns 401 when no session is present", async () => {
    getServerSession.mockResolvedValue(null);
    const res = await POST(
      jsonRequest({
        plantId: "11111111-1111-4111-8111-111111111111",
        fileName: "leaf.jpg",
        contentType: "image/jpeg",
      }),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
    expect(preparePlantImageUpload).not.toHaveBeenCalled();
  });

  it.each([
    ["plantId", { fileName: "f.jpg", contentType: "image/jpeg" }],
    [
      "fileName",
      {
        plantId: "11111111-1111-4111-8111-111111111111",
        contentType: "image/jpeg",
      },
    ],
    [
      "contentType",
      { plantId: "11111111-1111-4111-8111-111111111111", fileName: "f.jpg" },
    ],
  ])("returns 400 when %s is missing", async (_field, body) => {
    getServerSession.mockResolvedValue(SESSION_OK);
    const res = await POST(jsonRequest(body));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("UNPROCESSABLE_ENTITY");
  });

  it("returns 415 for an unsupported content type", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    const res = await POST(
      jsonRequest({
        plantId: "11111111-1111-4111-8111-111111111111",
        fileName: "leaf.gif",
        contentType: "image/gif",
      }),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("UNPROCESSABLE_ENTITY");
  });

  it.each(["image/jpeg", "image/png", "image/webp", "image/heic"])(
    "accepts content type %s",
    async (contentType) => {
      getServerSession.mockResolvedValue(SESSION_OK);
      const res = await POST(
        jsonRequest({
          plantId: "11111111-1111-4111-8111-111111111111",
          fileName: "leaf.jpg",
          contentType,
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.storagePath).toMatch(
        /^plants\/11111111-1111-4111-8111-111111111111\/\d+-leaf\.jpg$/,
      );
      expect(preparePlantImageUpload).toHaveBeenCalled();
    },
  );

  it("returns 429 when rate-limited", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    rateLimit.mockReturnValue({ ok: false });
    const res = await POST(
      jsonRequest({
        plantId: "11111111-1111-4111-8111-111111111111",
        fileName: "shot.png",
        contentType: "image/png",
      }),
    );
    expect(res.status).toBe(429);
  });

  it("returns 404 when prepare returns null", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    preparePlantImageUpload.mockResolvedValueOnce(null);
    const res = await POST(
      jsonRequest({
        plantId: "11111111-1111-4111-8111-111111111111",
        fileName: "shot.png",
        contentType: "image/png",
      }),
    );
    expect(res.status).toBe(404);
  });
});
