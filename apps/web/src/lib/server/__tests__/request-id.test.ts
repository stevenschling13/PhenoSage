import { afterEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

import {
  REQUEST_ID_HEADER,
  attachRequestId,
  getOrCreateRequestId,
  logServerEvent,
  withRequestIdHeader,
} from "../request-id";

describe("getOrCreateRequestId", () => {
  it("returns the incoming x-request-id header when present", () => {
    const req = new Request("http://localhost/", {
      headers: { [REQUEST_ID_HEADER]: "req-abc-123" },
    });
    expect(getOrCreateRequestId(req)).toBe("req-abc-123");
  });

  it("trims whitespace from the incoming header", () => {
    const req = new Request("http://localhost/", {
      headers: { [REQUEST_ID_HEADER]: "  req-trim  " },
    });
    expect(getOrCreateRequestId(req)).toBe("req-trim");
  });

  it("falls back to a generated UUID when header is missing", () => {
    const req = new Request("http://localhost/");
    const id = getOrCreateRequestId(req);
    // RFC 4122 v4 UUID
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("falls back to a UUID when header is present but blank", () => {
    const req = new Request("http://localhost/", {
      headers: { [REQUEST_ID_HEADER]: "   " },
    });
    const id = getOrCreateRequestId(req);
    expect(id).not.toBe("   ");
    expect(id).not.toBe("");
    expect(id.length).toBeGreaterThan(0);
  });

  it("returns distinct UUIDs across calls without an incoming header", () => {
    const a = getOrCreateRequestId(new Request("http://localhost/"));
    const b = getOrCreateRequestId(new Request("http://localhost/"));
    expect(a).not.toBe(b);
  });
});

describe("withRequestIdHeader", () => {
  it("creates a Headers instance with the request id set", () => {
    const headers = withRequestIdHeader(undefined, "req-1");
    expect(headers.get(REQUEST_ID_HEADER)).toBe("req-1");
  });

  it("preserves caller-supplied headers and sets the request id", () => {
    const headers = withRequestIdHeader(
      { "content-type": "application/json" },
      "req-2",
    );
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get(REQUEST_ID_HEADER)).toBe("req-2");
  });

  it("overwrites an existing x-request-id header", () => {
    const headers = withRequestIdHeader({ [REQUEST_ID_HEADER]: "old" }, "new");
    expect(headers.get(REQUEST_ID_HEADER)).toBe("new");
  });
});

describe("attachRequestId", () => {
  it("sets the request id on a NextResponse and returns the same instance", () => {
    const res = NextResponse.json({ ok: true });
    const result = attachRequestId(res, "req-attach");
    expect(result).toBe(res);
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe("req-attach");
  });

  it("overwrites an existing x-request-id header on the response", () => {
    const res = NextResponse.json({ ok: true });
    res.headers.set(REQUEST_ID_HEADER, "old");
    attachRequestId(res, "fresh");
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe("fresh");
  });
});

describe("logServerEvent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes info logs to stdout as JSON with required fields", () => {
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    logServerEvent("info", "hello", { requestId: "r1" });
    expect(writeSpy).toHaveBeenCalledTimes(1);
    const written = writeSpy.mock.calls[0]?.[0] as string;
    expect(written.endsWith("\n")).toBe(true);
    const payload = JSON.parse(written.trim());
    expect(payload).toMatchObject({
      level: "info",
      message: "hello",
      service: "phenosage-web",
      requestId: "r1",
    });
    expect(typeof payload.timestamp).toBe("string");
  });

  it("writes warn logs to console.warn", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    logServerEvent("warn", "watch out");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).not.toHaveBeenCalled();
    const payload = JSON.parse(warnSpy.mock.calls[0]?.[0] as string);
    expect(payload.level).toBe("warn");
    expect(payload.message).toBe("watch out");
  });

  it("writes error logs to console.error and not stdout", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    logServerEvent("error", "boom", { plantId: "p1" });
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).not.toHaveBeenCalled();
    const payload = JSON.parse(errSpy.mock.calls[0]?.[0] as string);
    expect(payload).toMatchObject({
      level: "error",
      message: "boom",
      plantId: "p1",
      service: "phenosage-web",
    });
  });

  it("merges custom fields without clobbering required fields", () => {
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    logServerEvent("info", "merge", { requestId: "r1", extra: 42 });
    const payload = JSON.parse((writeSpy.mock.calls[0]?.[0] as string).trim());
    expect(payload.service).toBe("phenosage-web");
    expect(payload.requestId).toBe("r1");
    expect(payload.extra).toBe(42);
  });
});
