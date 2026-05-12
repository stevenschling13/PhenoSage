import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { NextRequest } from "next/server";
import { parseJsonBody } from "../validate";

const Schema = z.object({ foo: z.string().min(1) });

function makeRequest({
  contentType,
  body,
  invalidJson,
}: {
  contentType?: string | null;
  body?: unknown;
  invalidJson?: boolean;
}): NextRequest {
  const headers = new Headers();
  if (contentType != null) headers.set("content-type", contentType);
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

  it("returns 422 when schema validation fails", async () => {
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
});
