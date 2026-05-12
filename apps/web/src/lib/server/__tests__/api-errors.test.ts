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
      "INTERNAL_ERROR",
    ] as const;
    for (const code of codes) {
      const r = apiError(400, code, "msg", "req_1");
      const parsed = ApiErrorSchema.safeParse(await r.json());
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.error.code).toBe(code);
    }
  });
});
