import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { NextRequest } from "next/server";

const reconcileOnboarding = vi.fn();

vi.mock("@/lib/server/onboarding", () => ({
  reconcileOnboarding: (...args: unknown[]) => reconcileOnboarding(...args),
}));

import { GET } from "../route";

const SECRET = "test-cron-secret";

function buildRequest(opts: { bearer?: string | null } = {}) {
  const bearer = opts.bearer === undefined ? SECRET : opts.bearer;
  const headers: Record<string, string> = {};
  if (bearer) headers["authorization"] = `Bearer ${bearer}`;
  return new NextRequest(
    "http://localhost/api/internal/cron/reconcile-onboarding",
    { method: "GET", headers },
  );
}

describe("GET /api/internal/cron/reconcile-onboarding", () => {
  const originalSecret = process.env["CRON_SECRET"];

  beforeEach(() => {
    (reconcileOnboarding as Mock).mockReset();
    process.env["CRON_SECRET"] = SECRET;
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env["CRON_SECRET"];
    } else {
      process.env["CRON_SECRET"] = originalSecret;
    }
  });

  it("returns 503 when CRON_SECRET is not configured", async () => {
    delete process.env["CRON_SECRET"];
    const res = await GET(buildRequest({ bearer: null }));
    expect(res.status).toBe(503);
    expect(reconcileOnboarding).not.toHaveBeenCalled();
  });

  it("returns 401 when the bearer header is missing", async () => {
    const res = await GET(buildRequest({ bearer: null }));
    expect(res.status).toBe(401);
  });

  it("returns 401 when the bearer is wrong", async () => {
    const res = await GET(buildRequest({ bearer: "nope" }));
    expect(res.status).toBe(401);
  });

  it("returns 200 with the reconcile report on success", async () => {
    reconcileOnboarding.mockResolvedValue({
      scanned: 3,
      seeded: 2,
      errored: 1,
    });
    const res = await GET(buildRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: "ok",
      scanned: 3,
      seeded: 2,
      errored: 1,
    });
    expect(typeof body.durationMs).toBe("number");
  });

  it("returns 500 when reconciliation throws", async () => {
    reconcileOnboarding.mockRejectedValue(new Error("db unavailable"));
    const res = await GET(buildRequest());
    expect(res.status).toBe(500);
  });
});
