import { describe, expect, it } from "vitest";
import { apiError } from "../api-errors";

describe("apiError", () => {
  it("returns a NextResponse with the right status, body, and request id header", async () => {
    const r = apiError(401, "UNAUTHORIZED", "Not signed in", "req_abc");
    expect(r.status).toBe(401);
    expect(r.headers.get("x-request-id")).toBe("req_abc");
    const body = (await r.json()) as {
      error: { code: string; message: string; requestId: string };
    };
    expect(body).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Not signed in",
        requestId: "req_abc",
      },
    });
  });

  it("supports each documented error code", async () => {
    const codes = [
      "BAD_REQUEST",
      "UNAUTHORIZED",
      "FORBIDDEN",
      "NOT_FOUND",
      "UNSUPPORTED_MEDIA_TYPE",
      "UNPROCESSABLE_ENTITY",
      "RATE_LIMITED",
      "INTERNAL_ERROR",
    ] as const;
    for (const code of codes) {
      const r = apiError(400, code, "msg", "req_1");
      const body = (await r.json()) as { error: { code: string } };
      expect(body.error.code).toBe(code);
    }
  });
});
