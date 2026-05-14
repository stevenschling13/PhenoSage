import { describe, expect, it } from "vitest";
import { apiError } from "../api-errors";
import { ApiErrorSchema } from "../schemas";

describe("apiError", () => {
  it("returns a NextResponse whose body conforms to ApiErrorSchema", async () => {
    const r = apiError(401, "UNAUTHORIZED", "Not signed in", "req_abc");
    expect(r.status).toBe(401);
    expect(r.headers.get("x-request-id")).toBe("req_abc");

    // Validate the wire body against the shared error schema instead of
    // an ad-hoc type assertion, so a future shape drift is caught here.
    const parsed = ApiErrorSchema.safeParse(await r.json());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.error).toEqual({
        code: "UNAUTHORIZED",
        message: "Not signed in",
        requestId: "req_abc",
      });
    }
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
      "UPSTREAM_TIMEOUT",
      "UPSTREAM_RATE_LIMITED",
      "UPSTREAM_UNAVAILABLE",
      "CONFIGURATION_ERROR",
      "INTERNAL_ERROR",
    ] as const;
    for (const code of codes) {
      const r = apiError(400, code, "msg", "req_1");
      const parsed = ApiErrorSchema.safeParse(await r.json());
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.error.code).toBe(code);
    }
  });

  it("attaches Retry-After when retryAfterSeconds is provided", () => {
    const r = apiError(429, "RATE_LIMITED", "Slow down", "req_x", {
      retryAfterSeconds: 7,
    });
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBe("7");
  });

  it("rounds up fractional Retry-After values and rejects negatives", () => {
    const positive = apiError(503, "UPSTREAM_UNAVAILABLE", "down", "req_y", {
      retryAfterSeconds: 1.2,
    });
    expect(positive.headers.get("Retry-After")).toBe("2");

    const negative = apiError(503, "UPSTREAM_UNAVAILABLE", "down", "req_z", {
      retryAfterSeconds: -1,
    });
    expect(negative.headers.get("Retry-After")).toBeNull();
  });
});
