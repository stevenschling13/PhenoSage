import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

const getServerSession = vi.fn();
const getServerUser = vi.fn();
const exportAccountData = vi.fn();
const rateLimit = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSession(...args),
  getServerUser: (...args: unknown[]) => getServerUser(...args),
}));
vi.mock("@/lib/server/account", () => ({
  exportAccountData: (...args: unknown[]) => exportAccountData(...args),
}));
vi.mock("@/lib/server/rate-limit", () => ({
  rateLimit: (...args: unknown[]) => rateLimit(...args),
}));

import { GET } from "../route";

function request() {
  return new NextRequest("http://localhost/api/account/export");
}

describe("GET /api/account/export", () => {
  beforeEach(() => {
    for (const mock of [
      getServerSession,
      getServerUser,
      exportAccountData,
      rateLimit,
    ]) {
      (mock as Mock).mockReset();
    }
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    getServerUser.mockResolvedValue({ id: "u1" });
    rateLimit.mockResolvedValue({ ok: true });
  });

  it("requires authentication", async () => {
    getServerSession.mockResolvedValue(null);
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(exportAccountData).not.toHaveBeenCalled();
  });

  it("is rate-limited per user", async () => {
    rateLimit.mockResolvedValue({ ok: false });
    const res = await GET(request());
    expect(res.status).toBe(429);
    expect(rateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ key: "account-export:u1" }),
    );
  });

  it("returns the export as a JSON attachment", async () => {
    exportAccountData.mockResolvedValue({
      exportedAt: "2026-06-11T00:00:00.000Z",
      userId: "u1",
      email: "a@b.co",
      tables: { grows: [{ id: "g1" }] },
    });
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="phenosage-export-2026-06-11.json"',
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.tables.grows).toEqual([{ id: "g1" }]);
  });

  it("returns a safe 500 when the export throws", async () => {
    exportAccountData.mockRejectedValue(
      new Error("Failed to export plants: rls denied at supabase.co"),
    );
    const res = await GET(request());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/supabase\.co/);
  });
});
