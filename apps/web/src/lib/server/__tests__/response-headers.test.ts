import { describe, expect, it } from "vitest";
import { noStore, publicCache } from "../response-headers";

describe("noStore", () => {
  it("sets Cache-Control: private, no-store when the response has none", () => {
    // The common case: an authed route returns a fresh Response and
    // expects the wrapper to attach the baseline cache header. Same
    // shape the legacy `attachRequestId` helper has.
    const r = new Response(null, { status: 200 });
    const out = noStore(r);
    expect(out).toBe(r); // returned for chaining
    expect(r.headers.get("cache-control")).toBe("private, no-store");
  });

  it("does NOT overwrite an existing Cache-Control header", () => {
    // The streaming chat route already sets its own policy
    // (`no-store, no-transform`) and would lose intent if the wrapper
    // clobbered it. Pin the non-overwrite contract so a future
    // refactor doesn't silently regress it.
    const r = new Response(null, {
      status: 200,
      headers: { "cache-control": "no-store, no-transform" },
    });
    noStore(r);
    expect(r.headers.get("cache-control")).toBe("no-store, no-transform");
  });
});

describe("publicCache", () => {
  it("sets max-age", () => {
    const r = new Response(null, { status: 200 });
    publicCache(r, { maxAgeSeconds: 60 });
    expect(r.headers.get("cache-control")).toBe("public, max-age=60");
  });

  it("includes stale-while-revalidate when supplied", () => {
    const r = new Response(null, { status: 200 });
    publicCache(r, { maxAgeSeconds: 60, staleWhileRevalidateSeconds: 300 });
    expect(r.headers.get("cache-control")).toBe(
      "public, max-age=60, stale-while-revalidate=300",
    );
  });

  it("omits stale-while-revalidate when zero or negative", () => {
    const r = new Response(null, { status: 200 });
    publicCache(r, { maxAgeSeconds: 60, staleWhileRevalidateSeconds: 0 });
    expect(r.headers.get("cache-control")).toBe("public, max-age=60");
  });

  it("floors fractional seconds so the header is always an integer", () => {
    // RFC 9111 §1.2.2: max-age is an integer count of seconds. A
    // fractional value would technically be a parse error on some
    // intermediaries; flooring is the safe move.
    const r = new Response(null, { status: 200 });
    publicCache(r, {
      maxAgeSeconds: 60.9,
      staleWhileRevalidateSeconds: 300.4,
    });
    expect(r.headers.get("cache-control")).toBe(
      "public, max-age=60, stale-while-revalidate=300",
    );
  });

  it("overwrites a prior Cache-Control header", () => {
    // Unlike `noStore`, `publicCache` is a deliberate assertion that
    // the response IS safe to share. The caller has committed to
    // public caching, so we always take the wheel.
    const r = new Response(null, {
      status: 200,
      headers: { "cache-control": "private, no-store" },
    });
    publicCache(r, { maxAgeSeconds: 30 });
    expect(r.headers.get("cache-control")).toBe("public, max-age=30");
  });
});
