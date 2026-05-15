import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Type the mocks as `vi.fn()` without inferring from defaults so each
// test can pass its own shape via mockResolvedValueOnce / mockReturnValueOnce.
type InsertResult = { error: { code?: string; message: string } | null };
type DigestSnapshot = {
  userId: string;
  grows: { id: string; name: string; stage: string | null }[];
  newFindings: {
    id: string;
    title: string;
    severity: string;
    growId: string;
    plantId: string;
  }[];
  newImages: number;
  newObservations: number;
  newTasks: number;
  resolvedFindings: number;
};

const mocks = vi.hoisted(() => {
  const insert = vi.fn<(_row: unknown) => Promise<InsertResult>>();
  const from = vi.fn(() => ({ insert }));
  const dbClient = { from };

  return {
    insert,
    from,
    dbClient,
    getDbClient: vi.fn(() => dbClient),
    listUsersWithActiveGrows: vi.fn<() => Promise<string[]>>(),
    buildDigestSnapshot:
      vi.fn<(_db: unknown, _userId: string) => Promise<DigestSnapshot>>(),
    hasMeaningfulActivity: vi.fn<() => boolean>(),
    renderDigest: vi.fn<() => Promise<{ title: string; body: string }>>(),
    digestPriority: vi.fn<() => "info" | "warning" | "critical">(),
    logServerEvent: vi.fn(),
  };
});

vi.mock("@/lib/server/db", () => ({
  getDbClient: mocks.getDbClient,
}));
vi.mock("@/lib/server/daily-digest", () => ({
  listUsersWithActiveGrows: mocks.listUsersWithActiveGrows,
  buildDigestSnapshot: mocks.buildDigestSnapshot,
  hasMeaningfulActivity: mocks.hasMeaningfulActivity,
  renderDigest: mocks.renderDigest,
  digestPriority: mocks.digestPriority,
}));
vi.mock("@/lib/server/request-id", () => ({
  logServerEvent: mocks.logServerEvent,
}));

import { GET } from "../route";

const ORIGINAL_ENV = process.env;

function makeRequest(authHeader?: string): NextRequest {
  const headers = new Headers();
  if (authHeader !== undefined) headers.set("authorization", authHeader);
  return new NextRequest("http://localhost/api/internal/cron/daily-summary", {
    headers,
  });
}

describe("GET /api/internal/cron/daily-summary", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    mocks.insert.mockReset().mockResolvedValue({ error: null });
    mocks.from.mockClear();
    mocks.getDbClient.mockReset().mockReturnValue(mocks.dbClient);
    mocks.listUsersWithActiveGrows.mockReset().mockResolvedValue([]);
    mocks.buildDigestSnapshot
      .mockReset()
      .mockImplementation(async (_db, userId) => ({
        userId,
        grows: [],
        newFindings: [],
        newImages: 0,
        newObservations: 0,
        newTasks: 0,
        resolvedFindings: 0,
      }));
    mocks.hasMeaningfulActivity.mockReset().mockReturnValue(false);
    mocks.renderDigest.mockReset().mockResolvedValue({
      title: "Today's grow summary",
      body: "All quiet.",
    });
    mocks.digestPriority.mockReset().mockReturnValue("info");
    mocks.logServerEvent.mockReset();
  });
  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  // ─── auth ───────────────────────────────────────────────────────────

  it("returns 401 when CRON_SECRET is not configured", async () => {
    delete process.env["CRON_SECRET"];
    const res = await GET(makeRequest("Bearer anything"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
    expect(mocks.getDbClient).not.toHaveBeenCalled();
  });

  it("returns 401 when authorization header is missing", async () => {
    process.env["CRON_SECRET"] = "secret";
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns 401 when authorization header is wrong", async () => {
    process.env["CRON_SECRET"] = "secret";
    const res = await GET(makeRequest("Bearer not-the-secret"));
    expect(res.status).toBe(401);
  });

  it("returns 401 when authorization header is missing the Bearer prefix", async () => {
    process.env["CRON_SECRET"] = "secret";
    const res = await GET(makeRequest("secret"));
    expect(res.status).toBe(401);
  });

  // ─── happy path ─────────────────────────────────────────────────────

  it("processes nobody when there are no active users", async () => {
    process.env["CRON_SECRET"] = "secret";
    const res = await GET(makeRequest("Bearer secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: "ok",
      processed: 0,
      wrote: 0,
      skipped: 0,
      errored: 0,
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("skips users with no meaningful activity (no AI call, no DB write)", async () => {
    process.env["CRON_SECRET"] = "secret";
    mocks.listUsersWithActiveGrows.mockResolvedValueOnce(["u1", "u2"]);
    mocks.hasMeaningfulActivity.mockReturnValue(false);

    const res = await GET(makeRequest("Bearer secret"));
    const body = await res.json();
    expect(body.processed).toBe(2);
    expect(body.skipped).toBe(2);
    expect(body.wrote).toBe(0);
    expect(mocks.renderDigest).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("writes a daily_summary row per user with activity", async () => {
    process.env["CRON_SECRET"] = "secret";
    mocks.listUsersWithActiveGrows.mockResolvedValueOnce(["u1"]);
    mocks.buildDigestSnapshot.mockResolvedValueOnce({
      userId: "u1",
      grows: [{ id: "g1", name: "Tent A", stage: "flower" }],
      newFindings: [],
      newImages: 3,
      newObservations: 1,
      newTasks: 0,
      resolvedFindings: 0,
    });
    mocks.hasMeaningfulActivity.mockReturnValueOnce(true);
    mocks.renderDigest.mockResolvedValueOnce({
      title: "Today's grow summary",
      body: "3 new captures and 1 observation across Tent A.",
    });

    const res = await GET(makeRequest("Bearer secret"));
    const body = await res.json();
    expect(body).toMatchObject({
      status: "ok",
      processed: 1,
      wrote: 1,
      skipped: 0,
      errored: 0,
    });
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    const insertedRow = mocks.insert.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(insertedRow).toMatchObject({
      user_id: "u1",
      kind: "daily_summary",
      priority: "info",
      title: "Today's grow summary",
    });
    // YYYY-MM-DD
    expect(typeof insertedRow["occurred_on"]).toBe("string");
    expect((insertedRow["occurred_on"] as string).length).toBe(10);
  });

  // ─── failure isolation ──────────────────────────────────────────────

  it("counts a same-day duplicate (23505) as a skip, not an error", async () => {
    process.env["CRON_SECRET"] = "secret";
    mocks.listUsersWithActiveGrows.mockResolvedValueOnce(["u1"]);
    mocks.hasMeaningfulActivity.mockReturnValueOnce(true);
    mocks.insert.mockResolvedValueOnce({
      error: { code: "23505", message: "duplicate key value" },
    });

    const res = await GET(makeRequest("Bearer secret"));
    const body = await res.json();
    expect(body).toMatchObject({
      processed: 1,
      wrote: 0,
      skipped: 1,
      errored: 0,
    });
  });

  it("one user's failing AI call doesn't abort the whole run", async () => {
    process.env["CRON_SECRET"] = "secret";
    mocks.listUsersWithActiveGrows.mockResolvedValueOnce(["u1", "u2"]);
    mocks.hasMeaningfulActivity.mockReturnValue(true);
    // First user errors during AI render, second succeeds.
    mocks.renderDigest
      .mockRejectedValueOnce(new Error("Gemini 429 rate limit"))
      .mockResolvedValueOnce({
        title: "Today's grow summary",
        body: "ok",
      });

    const res = await GET(makeRequest("Bearer secret"));
    const body = await res.json();
    expect(body).toMatchObject({
      processed: 2,
      wrote: 1,
      errored: 1,
    });
    expect(mocks.logServerEvent).toHaveBeenCalled();
  });

  it("returns 500 when Supabase env is missing (db client throws)", async () => {
    process.env["CRON_SECRET"] = "secret";
    mocks.getDbClient.mockImplementationOnce(() => {
      throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
    });
    const res = await GET(makeRequest("Bearer secret"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Supabase not configured");
  });
});
