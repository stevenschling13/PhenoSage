import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getServerSession = vi.fn();
const createSupabaseServerClient = vi.fn();
const getOrCreateQuickCapturePlant = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  getServerSession: (...a: unknown[]) => getServerSession(...a),
  createSupabaseServerClient: (...a: unknown[]) =>
    createSupabaseServerClient(...a),
}));

vi.mock("@/lib/server/plants", () => ({
  getOrCreateQuickCapturePlant: (...a: unknown[]) =>
    getOrCreateQuickCapturePlant(...a),
}));

import { POST } from "../route";

function call(growId: string) {
  const req = new NextRequest(
    `http://localhost/api/grows/${growId}/quick-capture-plant`,
    { method: "POST" },
  );
  return POST(req, { params: Promise.resolve({ growId }) });
}

/**
 * Builds a minimal Supabase query-builder mock that resolves the
 * `from(...).select(...).eq(...).maybeSingle()` chain used by the route.
 */
function makeSb({ data, error }: { data: unknown; error: unknown }) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => ({ data, error }),
  };
  return { from: () => builder };
}

describe("POST /api/grows/[growId]/quick-capture-plant", () => {
  beforeEach(() => {
    getServerSession.mockReset();
    createSupabaseServerClient.mockReset();
    getOrCreateQuickCapturePlant.mockReset();
  });

  it("returns 401 when unauthenticated", async () => {
    getServerSession.mockResolvedValue(null);
    const res = await call("g1");
    expect(res.status).toBe(401);
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
    expect(getOrCreateQuickCapturePlant).not.toHaveBeenCalled();
  });

  it("returns 404 when the user does not own the grow (RLS hides it)", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    createSupabaseServerClient.mockResolvedValue(
      makeSb({ data: null, error: null }),
    );
    const res = await call("someone-elses-grow");
    expect(res.status).toBe(404);
    expect(getOrCreateQuickCapturePlant).not.toHaveBeenCalled();
  });

  it("returns 500 when the ownership query errors", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    createSupabaseServerClient.mockResolvedValue(
      makeSb({ data: null, error: { message: "db down" } }),
    );
    const res = await call("g1");
    expect(res.status).toBe(500);
    expect(getOrCreateQuickCapturePlant).not.toHaveBeenCalled();
  });

  it("returns 500 when the helper cannot create the plant", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    createSupabaseServerClient.mockResolvedValue(
      makeSb({ data: { id: "g1" }, error: null }),
    );
    getOrCreateQuickCapturePlant.mockResolvedValue(null);
    const res = await call("g1");
    expect(res.status).toBe(500);
    expect(getOrCreateQuickCapturePlant).toHaveBeenCalledWith({ growId: "g1" });
  });

  it("returns 200 with the plantId on the happy path", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1" } });
    createSupabaseServerClient.mockResolvedValue(
      makeSb({ data: { id: "g1" }, error: null }),
    );
    getOrCreateQuickCapturePlant.mockResolvedValue({ plantId: "plant-qc-1" });
    const res = await call("g1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plantId: string; requestId: string };
    expect(body.plantId).toBe("plant-qc-1");
    expect(body.requestId).toBeTruthy();
  });
});
