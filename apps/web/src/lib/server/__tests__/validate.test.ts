import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";
import { parseJson } from "../validate";

const schema = z.object({
  name: z.string().min(1),
  count: z.number().int().nonnegative().optional(),
});

function jsonRequest(
  body: string,
  contentType = "application/json",
): NextRequest {
  return new NextRequest("http://localhost/test", {
    method: "POST",
    body,
    headers: { "content-type": contentType },
  });
}

describe("parseJson", () => {
  it("returns parsed data on a valid body", async () => {
    const result = await parseJson(
      jsonRequest(JSON.stringify({ name: "leaf", count: 3 })),
      schema,
      { requestId: "rid-1" },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ name: "leaf", count: 3 });
  });

  it("returns 400 invalid_request when a required field is missing", async () => {
    const result = await parseJson(jsonRequest(JSON.stringify({})), schema, {
      requestId: "rid-2",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const body = await result.response.json();
      expect(body.error).toBe("invalid_request");
      expect(body.requestId).toBe("rid-2");
      expect(body.issues?.[0]?.path).toBe("name");
      expect(result.response.headers.get("x-request-id")).toBe("rid-2");
    }
  });

  it("returns 400 invalid_json when the body is not parseable JSON", async () => {
    const result = await parseJson(jsonRequest("not-json"), schema, {
      requestId: "rid-3",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const body = await result.response.json();
      expect(body.error).toBe("invalid_json");
    }
  });

  it("returns 413 when content-length exceeds the cap", async () => {
    const big = JSON.stringify({ name: "x".repeat(1024) });
    const req = new NextRequest("http://localhost/test", {
      method: "POST",
      body: big,
      headers: {
        "content-type": "application/json",
        "content-length": String(2 * 1024 * 1024),
      },
    });
    const result = await parseJson(req, schema, { requestId: "rid-4" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(413);
      const body = await result.response.json();
      expect(body.error).toBe("request_body_too_large");
    }
  });

  it("returns 413 when the body exceeds an explicit maxBytes", async () => {
    const result = await parseJson(
      jsonRequest(JSON.stringify({ name: "abcdef" })),
      schema,
      { requestId: "rid-5", maxBytes: 8 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(413);
  });

  it("returns 415 when content-type is not application/json", async () => {
    const result = await parseJson(
      jsonRequest(JSON.stringify({ name: "x" }), "text/plain"),
      schema,
      { requestId: "rid-6" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(415);
      const body = await result.response.json();
      expect(body.error).toBe("unsupported_media_type");
    }
  });

  it("treats an empty body as {} so all-optional schemas pass", async () => {
    const optionalSchema = z.object({ note: z.string().optional() });
    const req = new NextRequest("http://localhost/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    const result = await parseJson(req, optionalSchema, { requestId: "rid-7" });
    expect(result.ok).toBe(true);
  });
});
