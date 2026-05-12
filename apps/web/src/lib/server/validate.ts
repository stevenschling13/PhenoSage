import "server-only";
import type { NextRequest } from "next/server";
import type { ZodError, ZodSchema } from "zod";

export type ParseJsonBodyResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; details?: ZodError };

export async function parseJsonBody<T>(
  request: NextRequest,
  schema: ZodSchema<T>,
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
