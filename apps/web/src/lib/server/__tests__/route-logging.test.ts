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

  it("classifies 4xx responses as warn (worth flagging, not paging)", async () => {
    // 4xx is normal control flow — a 401 spike could be a leaked
    // token, a 422 spike could be a bad client deploy — both
    // deserve dashboard visibility above noise but not on-call.
    const handler = vi.fn(async () =>
      NextResponse.json({ error: "nope" }, { status: 404 }),
    );
    const wrapped = withRouteLogging("/api/test", handler);
    const res = await wrapped(req("GET"));
    expect(res.status).toBe(404);
    expect(logServerEvent).toHaveBeenCalledWith(
      "warn",
      "request completed",
      expect.objectContaining({ status: 404 }),
    );
  });

  it("classifies 5xx responses as error (must page)", async () => {
    // 5xx is the alerting band — the on-call pipeline filters on
    // log level, so coercing a 503 to info would hide real outages.
    const handler = vi.fn(async () =>
      NextResponse.json({ error: "down" }, { status: 503 }),
    );
    const wrapped = withRouteLogging("/api/test", handler);
    await wrapped(req("GET"));
    expect(logServerEvent).toHaveBeenCalledWith(
      "error",
      "request completed",
      expect.objectContaining({ status: 503 }),
    );
  });

  it("prefers the requestId attached to the response over a fresh mint", async () => {
    // Critical correlation contract: when the inbound request has
    // NO x-request-id header, both the wrapper and the handler would
    // otherwise call `getOrCreateRequestId` independently and mint
    // different UUIDs. The log line and the client-visible header
    // would then disagree. Reading the header back from the response
    // closes that gap.
    const headers = new Headers({ "x-request-id": "handler-minted-xyz" });
    const handler = vi.fn(
      async () => new Response(null, { status: 200, headers }),
    );
    const wrapped = withRouteLogging("/api/test", handler);
    // Inbound deliberately has no x-request-id so the two code paths
    // would diverge without the response-header lookup.
    await wrapped(req("GET"));
    const fields = logServerEvent.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(fields["requestId"]).toBe("handler-minted-xyz");
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

  it("continues an inbound W3C trace: preserves traceId, fresh spanId, parentSpanId = inbound", async () => {
    // End-to-end trace correlation depends on the wrapper carrying
    // the inbound trace id through into its log lines so a single
    // trace grep returns both apps/web and apps/analysis output.
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const wrapped = withRouteLogging("/api/test", handler);
    const inbound = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
    await wrapped(req("GET", { traceparent: inbound }));
    const fields = logServerEvent.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(fields["traceId"]).toBe("0af7651916cd43dd8448eb211c80319c");
    expect(fields["parentSpanId"]).toBe("b7ad6b7169203331");
    // The spanId is NEWLY minted; it must not equal the inbound
    // parent span — that would collapse the trace tree.
    expect(fields["spanId"]).not.toBe("b7ad6b7169203331");
    expect(fields["spanId"]).toMatch(/^[0-9a-f]{16}$/);
  });

  it("originates a fresh trace and omits parentSpanId when no traceparent inbound", async () => {
    // Trace-originator hops shouldn't emit a parentSpanId field at
    // all — including a placeholder would mislead on-call into
    // grepping for a non-existent upstream span.
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const wrapped = withRouteLogging("/api/test", handler);
    await wrapped(req("GET"));
    const fields = logServerEvent.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(fields["traceId"]).toMatch(/^[0-9a-f]{32}$/);
    expect(fields["spanId"]).toMatch(/^[0-9a-f]{16}$/);
    expect(fields).not.toHaveProperty("parentSpanId");
  });

  it("applies Cache-Control: private, no-store by default", async () => {
    // Authed routes wrapped by withRouteLogging carry session-scoped
    // data; the wrapper supplies the baseline cache header so each
    // route doesn't have to remember it. A regression here would let
    // intermediate proxies hold onto per-user responses.
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const wrapped = withRouteLogging("/api/test", handler);
    const res = await wrapped(req("GET"));
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("does not overwrite a Cache-Control header the handler already set", async () => {
    // The streaming chat route uses `no-store, no-transform` because
    // a transforming proxy would corrupt SSE framing. The wrapper
    // must not clobber that more-specific policy.
    const handler = vi.fn(
      async () =>
        new Response("ok", {
          status: 200,
          headers: { "cache-control": "no-store, no-transform" },
        }),
    );
    const wrapped = withRouteLogging("/api/stream", handler);
    const res = await wrapped(req("GET"));
    expect(res.headers.get("cache-control")).toBe("no-store, no-transform");
  });

  it("emits the same trace context on the error-log path", async () => {
    // A thrown handler should still produce a log line tagged with
    // the right trace id, otherwise a crashing request becomes an
    // orphan in the trace tree.
    const handler = vi.fn(async () => {
      throw new Error("boom");
    });
    const wrapped = withRouteLogging("/api/test", handler);
    const inbound = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
    await expect(
      wrapped(req("POST", { traceparent: inbound })),
    ).rejects.toBeTruthy();
    const fields = logServerEvent.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(fields["traceId"]).toBe("0af7651916cd43dd8448eb211c80319c");
    expect(fields["parentSpanId"]).toBe("b7ad6b7169203331");
  });
});
