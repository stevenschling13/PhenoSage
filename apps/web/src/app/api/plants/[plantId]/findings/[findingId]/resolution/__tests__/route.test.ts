import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

const getServerSession = vi.fn();
const createSupabaseServerClient = vi.fn();
const rateLimit = vi.fn();
const rateLimitKeyFromRequest = vi.fn();
const getAuthorizedPlantContext = vi.fn();

vi.mock("@/lib/server/auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSession(...args),
  createSupabaseServerClient: (...args: unknown[]) =>
    createSupabaseServerClient(...args),
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

import { PATCH } from "../route";

const PLANT_ID = "11111111-1111-4111-8111-111111111111";
const FINDING_ID = "33333333-3333-4333-8333-333333333333";
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

function jsonRequest(body: unknown) {
  return new NextRequest(
    `http://localhost/api/plants/${PLANT_ID}/findings/${FINDING_ID}/resolution`,
    {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    },
  );
}

function makeParams(plantId: string, findingId: string) {
  return { params: Promise.resolve({ plantId, findingId }) };
}

function makeSupabase(
  row: object | null,
  error: { code?: string; message: string } | null,
) {
  const builder = {
    update: () => builder,
    eq: () => builder,
    select: () => builder,
    maybeSingle: async () => ({ data: row, error }),
  };
  return { from: () => builder };
}

describe("PATCH /api/plants/[plantId]/findings/[findingId]/resolution", () => {
  beforeEach(() => {
    (getServerSession as Mock).mockReset();
    (createSupabaseServerClient as Mock).mockReset();
    (rateLimit as Mock).mockReset();
    (rateLimitKeyFromRequest as Mock).mockReset();
    (getAuthorizedPlantContext as Mock).mockReset();
    rateLimit.mockReturnValue({ ok: true });
    rateLimitKeyFromRequest.mockReturnValue("k");
  });

  it("returns 401 when unauthenticated", async () => {
    getServerSession.mockResolvedValue(null);
    const res = await PATCH(
      jsonRequest({ state: "confirmed" }),
      makeParams(PLANT_ID, FINDING_ID),
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when the path ids are not uuids", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    const res = await PATCH(
      jsonRequest({ state: "confirmed" }),
      makeParams("not-a-uuid", FINDING_ID),
    );
    expect(res.status).toBe(400);
  });

  it("returns 429 when rate-limited", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    rateLimit.mockReturnValue({ ok: false });
    const res = await PATCH(
      jsonRequest({ state: "confirmed" }),
      makeParams(PLANT_ID, FINDING_ID),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("10");
  });

  it("returns 422 when state is invalid", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    const res = await PATCH(
      jsonRequest({ state: "totally_unknown" }),
      makeParams(PLANT_ID, FINDING_ID),
    );
    expect(res.status).toBe(422);
  });

  it("returns 404 when the plant is not accessible", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    getAuthorizedPlantContext.mockResolvedValue(null);
    const res = await PATCH(
      jsonRequest({ state: "confirmed" }),
      makeParams(PLANT_ID, FINDING_ID),
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 when the finding row is not found / 0-row update", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    getAuthorizedPlantContext.mockResolvedValue(CONTEXT_OK);
    createSupabaseServerClient.mockResolvedValue(makeSupabase(null, null));
    const res = await PATCH(
      jsonRequest({ state: "confirmed" }),
      makeParams(PLANT_ID, FINDING_ID),
    );
    expect(res.status).toBe(404);
  });

  it("returns 403 when RLS denies the update", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    getAuthorizedPlantContext.mockResolvedValue(CONTEXT_OK);
    createSupabaseServerClient.mockResolvedValue(
      makeSupabase(null, { code: "42501", message: "permission denied" }),
    );
    const res = await PATCH(
      jsonRequest({ state: "confirmed" }),
      makeParams(PLANT_ID, FINDING_ID),
    );
    expect(res.status).toBe(403);
  });

  it("returns 200 and echoes the updated resolution on success", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    getAuthorizedPlantContext.mockResolvedValue(CONTEXT_OK);
    createSupabaseServerClient.mockResolvedValue(
      makeSupabase(
        {
          id: FINDING_ID,
          resolution_state: "false_positive",
          resolution_note: "leaf shadow, not lesion",
        },
        null,
      ),
    );
    const res = await PATCH(
      jsonRequest({ state: "false_positive", note: "leaf shadow, not lesion" }),
      makeParams(PLANT_ID, FINDING_ID),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({
      id: FINDING_ID,
      resolutionState: "false_positive",
      resolutionNote: "leaf shadow, not lesion",
    });
  });

  it("clears the note when state is pending", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    getAuthorizedPlantContext.mockResolvedValue(CONTEXT_OK);
    const update = vi.fn(() => builder);
    const builder: {
      update: typeof update;
      eq: () => typeof builder;
      select: () => typeof builder;
      maybeSingle: () => Promise<{ data: unknown; error: null }>;
    } = {
      update,
      eq: () => builder,
      select: () => builder,
      maybeSingle: async () => ({
        data: {
          id: FINDING_ID,
          resolution_state: "pending",
          resolution_note: null,
        },
        error: null,
      }),
    };
    createSupabaseServerClient.mockResolvedValue({ from: () => builder });

    const res = await PATCH(
      jsonRequest({ state: "pending", note: "ignored on pending" }),
      makeParams(PLANT_ID, FINDING_ID),
    );
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith({
      resolution_state: "pending",
      resolution_note: null,
    });
  });

  it("returns 500 on an unexpected db error", async () => {
    getServerSession.mockResolvedValue(SESSION_OK);
    getAuthorizedPlantContext.mockResolvedValue(CONTEXT_OK);
    createSupabaseServerClient.mockResolvedValue(
      makeSupabase(null, { code: "23505", message: "constraint violation" }),
    );
    const res = await PATCH(
      jsonRequest({ state: "confirmed" }),
      makeParams(PLANT_ID, FINDING_ID),
    );
    expect(res.status).toBe(500);
  });
});
