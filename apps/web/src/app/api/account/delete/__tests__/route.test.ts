import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

const getServerSession = vi.fn();
const getServerUser = vi.fn();
const createSupabaseServerClient = vi.fn();
const deleteAccount = vi.fn();
const rateLimit = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSession(...args),
  getServerUser: (...args: unknown[]) => getServerUser(...args),
  createSupabaseServerClient: (...args: unknown[]) =>
    createSupabaseServerClient(...args),
}));
vi.mock("@/lib/server/account", () => ({
  deleteAccount: (...args: unknown[]) => deleteAccount(...args),
}));
vi.mock("@/lib/server/rate-limit", () => ({
  rateLimit: (...args: unknown[]) => rateLimit(...args),
}));

import { POST } from "../route";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/account/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/account/delete", () => {
  beforeEach(() => {
    for (const mock of [
      getServerSession,
      getServerUser,
      createSupabaseServerClient,
      deleteAccount,
      rateLimit,
    ]) {
      (mock as Mock).mockReset();
    }
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    getServerUser.mockResolvedValue({ id: "u1" });
    rateLimit.mockResolvedValue({ ok: true });
    createSupabaseServerClient.mockResolvedValue({
      auth: { signOut: vi.fn().mockResolvedValue({ error: null }) },
    });
  });

  it("requires authentication", async () => {
    getServerSession.mockResolvedValue(null);
    const res = await POST(request({ confirm: "DELETE" }));
    expect(res.status).toBe(401);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("rejects without the literal confirmation string", async () => {
    const res = await POST(request({ confirm: "yes please" }));
    expect(res.status).toBe(422);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("is rate-limited", async () => {
    rateLimit.mockResolvedValue({ ok: false });
    const res = await POST(request({ confirm: "DELETE" }));
    expect(res.status).toBe(429);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("deletes the account for the session user only", async () => {
    deleteAccount.mockResolvedValue({
      deletedStorageObjects: 4,
      storageErrors: 0,
    });
    const res = await POST(request({ confirm: "DELETE" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.deleted).toBe(true);
    expect(body.data.storage_objects_removed).toBe(4);
    expect(deleteAccount).toHaveBeenCalledWith("u1", expect.any(String));
  });

  it("succeeds even when the post-delete sign-out throws", async () => {
    deleteAccount.mockResolvedValue({
      deletedStorageObjects: 0,
      storageErrors: 0,
    });
    createSupabaseServerClient.mockRejectedValue(new Error("no session"));
    const res = await POST(request({ confirm: "DELETE" }));
    expect(res.status).toBe(200);
  });

  it("returns a safe 500 when deletion throws", async () => {
    deleteAccount.mockRejectedValue(
      new Error("Failed to delete auth user: admin key invalid"),
    );
    const res = await POST(request({ confirm: "DELETE" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/admin key/);
  });
});
