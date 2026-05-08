import "server-only";
import type { NextRequest } from "next/server";
import type { ZodSchema } from "zod";

export async function parseJsonBody<T>(
  request: NextRequest,
  schema: ZodSchema<T>,
): Promise<
  { ok: true; data: T } | { ok: false; status: number; error: string }
> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
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
    return { ok: false, status: 422, error: "Invalid request body" };
  }

  return { ok: true, data: parsed.data };
}
