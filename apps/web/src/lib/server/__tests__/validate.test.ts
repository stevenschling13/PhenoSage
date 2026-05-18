import { describe, expect, it, vi } from "vitest";
import { z, ZodError } from "zod";
import type { NextRequest } from "next/server";
import { DEFAULT_MAX_JSON_BYTES, parseJsonBody } from "../validate";

const Schema = z.object({ foo: z.string().min(1) });

function makeRequest({
  contentType,
  contentLength,
  body,
  invalidJson,
}: {
  contentType?: string | null;
  contentLength?: string | null;
  body?: unknown;
  invalidJson?: boolean;
}): NextRequest {
  const headers = new Headers();
  if (contentType != null) headers.set("content-type", contentType);
  if (contentLength != null) headers.set("content-length", contentLength);
  return {
    headers,
    json: async () => {
      if (invalidJson) {
        throw new SyntaxError("Unexpected token");
      }
      return body as unknown;
    },
  } as unknown as NextRequest;
}

describe("parseJsonBody", () => {
  it("returns 415 when content-type is missing", async () => {
    const r = await parseJsonBody(makeRequest({ contentType: null }), Schema);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(415);
      expect(r.error).toMatch(/application\/json/i);
    }
  });

  it("returns 415 when content-type is not application/json", async () => {
    const r = await parseJsonBody(
      makeRequest({ contentType: "text/plain" }),
      Schema,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(415);
  });

  it("rejects content-type that merely contains application/json as a substring", async () => {
    // startsWith semantics: 'text/html;application/json' must NOT pass.
    const r = await parseJsonBody(
      makeRequest({ contentType: "text/html;application/json" }),
      Schema,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(415);
  });

  it("accepts content-type variants like application/json; charset=utf-8", async () => {
    const r = await parseJsonBody(
      makeRequest({
        contentType: "Application/JSON; charset=utf-8",
        body: { foo: "ok" },
      }),
      Schema,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual({ foo: "ok" });
  });

  it("returns 400 on malformed JSON", async () => {
    const r = await parseJsonBody(
      makeRequest({ contentType: "application/json", invalidJson: true }),
      Schema,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.error).toMatch(/malformed/i);
    }
  });

  it("returns 422 with structured zod details when schema validation fails", async () => {
    const r = await parseJsonBody(
      makeRequest({
        contentType: "application/json",
        body: { foo: "" },
      }),
      Schema,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(422);
      expect(r.error).toMatch(/invalid/i);
      expect(r.details).toBeInstanceOf(ZodError);
      // The route handler can inspect `details.issues` to log or surface
      // a sanitized field-level reason.
      expect(r.details?.issues?.[0]?.path).toEqual(["foo"]);
    }
  });

  it("returns parsed data on success", async () => {
    const r = await parseJsonBody(
      makeRequest({
        contentType: "application/json",
        body: { foo: "bar" },
      }),
      Schema,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual({ foo: "bar" });
  });

  // ─── Content-Length cap (Phase 5.3) ──────────────────────────────────────

  it("returns 413 when declared content-length exceeds the default cap", async () => {
    // 64 KiB default; declare 1 MB.
    const req = makeRequest({
      contentType: "application/json",
      contentLength: String(1_000_000),
      body: { foo: "bar" },
    });
    // Spy on the body reader to prove we short-circuited BEFORE
    // reading. Without this assertion the test would still pass if
    // the cap fired after json() ran — that defeats the purpose
    // (memory pressure from parsing a huge body would already be
    // applied).
    const spy = vi.spyOn(req, "json");
    const r = await parseJsonBody(req, Schema);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(413);
      expect(r.error).toMatch(/exceed/i);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("respects an explicit maxBytes override (tighter than default)", async () => {
    const req = makeRequest({
      contentType: "application/json",
      contentLength: "100",
      body: { foo: "bar" },
    });
    const r = await parseJsonBody(req, Schema, { maxBytes: 64 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(413);
      // Error message includes the configured cap so an operator
      // grepping for the limit value sees the truth, not the
      // default.
      expect(r.error).toContain("64");
    }
  });

  it("respects an explicit maxBytes override (looser than default)", async () => {
    const req = makeRequest({
      contentType: "application/json",
      contentLength: String(DEFAULT_MAX_JSON_BYTES + 1),
      body: { foo: "bar" },
    });
    // The default would reject; an explicit larger cap accepts.
    const r = await parseJsonBody(req, Schema, {
      maxBytes: DEFAULT_MAX_JSON_BYTES * 2,
    });
    expect(r.ok).toBe(true);
  });

  it("accepts a body whose content-length is exactly at the cap", async () => {
    // Off-by-one regression seal: the cap is "must be <= maxBytes",
    // not "must be < maxBytes". A request at exactly the limit
    // passes.
    const req = makeRequest({
      contentType: "application/json",
      contentLength: String(DEFAULT_MAX_JSON_BYTES),
      body: { foo: "bar" },
    });
    const r = await parseJsonBody(req, Schema);
    expect(r.ok).toBe(true);
  });

  it("accepts a body when content-length header is absent (chunked transfer)", async () => {
    // Under chunked transfer encoding the client may omit
    // content-length entirely. The cap is best-effort against the
    // common "honest big JSON" case, not a hard guarantee — we
    // accept and let the framework's own body-size limits take over.
    const req = makeRequest({
      contentType: "application/json",
      body: { foo: "bar" },
    });
    const r = await parseJsonBody(req, Schema);
    expect(r.ok).toBe(true);
  });

  it("accepts a body when content-length header is malformed", async () => {
    // A non-numeric content-length is the client's bug, not an
    // attack signature on its own. We log nothing, accept, and let
    // the body parser reveal the real shape.
    const req = makeRequest({
      contentType: "application/json",
      contentLength: "not-a-number",
      body: { foo: "bar" },
    });
    const r = await parseJsonBody(req, Schema);
    expect(r.ok).toBe(true);
  });
});
