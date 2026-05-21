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

const seedDefaultGrowForUser = vi.fn();

vi.mock("@/lib/server/onboarding", () => ({
  seedDefaultGrowForUser: (...args: unknown[]) =>
    seedDefaultGrowForUser(...args),
}));

import { POST } from "../route";

const SECRET = "test-supabase-bearer-token-32-bytes-1234";
const USER_ID = "11111111-1111-4111-8111-111111111111";

function envelope(userId = USER_ID) {
  return {
    type: "INSERT" as const,
    table: "users" as const,
    schema: "auth" as const,
    record: { id: userId, email: "grower@example.com" },
  };
}

function buildRequest(body: unknown, opts: { bearer?: string | null } = {}) {
  const bearer = opts.bearer === undefined ? SECRET : opts.bearer;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (bearer) headers["authorization"] = `Bearer ${bearer}`;
  return new NextRequest(
    "http://localhost/api/internal/webhooks/auth/user-created",
    {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
  );
}

describe("POST /api/internal/webhooks/auth/user-created", () => {
  const originalSecret = process.env["SUPABASE_AUTH_WEBHOOK_SECRET"];

  beforeEach(() => {
    (seedDefaultGrowForUser as Mock).mockReset();
    process.env["SUPABASE_AUTH_WEBHOOK_SECRET"] = SECRET;
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env["SUPABASE_AUTH_WEBHOOK_SECRET"];
    } else {
      process.env["SUPABASE_AUTH_WEBHOOK_SECRET"] = originalSecret;
    }
  });

  it("returns 503 when the webhook secret is not configured", async () => {
    delete process.env["SUPABASE_AUTH_WEBHOOK_SECRET"];
    const res = await POST(buildRequest(envelope(), { bearer: null }));
    expect(res.status).toBe(503);
    expect(seedDefaultGrowForUser).not.toHaveBeenCalled();
  });

  it("returns 401 when the bearer header is missing", async () => {
    const res = await POST(buildRequest(envelope(), { bearer: null }));
    expect(res.status).toBe(401);
  });

  it("returns 401 when the bearer is wrong", async () => {
    const res = await POST(buildRequest(envelope(), { bearer: "nope" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when the body is not valid JSON", async () => {
    const res = await POST(buildRequest("not-json"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when the payload has no user id", async () => {
    const res = await POST(buildRequest({ unrelated: true }));
    expect(res.status).toBe(400);
  });

  it("accepts the wrapped INSERT envelope and reports seeded=true", async () => {
    seedDefaultGrowForUser.mockResolvedValue({
      kind: "seeded",
      growId: "grow-new",
    });
    const res = await POST(buildRequest(envelope()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({
      user_id: USER_ID,
      seeded: true,
      grow_id: "grow-new",
    });
    expect(seedDefaultGrowForUser).toHaveBeenCalledWith({ userId: USER_ID });
  });

  it("accepts the flat { user_id } payload", async () => {
    seedDefaultGrowForUser.mockResolvedValue({
      kind: "seeded",
      growId: "grow-new",
    });
    const res = await POST(buildRequest({ user_id: USER_ID }));
    expect(res.status).toBe(200);
    expect(seedDefaultGrowForUser).toHaveBeenCalledWith({ userId: USER_ID });
  });

  it("returns 200 with seeded=false when the user already has a grow", async () => {
    seedDefaultGrowForUser.mockResolvedValue({
      kind: "already_has_grow",
      growCount: 3,
    });
    const res = await POST(buildRequest(envelope()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.seeded).toBe(false);
    expect(body.data.reason).toBe("already_onboarded");
  });

  it("returns 500 when onboarding throws", async () => {
    seedDefaultGrowForUser.mockRejectedValue(new Error("db unavailable"));
    const res = await POST(buildRequest(envelope()));
    expect(res.status).toBe(500);
  });
});
