import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  const getUser = vi.fn();
  const fromSelect = vi.fn();
  const supabaseStub = {
    auth: { getUser },
    from: vi.fn(() => ({ select: fromSelect })),
  };
  return {
    getUser,
    fromSelect,
    supabaseStub,
    createSupabaseServerClient: vi.fn(async () => supabaseStub),
    getAuthConfigViolations: vi.fn(() => [] as string[]),
    hasServiceRoleConfigured: vi.fn(() => true),
    logServerEvent: vi.fn(),
  };
});

vi.mock("@/lib/server/auth", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));

vi.mock("@/lib/server/auth-errors", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/server/auth-errors")
  >("@/lib/server/auth-errors");
  return {
    ...actual,
    getAuthConfigViolations: mocks.getAuthConfigViolations,
  };
});

vi.mock("@/lib/server/db", () => ({
  hasServiceRoleConfigured: mocks.hasServiceRoleConfigured,
}));

vi.mock("@/lib/server/request-id", () => ({
  logServerEvent: mocks.logServerEvent,
}));

import { GET } from "../route";

function buildRequest(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/internal/diag", {
    headers,
  });
}

describe("GET /api/internal/diag", () => {
  beforeEach(() => {
    mocks.getUser.mockReset().mockResolvedValue({
      data: { user: null },
      error: null,
    });
    mocks.fromSelect.mockReset().mockReturnValue({
      limit: vi.fn().mockResolvedValue({ error: null }),
    });
    mocks.supabaseStub.from.mockClear();
    mocks.createSupabaseServerClient
      .mockReset()
      .mockResolvedValue(mocks.supabaseStub);
    mocks.getAuthConfigViolations.mockReset().mockReturnValue([]);
    mocks.hasServiceRoleConfigured.mockReset().mockReturnValue(true);
    mocks.logServerEvent.mockReset();
    process.env["CRON_SECRET"] = "diag-secret";
  });

  afterEach(() => {
    delete process.env["CRON_SECRET"];
  });

  it("returns 401 when CRON_SECRET is not configured", async () => {
    delete process.env["CRON_SECRET"];
    const res = await GET(buildRequest({ authorization: "Bearer anything" }));
    expect(res.status).toBe(401);
  });

  it("returns 401 when the Authorization header does not match", async () => {
    const res = await GET(buildRequest({ authorization: "Bearer wrong" }));
    expect(res.status).toBe(401);
  });

  it("returns 200 with all-green checks when env + connectivity are healthy", async () => {
    const res = await GET(
      buildRequest({ authorization: "Bearer diag-secret" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.checks.authEnv).toEqual({ ok: true });
    expect(body.checks.serviceRoleEnv.ok).toBe(true);
    expect(body.checks.supabaseConnect.ok).toBe(true);
    expect(body.checks.authenticated.ok).toBe(false); // no session on curl
  });

  it("reports authEnv violations when env is misconfigured", async () => {
    mocks.getAuthConfigViolations.mockReturnValueOnce([
      "NEXT_PUBLIC_SUPABASE_URL",
    ]);
    const res = await GET(
      buildRequest({ authorization: "Bearer diag-secret" }),
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.checks.authEnv).toEqual({
      ok: false,
      missing: ["NEXT_PUBLIC_SUPABASE_URL"],
    });
  });

  it("reports serviceRoleEnv:false but stays ok when only the cron path is offline", async () => {
    mocks.hasServiceRoleConfigured.mockReturnValueOnce(false);
    const res = await GET(
      buildRequest({ authorization: "Bearer diag-secret" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true); // user-write paths still healthy
    expect(body.checks.serviceRoleEnv.ok).toBe(false);
    expect(body.checks.serviceRoleEnv.note).toMatch(
      /SUPABASE_SERVICE_ROLE_KEY/,
    );
  });

  it("surfaces supabase connection errors in the checks payload (no throw)", async () => {
    mocks.createSupabaseServerClient.mockRejectedValueOnce(
      new Error("fetch failed"),
    );
    const res = await GET(
      buildRequest({ authorization: "Bearer diag-secret" }),
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.checks.supabaseConnect.ok).toBe(false);
    expect(body.checks.supabaseConnect.error).toMatch(/fetch failed/);
    expect(mocks.logServerEvent).toHaveBeenCalled();
  });

  it("reports an authed user when a session is present and confirms RLS read works", async () => {
    mocks.getUser.mockResolvedValueOnce({
      data: { user: { id: "user-1" } },
      error: null,
    });
    const res = await GET(
      buildRequest({ authorization: "Bearer diag-secret" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checks.authenticated).toEqual({
      ok: true,
      userId: "user-1",
    });
    expect(body.checks.writePathReady.ok).toBe(true);
  });
});
