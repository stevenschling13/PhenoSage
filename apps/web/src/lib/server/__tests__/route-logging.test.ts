import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const logServerEvent = vi.fn();
vi.mock("../request-id", async () => {
  const actual =
    await vi.importActual<typeof import("../request-id")>("../request-id");
  return {
    ...actual,
    logServerEvent: (...args: unknown[]) => logServerEvent(...args),
  };
});

import { withRouteLogging } from "../route-logging";

beforeEach(() => {
  logServerEvent.mockReset();
});

function req(
  method: "GET" | "POST" = "GET",
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest("http://localhost/api/test", { method, headers });
}

describe("withRouteLogging", () => {
  it("logs an info envelope after a successful handler", async () => {
    const handler = vi.fn(async () =>
      NextResponse.json({ ok: true }, { status: 200 }),
    );
    const wrapped = withRouteLogging("/api/test", handler);
    const res = await wrapped(req("POST"));
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(logServerEvent).toHaveBeenCalledTimes(1);
    expect(logServerEvent).toHaveBeenCalledWith(
      "info",
      "request completed",
      expect.objectContaining({
        route: "/api/test",
        method: "POST",
        status: 200,
      }),
    );
    const fields = logServerEvent.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(typeof fields["requestId"]).toBe("string");
    expect(typeof fields["durationMs"]).toBe("number");
    expect(fields["durationMs"]).toBeGreaterThanOrEqual(0);
  });

  it("propagates the inbound x-request-id into the log line", async () => {
    // End-to-end tracing depends on the requestId surviving the
    // route boundary. The wrapper must read the inbound header, not
    // mint a fresh id and discard the upstream one.
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const wrapped = withRouteLogging("/api/test", handler);
    await wrapped(req("GET", { "x-request-id": "trace-abc-123" }));
    const fields = logServerEvent.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(fields["requestId"]).toBe("trace-abc-123");
  });

  it("preserves a non-2xx status in the log without throwing", async () => {
    // 4xx / 5xx returns are normal control flow — the wrapper must
    // surface the status verbatim, not coerce to 200 or 500.
    const handler = vi.fn(async () =>
      NextResponse.json({ error: "nope" }, { status: 404 }),
    );
    const wrapped = withRouteLogging("/api/test", handler);
    const res = await wrapped(req("GET"));
    expect(res.status).toBe(404);
    expect(logServerEvent).toHaveBeenCalledWith(
      "info",
      "request completed",
      expect.objectContaining({ status: 404 }),
    );
  });

  it("logs an error envelope and re-throws when the handler throws", async () => {
    // The wrapper's only job on failure is to record the envelope;
    // the framework's default error handling (500 response, Sentry
    // capture, etc.) must still run. Swallowing here would mean the
    // browser sees an empty response.
    const handler = vi.fn(async () => {
      throw new Error("kaboom");
    });
    const wrapped = withRouteLogging("/api/test", handler);

    await expect(wrapped(req("POST"))).rejects.toThrow("kaboom");
    expect(logServerEvent).toHaveBeenCalledTimes(1);
    expect(logServerEvent).toHaveBeenCalledWith(
      "error",
      "request failed",
      expect.objectContaining({
        route: "/api/test",
        method: "POST",
        status: 500,
        error: "kaboom",
      }),
    );
  });

  it("uses 'unknown_error' for non-Error throws", async () => {
    const handler = vi.fn(async () => {
      throw "string-throw";
    });
    const wrapped = withRouteLogging("/api/test", handler);
    await expect(wrapped(req("GET"))).rejects.toBeTruthy();
    expect(logServerEvent).toHaveBeenCalledWith(
      "error",
      "request failed",
      expect.objectContaining({ error: "unknown_error" }),
    );
  });

  it("passes additional handler args through unchanged", async () => {
    // Next.js route handlers receive a context arg (e.g.
    // `{ params: Promise<{ id: string }> }`) — the wrapper must not
    // swallow it, otherwise dynamic routes silently break.
    type Ctx = { params: Promise<{ id: string }> };
    const handler = vi.fn(async (_req: NextRequest, ctx: Ctx) => {
      const { id } = await ctx.params;
      return NextResponse.json({ id }, { status: 200 });
    });
    const wrapped = withRouteLogging("/api/test/[id]", handler);
    const ctx: Ctx = { params: Promise.resolve({ id: "abc" }) };
    const res = await wrapped(req("GET"), ctx);
    expect(handler).toHaveBeenCalledWith(expect.any(NextRequest), ctx);
    expect(await res.json()).toEqual({ id: "abc" });
  });
});
