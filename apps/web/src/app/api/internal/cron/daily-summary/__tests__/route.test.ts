import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const dbMock = { from: vi.fn() };
const createMock = vi.fn();
vi.mock("@/lib/server/db", () => ({ getDbClient: () => dbMock }));
vi.mock("@/lib/server/ai-client", () => ({
  getAIClient: () => ({
    chat: {
      completions: { create: (...args: unknown[]) => createMock(...args) },
    },
  }),
}));

import { GET } from "../route";
const ORIGINAL_ENV = process.env;
function makeRequest(authHeader?: string): NextRequest {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  return new NextRequest("http://localhost/api/internal/cron/daily-summary", {
    headers,
  });
}

describe("GET /api/internal/cron/daily-summary", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    dbMock.from.mockReset();
    createMock.mockReset();
  });
  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("returns 401 when unauthorized", async () => {
    process.env["CRON_SECRET"] = "secret";
    const res = await GET(makeRequest("Bearer wrong"));
    expect(res.status).toBe(401);
  });

  it("runs pipeline for authorized request", async () => {
    process.env["CRON_SECRET"] = "secret";
    createMock.mockResolvedValue({
      choices: [{ message: { content: "summary" } }],
    });

    dbMock.from.mockImplementation((table: string) => {
      if (table === "grows")
        return {
          select: vi
            .fn()
            .mockReturnValue({
              eq: vi
                .fn()
                .mockResolvedValue({
                  error: null,
                  data: [{ id: "g1", owner_id: "u1", name: "Grow 1" }],
                }),
            }),
        };
      if (table === "grow_events")
        return {
          select: vi
            .fn()
            .mockReturnValue({
              eq: vi
                .fn()
                .mockReturnValue({
                  order: vi
                    .fn()
                    .mockReturnValue({
                      limit: vi
                        .fn()
                        .mockResolvedValue({ error: null, data: [] }),
                    }),
                }),
            }),
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      return {
        select: vi
          .fn()
          .mockReturnValue({
            eq: vi
              .fn()
              .mockReturnValue({
                order: vi
                  .fn()
                  .mockReturnValue({
                    limit: vi.fn().mockResolvedValue({ error: null, data: [] }),
                  }),
              }),
          }),
      };
    });

    const res = await GET(makeRequest("Bearer secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });
});
