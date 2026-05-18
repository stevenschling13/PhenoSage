import "server-only";
import type { NextRequest } from "next/server";
import type { ZodError, ZodSchema } from "zod";

export type ParseJsonBodyResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; details?: ZodError };

/**
 * Default cap for JSON request bodies. 64 KiB is well above the largest
 * legitimate payload we accept anywhere today (chat messages cap at 10k
 * chars + metadata stays comfortably under) while small enough that a
 * crafted multi-megabyte JSON payload can't tie up server resources or
 * memory parsing it. Callers that need a different bound (e.g. an
 * eventual avatar-upload route accepting base64) should pass an
 * explicit `maxBytes`, NOT raise the default — the default is meant to
 * be the "safe everywhere" value.
 */
const DEFAULT_MAX_JSON_BYTES = 64 * 1024;

export interface ParseJsonBodyOptions {
  /**
   * Maximum number of bytes the request body is allowed to carry.
   * Defaults to {@link DEFAULT_MAX_JSON_BYTES}. The check fires off
   * the inbound `content-length` header BEFORE the body is read, so
   * an oversize payload is rejected without ever being parsed.
   *
   * Note: this is the standard belt-and-braces shape — a client can
   * lie about content-length or omit it entirely under chunked
   * transfer encoding, in which case we fall back to letting the
   * body parse and rely on framework limits. The cap is meaningful
   * mainly against opportunistic abuse, not as a hard guarantee.
   */
  maxBytes?: number;
}

export async function parseJsonBody<T>(
  request: NextRequest,
  schema: ZodSchema<T>,
  options: ParseJsonBodyOptions = {},
): Promise<ParseJsonBodyResult<T>> {
  // Use startsWith so we accept "application/json" and the standard
  // "application/json; charset=utf-8" variant but reject anything that
  // merely contains the substring (e.g. "text/html;application/json").
  const contentType = (request.headers.get("content-type") ?? "")
    .toLowerCase()
    .trimStart();
  if (!contentType.startsWith("application/json")) {
    return {
      ok: false,
      status: 415,
      error: "Expected application/json request body",
    };
  }

  // Reject oversized bodies before we read them. A client could still
  // omit content-length (chunked encoding) or lie about it — neither
  // is worth blocking entirely because Next.js itself rejects truly
  // unbounded streams. The check is the cheap layer that catches the
  // common "honest 50 MB JSON" abuse case.
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_JSON_BYTES;
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const declared = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(declared) && declared > maxBytes) {
      return {
        ok: false,
        status: 413,
        error: `Request body exceeds the ${maxBytes}-byte limit.`,
      };
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, status: 400, error: "Malformed JSON body" };
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    // Surface zod's structured error to the caller so route handlers can
    // log it (or pass through under "details" in the apiError envelope).
    // The route is responsible for deciding what to expose to end users.
    return {
      ok: false,
      status: 422,
      error: "Invalid request body",
      details: parsed.error,
    };
  }

  return { ok: true, data: parsed.data };
}

export { DEFAULT_MAX_JSON_BYTES };
