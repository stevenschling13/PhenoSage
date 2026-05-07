import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { NextRequest } from "next/server";

const getServerSession = vi.fn();
const getStorageClient = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSession(...args),
}));
vi.mock("@/lib/server/storage", () => ({
  getStorageClient: (...args: unknown[]) => getStorageClient(...args),
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
    (getStorageClient as Mock).mockReset();
    getStorageClient.mockReturnValue({ __storage: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 401 when no session is present", async () => {
    getServerSession.mockResolvedValue(null);
    const res = await POST(
      jsonRequest({
        plantId: "p1",
        fileName: "leaf.jpg",
        contentType: "image/jpeg",
      }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(getStorageClient).not.toHaveBeenCalled();
  });

  it.each([
    ["plantId", { fileName: "f.jpg", contentType: "image/jpeg" }],
    ["fileName", { plantId: "p1", contentType: "image/jpeg" }],
    ["contentType", { plantId: "p1", fileName: "f.jpg" }],
  ])("returns 400 when %s is missing", async (_field, body) => {
    getServerSession.mockResolvedValue(SESSION_OK);
    const res = await POST(jsonRequest(body));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/required/);
  });

  it("returns 415 for an unsupported content type", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    const res = await POST(
      jsonRequest({
        plantId: "p1",
        fileName: "leaf.gif",
        contentType: "image/gif",
      }),
    );
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "Unsupported content type" });
  });

  it.each(["image/jpeg", "image/png", "image/webp", "image/heic"])(
    "accepts content type %s",
    async (contentType) => {
      getServerSession.mockResolvedValue(SESSION_OK);
      vi.useFakeTimers().setSystemTime(new Date("2026-04-01T00:00:00Z"));
      const res = await POST(
        jsonRequest({
          plantId: "plant-xyz",
          fileName: "leaf.jpg",
          contentType,
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.storagePath).toMatch(/^plants\/plant-xyz\/\d+-leaf\.jpg$/);
      expect(getStorageClient).toHaveBeenCalled();
    },
  );

  it("derives a storage path scoped to the plantId", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    const res = await POST(
      jsonRequest({
        plantId: "p1",
        fileName: "shot.png",
        contentType: "image/png",
      }),
    );
    const body = await res.json();
    expect(body.storagePath.startsWith("plants/p1/")).toBe(true);
    expect(body.storagePath.endsWith("-shot.png")).toBe(true);
  });
});
